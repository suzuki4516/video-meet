const express = require('express')
const http = require('http')
const { Server } = require('socket.io')

const app = express()
const server = http.createServer(app)

// CORS設定 - Vercelからの接続を許可
const io = new Server(server, {
  cors: {
    origin: '*', // 本番環境では具体的なドメインを指定することを推奨
    methods: ['GET', 'POST']
  }
})

const rooms = new Map()

// ヘルスチェック用エンドポイント
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size })
})

io.on('connection', (socket) => {
  console.log('ユーザーが接続しました:', socket.id)

  socket.on('join-room', (roomId) => {
    console.log(`ユーザー ${socket.id} がルーム ${roomId} に参加`)

    // ルーム情報を保存
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set())
    }

    // 既存のユーザーのリストを取得
    const existingUsers = Array.from(rooms.get(roomId))

    // ルームに参加
    socket.join(roomId)
    rooms.get(roomId).add(socket.id)

    // 新しく参加したユーザーに既存のユーザー全員を通知
    socket.emit('existing-users', existingUsers)

    // 既存のユーザー全員に新しいユーザーを通知
    socket.to(roomId).emit('user-connected', socket.id)

    console.log(`ルーム ${roomId} の参加者:`, Array.from(rooms.get(roomId)))
  })

  socket.on('offer', ({ offer, to, roomId }) => {
    console.log(`Offerを送信: ${socket.id} -> ${to}`)
    io.to(to).emit('offer', { offer, from: socket.id })
  })

  socket.on('answer', ({ answer, to, roomId }) => {
    console.log(`Answerを送信: ${socket.id} -> ${to}`)
    io.to(to).emit('answer', { answer, from: socket.id })
  })

  socket.on('ice-candidate', ({ candidate, to, roomId }) => {
    console.log(`ICE Candidateを送信: ${socket.id} -> ${to}`)
    io.to(to).emit('ice-candidate', { candidate, from: socket.id })
  })

  socket.on('chat-message', ({ message, roomId }) => {
    console.log('チャットメッセージ:', message)
    socket.to(roomId).emit('chat-message', message)
  })

  socket.on('disconnect', () => {
    console.log('ユーザーが切断しました:', socket.id)
    // ルームから削除し、他のユーザーに通知
    rooms.forEach((users, roomId) => {
      if (users.has(socket.id)) {
        users.delete(socket.id)
        // 切断を他のユーザーに通知
        io.to(roomId).emit('user-disconnected', socket.id)
        if (users.size === 0) {
          rooms.delete(roomId)
        }
      }
    })
  })
})

// Renderは自動的にPORT環境変数を設定します
const PORT = process.env.PORT || 3001

server.listen(PORT, () => {
  console.log(`Socket.ioシグナリングサーバーがポート ${PORT} で起動しました`)
})
