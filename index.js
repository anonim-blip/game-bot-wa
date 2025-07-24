const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, delay } = require('@whiskeysockets/baileys')
const fs = require('fs-extra')
const path = require('path')

// Database
const DB_PATH = './database.json'
const COOLDOWN = 5000 // 5 detik

// Inisialisasi
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('session')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
  })

  // Simpan session
  sock.ev.on('creds.update', saveCreds)

  // Handle koneksi
  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode
      if (reason !== DisconnectReason.loggedOut) {
        console.log('Reconnecting...')
        startBot()
      }
    } else if (connection === 'open') {
      console.log('✅ Bot connected!')
    }
  })

  // Cooldown tracker
  const lastCommand = {}

  // Handle pesan
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const sender = msg.key.remoteJid
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
    const now = Date.now()

    // Anti spam
    if (lastCommand[sender] && now - lastCommand[sender] < COOLDOWN) {
      await sock.sendMessage(sender, { text: '⏳ Tunggu 5 detik sebelum command lagi!' })
      return
    }
    lastCommand[sender] = now

    // Load database
    const db = await loadDB()
    if (!db.users) db.users = {}

    // Command handler
    const cmd = text.toLowerCase().split(' ')[0]
    const args = text.split(' ').slice(1)

    try {
      switch (cmd) {
        case 'score':
          const score = db.users[sender]?.score || 0
          await sock.sendMessage(sender, { text: `🎯 Skor kamu: ${score}` })
          break

        case 'tambah':
          const point = parseInt(args[0])
          if (isNaN(point)) throw 'Format: tambah <angka>'
          
          db.users[sender] = db.users[sender] || { score: 0 }
          db.users[sender].score += point
          await saveDB(db)
          
          await sock.sendMessage(sender, { text: `✅ Ditambah ${point}! Skor sekarang: ${db.users[sender].score}` })
          break

        case 'leaderboard':
          const users = Object.entries(db.users)
            .sort((a, b) => b[1].score - a[1].score)
            .slice(0, 5)
          
          let board = '🏆 Top 5 Leaderboard:\n'
          for (const [i, [jid, data]] of users.entries()) {
            const name = (await sock.onWhatsApp(jid))[0]?.verifiedName || jid.split('@')[0]
            board += `${i + 1}. ${name}: ${data.score}\n`
          }
          await sock.sendMessage(sender, { text: board })
          break

        case 'tebak':
          const number = Math.floor(Math.random() * 10) + 1
          const guess = parseInt(args[0])
          
          if (isNaN(guess)) throw 'Format: tebak <1-10>'
          if (guess === number) {
            db.users[sender] = db.users[sender] || { score: 0 }
            db.users[sender].score += 3
            await saveDB(db)
            await sock.sendMessage(sender, { text: `🎉 Benar! Angkanya ${number}. +3 poin!` })
          } else {
            await sock.sendMessage(sender, { text: `❌ Salah! Angkanya ${number}. Coba lagi!` })
          }
          break

        case 'suit':
          const choices = ['batu', 'gunting', 'kertas']
          const botChoice = choices[Math.floor(Math.random() * 3)]
          const userChoice = args[0]?.toLowerCase()
          
          if (!choices.includes(userChoice)) throw 'Pilih: batu/gunting/kertas'
          
          let result
          if (userChoice === botChoice) {
            result = 'Seri!'
          } else if (
            (userChoice === 'batu' && botChoice === 'gunting') ||
            (userChoice === 'gunting' && botChoice === 'kertas') ||
            (userChoice === 'kertas' && botChoice === 'batu')
          ) {
            db.users[sender] = db.users[sender] || { score: 0 }
            db.users[sender].score += 5
            await saveDB(db)
            result = `Kamu menang! +5 poin!`
          } else {
            result = 'Kamu kalah!'
          }
          
          await sock.sendMessage(sender, { 
            text: `✌️ Kamu: ${userChoice}\n🤖 Bot: ${botChoice}\n\n${result}` 
          })
          break

        default:
          if (text) {
            await sock.sendMessage(sender, { 
              text: `🕹️ Game Bot\n\n` +
                    `• score - Cek skor\n` +
                    `• tambah <angka> - Tambah poin\n` +
                    `• leaderboard - Top 5 pemain\n` +
                    `• tebak <1-10> - Tebak angka\n` +
                    `• suit <batu/gunting/kertas> - Main suit\n`
            })
          }
      }
    } catch (err) {
      await sock.sendMessage(sender, { text: `❌ Error: ${err}` })
    }
  })

  // Health check untuk Railway
  const express = require('express')
  const app = express()
  app.get('/', (req, res) => res.send('WA Bot Running!'))
  
  // ⬇️ CHANGE THIS LINE ⬇️
   const express = require('express')
  const app = express()
  app.get('/', (req, res) => res.send('WA Bot Running!'))
  app.listen(process.env.PORT || 3000, '0.0.0.0')  // Changed line
}

// Database functions
async function loadDB() {
  return fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH)) : { users: {} }
}

async function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2))
}

startBot()
