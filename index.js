const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const express = require("express");

const DB_PATH = "./database.json";
const QUESTIONS_PATH = path.join(__dirname, "family100-questions.json");

// Load semua soal Family 100 dari JSON
const family100Questions = JSON.parse(fs.readFileSync(QUESTIONS_PATH, "utf8"));

// Load & save database user score (skor total per user across games)
async function loadDB() {
  if (!fs.existsSync(DB_PATH)) return {};
  return JSON.parse(fs.readFileSync(DB_PATH));
}

async function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Simpan game aktif per chat (grup atau pribadi)
const activeGames = {};

// Fungsi delay simpel
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mulai game Family 100 untuk chat tertentu (bisa grup atau pribadi)
async function startFamily100Game(chatId, sock) {
  if (activeGames[chatId]) {
    await sock.sendMessage(chatId, {
      text: "ðŸš« Game Family 100 sedang berlangsung di chat ini! Jawab dulu pertanyaan yang aktif.",
    });
    return;
  }

  activeGames[chatId] = {
    startTime: Date.now(),
    duration: 3 * 60 * 1000, // 3 menit
    currentQuestionIndex: 0,
    score: {}, // { userJid: points }
    answeredAnswers: new Set(), // jawaban unik (lowercase) yang sudah ditemukan di chat ini
    timeout: null,
  };

  const sendCurrentQuestion = async () => {
    const q = family100Questions[activeGames[chatId].currentQuestionIndex];
    await sock.sendMessage(chatId, {
      text: `â“ Family 100:\n${q.question}\n\nJawaban yang sudah ditemukan: ${activeGames[chatId].answeredAnswers.size}/${q.answers.length}\nKetik jawaban kamu!`,
    });
  };

  await sendCurrentQuestion();

  // Set timeout stop game setelah 3 menit
  activeGames[chatId].timeout = setTimeout(async () => {
    if (!activeGames[chatId]) return;
    await sock.sendMessage(chatId, { text: `â° Waktu habis! Game selesai.` });

    // Tampilkan skor akhir
    const scores = activeGames[chatId].score;
    let scoreText = "ðŸ† Skor akhir:\n";
    if (Object.keys(scores).length === 0) {
      scoreText += "Tidak ada yang mendapat poin.";
    } else {
      for (const [jid, pts] of Object.entries(scores)) {
        scoreText += `- ${jid.split("@")[0]}: ${pts}\n`;
      }
    }

    await sock.sendMessage(chatId, { text: scoreText });
    delete activeGames[chatId];
  }, activeGames[chatId].duration);
}

// Cek jawaban user di chat, update skor per user dan jawaban yang sudah dijawab
async function checkAnswer(chatId, sender, sock, text) {
  if (!activeGames[chatId]) return false;

  const game = activeGames[chatId];
  const q = family100Questions[game.currentQuestionIndex];
  const answerLower = text.toLowerCase().trim();

  // Cek apakah jawaban sudah pernah dijawab (per chat)
  if (game.answeredAnswers.has(answerLower)) {
    await sock.sendMessage(chatId, {
      text: `âš ï¸ Jawaban "${text}" sudah dijawab sebelumnya.`,
    });
    return true;
  }

  // Cek jawaban benar penuh yang belum dijawab
  const match = q.answers.find((a) => a.toLowerCase() === answerLower);
  if (match) {
    // Tambah skor user
    game.score[sender] = (game.score[sender] || 0) + (q.pointsPerAnswer || 1);
    game.answeredAnswers.add(answerLower);

    await sock.sendMessage(chatId, {
      text:
        `âœ… Benar dari ${sender.split("@")[0]}! +${q.pointsPerAnswer || 1} poin.\n` +
        `Jawaban ditemukan: ${game.answeredAnswers.size}/${q.answers.length}`,
    });

    // Jika semua jawaban sudah ditemukan, lanjut soal berikutnya
    if (game.answeredAnswers.size >= q.answers.length) {
      game.currentQuestionIndex++;
      game.answeredAnswers.clear();

      if (game.currentQuestionIndex >= family100Questions.length) {
        clearTimeout(game.timeout);
        // Game selesai, tampilkan skor akhir
        let scoreText = "ðŸŽ‰ Semua soal selesai!\nðŸ† Skor akhir:\n";
        const scores = game.score;
        if (Object.keys(scores).length === 0) {
          scoreText += "Tidak ada yang mendapat poin.";
        } else {
          for (const [jid, pts] of Object.entries(scores)) {
            scoreText += `- ${jid.split("@")[0]}: ${pts}\n`;
          }
        }
        await sock.sendMessage(chatId, { text: scoreText });
        delete activeGames[chatId];
        return true;
      } else {
        // Kirim soal berikutnya
        const nextQ = family100Questions[game.currentQuestionIndex];
        await sock.sendMessage(chatId, {
          text: `ðŸŽ® Soal berikutnya:\n${nextQ.question}\n\nJawaban yang sudah ditemukan: 0/${nextQ.answers.length}`,
        });
      }
    }
    return true;
  }
  async function stopFamily100Game(chatId, sock) {
    if (!activeGames[chatId]) {
      await sock.sendMessage(chatId, {
        text: "âš ï¸ Tidak ada game yang sedang berlangsung di chat ini.",
      });
      return;
    }

    clearTimeout(activeGames[chatId].timeout);
    delete activeGames[chatId];

    await sock.sendMessage(chatId, { text: "ðŸ›‘ Game Family 100 dihentikan." });
  }

  // Cek jawaban hampir benar (mengandung substring)
  const almostCorrect = q.answers.some(
    (a) =>
      a.toLowerCase().includes(answerLower) ||
      answerLower.includes(a.toLowerCase()),
  );
  if (almostCorrect) {
    await sock.sendMessage(chatId, { text: "ðŸ¤ Hampir benar, coba lagi!" });
    return true;
  }

  // Jawaban salah
  await sock.sendMessage(chatId, { text: "âŒ Salah, coba lagi!" });
  return true;
}

// Start bot
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version } = await fetchLatestBaileysVersion();

  let sock = makeWASocket({
    version,
    auth: state,
    // printQRInTerminal: true, // deprecated
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      const qrcode = require("qrcode-terminal");
      qrcode.generate(qr, { small: true });
      console.log("ðŸ“² Scan QR Code di atas dengan WhatsApp kamu");
    }
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        console.log("ðŸšª Terlogout, silahkan scan ulang QR Code");
      } else {
        console.log("âŒ Koneksi terputus, mencoba reconnect...");
        await delay(5000);
        startBot();
      }
    } else if (connection === "open") {
      console.log("âœ… Bot connected!");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const chatId = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (!text) return;

    const lowerText = text.toLowerCase().trim();

    if (lowerText === "family 100") {
      await startFamily100Game(chatId, sock);
      return;
    }

    if (activeGames[chatId]) {
      const handled = await checkAnswer(chatId, sender, sock, text);
      if (handled) return;
    }

    // Command lain bisa ditambahkan di sini
    if (lowerText === "score") {
      const db = await loadDB();
      const score = db[sender] || 0;
      await sock.sendMessage(chatId, { text: `ðŸŽ¯ Skor kamu: ${score}` });
      return;
    }
    if (lowerText === "stop") {
      await stopFamily100Game(chatId, sock);
      return;
    }

    if (lowerText.startsWith("tambah ")) {
      const point = parseInt(text.split(" ")[1]);
      if (isNaN(point)) {
        await sock.sendMessage(chatId, {
          text: "âŒ Format salah. Contoh: tambah 5",
        });
        return;
      }
      const db = await loadDB();
      db[sender] = (db[sender] || 0) + point;
      await saveDB(db);
      await sock.sendMessage(chatId, {
        text: `âœ… Skor kamu sekarang: ${db[sender]}`,
      });
      return;
    }

    if (lowerText === "leaderboard") {
      const db = await loadDB();
      const sorted = Object.entries(db).sort((a, b) => b[1] - a[1]);
      const board = sorted
        .map(([id, score], i) => `${i + 1}. ${id.split("@")[0]}: ${score}`)
        .slice(0, 5)
        .join("\n");
      await sock.sendMessage(chatId, { text: `ðŸ† Leaderboard:\n${board}` });
      return;
    }
    // âœ… Pindahkan ke luar dari fungsi checkAnswer()
    async function stopFamily100Game(chatId, sock) {
      if (!activeGames[chatId]) {
        await sock.sendMessage(chatId, {
          text: "âš ï¸ Tidak ada game yang sedang berlangsung di chat ini.",
        });
        return;
      }

      clearTimeout(activeGames[chatId].timeout);
      delete activeGames[chatId];

      await sock.sendMessage(chatId, { text: "ðŸ›‘ Game Family 100 dihentikan." });
    }

    // Default response (help)
    await sock.sendMessage(chatId, {
      text:
        `ðŸ•¹ï¸ Bot Family 100\n\n` +
        `Ketik command:\n` +
        `â€¢ family 100 - Mulai main Family 100\n` +
        `â€¢ score - Cek skor\n` +
        `â€¢ tambah <angka> - Tambah poin\n` +
        `â€¢ leaderboard - Lihat papan skor\n`,
    });
  });
}

const app = express()
const PORT = process.env.PORT || 3000

app.get('/', (req, res) => {
  res.send('Halo Dunia!')
})

app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`)
})

startBot().catch(console.error);
