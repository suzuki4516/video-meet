const express = require('express')
const http = require('http')
const { Server } = require('socket.io')

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
})

const rooms = new Map()

io.on('connection', (socket) => {
  console.log('ユーザーが接続しました:', socket.id)

  socket.on('join-room', (roomId) => {
    console.log(`ユーザー ${socket.id} がルーム ${roomId} に参加`)
    socket.join(roomId)

    // 既存のユーザーに通知
    socket.to(roomId).emit('user-connected')

    // ルーム情報を保存
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set())
    }
    rooms.get(roomId).add(socket.id)
  })

  socket.on('offer', ({ offer, roomId }) => {
    console.log('Offerを受信:', roomId)
    socket.to(roomId).emit('offer', offer)
  })

  socket.on('answer', ({ answer, roomId }) => {
    console.log('Answerを受信:', roomId)
    socket.to(roomId).emit('answer', answer)
  })

  socket.on('ice-candidate', ({ candidate, roomId }) => {
    console.log('ICE Candidateを受信:', roomId)
    socket.to(roomId).emit('ice-candidate', candidate)
  })

  socket.on('chat-message', ({ message, roomId }) => {
    console.log('チャットメッセージ:', message)
    socket.to(roomId).emit('chat-message', message)
  })

  socket.on('disconnect', () => {
    console.log('ユーザーが切断しました:', socket.id)
    // ルームから削除
    rooms.forEach((users, roomId) => {
      if (users.has(socket.id)) {
        users.delete(socket.id)
        if (users.size === 0) {
          rooms.delete(roomId)
        }
      }
    })
  })
})

const PORT = 3001

server.listen(PORT, () => {
  console.log(`シグナリングサーバーがポート ${PORT} で起動しました`)
})
