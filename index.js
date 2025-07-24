const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const fs = require('fs-extra')
const path = require('path')

const DB_PATH = './database.json'

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('session')
  const { version, isLatest } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode
      if (reason !== DisconnectReason.loggedOut) {
        startBot()
      }
    } else if (connection === 'open') {
      console.log('✅ Bot connected!')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const sender = msg.key.remoteJid
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text

    if (!text) return

    if (text.toLowerCase() === 'score') {
      const db = await loadDB()
      const score = db[sender] || 0
      await sock.sendMessage(sender, { text: `🎯 Skor kamu: ${score}` })
    } else if (text.toLowerCase().startsWith('tambah')) {
      const point = parseInt(text.split(' ')[1])
      if (isNaN(point)) return sock.sendMessage(sender, { text: '❌ Format salah. Contoh: tambah 5' })

      const db = await loadDB()
      db[sender] = (db[sender] || 0) + point
      await saveDB(db)

      await sock.sendMessage(sender, { text: `✅ Skor kamu sekarang: ${db[sender]}` })
    } else if (text.toLowerCase() === 'leaderboard') {
      const db = await loadDB()
      const sorted = Object.entries(db).sort((a, b) => b[1] - a[1])
      const board = sorted.map(([id, score], i) => `${i + 1}. ${id.split('@')[0]}: ${score}`).slice(0, 5).join('\n')
      await sock.sendMessage(sender, { text: `🏆 Leaderboard:\n${board}` })
    }
  })
}

async function loadDB() {
  if (!fs.existsSync(DB_PATH)) return {}
  return JSON.parse(fs.readFileSync(DB_PATH))
}

async function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2))
}

startBot()
