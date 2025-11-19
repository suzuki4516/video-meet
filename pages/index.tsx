import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

// リモートビデオコンポーネント
function RemoteVideo({ peerId, stream }: { peerId: string, stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div className="video-container">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="video"
        onLoadedMetadata={(e) => {
          console.log('リモートビデオメタデータ読み込み完了:', peerId)
          e.currentTarget.play().catch(err => {
            console.error('リモートビデオ再生失敗:', peerId, err)
          })
        }}
      />
      <p>参加者 ({peerId.slice(0, 8)})</p>
    </div>
  )
}

export default function Home() {
  const [roomId, setRoomId] = useState('')
  const [joined, setJoined] = useState(false)
  const [messages, setMessages] = useState<Array<{sender: string, text: string}>>([])
  const [newMessage, setNewMessage] = useState('')
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const socketRef = useRef<Socket | null>(null)
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)

  // ローカルビデオの再生を確実にする
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current
      localVideoRef.current.play().catch(err => {
        console.error('ローカルビデオの再生エラー:', err)
      })
    }
  }, [joined])

  const createPeerConnection = (peerId: string) => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }

    const pc = new RTCPeerConnection(configuration)

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          to: peerId,
          roomId
        })
      }
    }

    pc.ontrack = (event) => {
      console.log('リモートストリーム受信:', peerId)
      setRemoteStreams(prev => {
        const newMap = new Map(prev)
        newMap.set(peerId, event.streams[0])
        return newMap
      })
    }

    return pc
  }

  const handleJoinRoom = async () => {
    if (!roomId.trim()) {
      alert('ルームIDを入力してください')
      return
    }

    try {
      // HTTPSチェック（モバイルでは必須）
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
      const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost'

      if (isMobile && !isSecure) {
        alert('モバイルデバイスではHTTPS接続が必要です。\nHTTPSでアクセスしてください。')
        console.error('モバイルデバイスでHTTPアクセスが検出されました')
        return
      }

      console.log('デバイス情報:', {
        isMobile,
        isSecure,
        userAgent: navigator.userAgent
      })

      // Socket.io接続
      // server-with-next.jsを使用する場合は同じオリジン、別サーバーの場合は環境変数で指定
      const socketUrl = process.env.NEXT_PUBLIC_SIGNAL_SERVER || window.location.origin

      console.log('Socket.io接続先:', socketUrl)
      socketRef.current = io(socketUrl, {
        path: '/socket.io/',
        transports: ['websocket', 'polling']
      })

      // モバイル向けに最適化されたメディア制約
      const constraints = {
        video: {
          width: { ideal: isMobile ? 640 : 1280 },
          height: { ideal: isMobile ? 480 : 720 },
          facingMode: facingMode // フロント/リアカメラ
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }

      console.log('メディアデバイスアクセス開始...', constraints)

      // ローカルメディアストリーム取得
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        console.log('メディアストリーム取得成功:', {
          videoTracks: stream.getVideoTracks().length,
          audioTracks: stream.getAudioTracks().length
        })
      } catch (mediaError: any) {
        console.error('メディアストリーム取得エラー:', mediaError)

        // フォールバック: ビデオのみ試行
        console.log('フォールバック: ビデオのみで再試行...')
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: constraints.video })
          console.log('ビデオのみ取得成功')
          alert('マイクへのアクセスに失敗しました。ビデオのみで続行します。')
        } catch (videoError: any) {
          console.error('ビデオ取得エラー:', videoError)

          // 最終フォールバック: オーディオのみ
          console.log('フォールバック: オーディオのみで再試行...')
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: constraints.audio })
            console.log('オーディオのみ取得成功')
            alert('カメラへのアクセスに失敗しました。音声のみで続行します。')
          } catch (audioError: any) {
            console.error('オーディオ取得エラー:', audioError)
            throw new Error(`メディアアクセスに失敗しました: ${audioError.name} - ${audioError.message}`)
          }
        }
      }

      localStreamRef.current = stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        // モバイルでの自動再生を確実にする
        try {
          await localVideoRef.current.play()
          console.log('ローカルビデオ再生開始')
        } catch (playError) {
          console.error('ビデオ再生エラー:', playError)
        }
      }

      // ルームに参加
      socketRef.current.emit('join-room', roomId)

      // Socket.ioイベントハンドラー
      // 既存のユーザーリストを受信（自分が参加したとき）
      socketRef.current.on('existing-users', async (existingUsers: string[]) => {
        console.log('既存のユーザー:', existingUsers)
        // 既存の各ユーザーに対してOfferを送信
        for (const peerId of existingUsers) {
          const pc = createPeerConnection(peerId)
          peerConnectionsRef.current.set(peerId, pc)

          // ローカルストリームを追加
          stream.getTracks().forEach(track => {
            pc.addTrack(track, stream)
          })

          // Offerを作成
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)

          socketRef.current?.emit('offer', {
            offer,
            to: peerId,
            roomId
          })
        }
      })

      // 新しいユーザーが参加（既存ユーザーが受信）
      socketRef.current.on('user-connected', async (peerId: string) => {
        console.log('新しいユーザーが参加:', peerId)
        // 新しいユーザーからOfferが来るのを待つだけ（何もしない）
      })

      // Offerを受信
      socketRef.current.on('offer', async ({ offer, from }: { offer: RTCSessionDescriptionInit, from: string }) => {
        console.log('Offerを受信:', from)
        const pc = createPeerConnection(from)
        peerConnectionsRef.current.set(from, pc)

        stream.getTracks().forEach(track => {
          pc.addTrack(track, stream)
        })

        await pc.setRemoteDescription(new RTCSessionDescription(offer))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        socketRef.current?.emit('answer', {
          answer,
          to: from,
          roomId
        })
      })

      // Answerを受信
      socketRef.current.on('answer', async ({ answer, from }: { answer: RTCSessionDescriptionInit, from: string }) => {
        console.log('Answerを受信:', from)
        const pc = peerConnectionsRef.current.get(from)
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer))
        }
      })

      // ICE Candidateを受信
      socketRef.current.on('ice-candidate', async ({ candidate, from }: { candidate: RTCIceCandidateInit, from: string }) => {
        console.log('ICE Candidateを受信:', from)
        const pc = peerConnectionsRef.current.get(from)
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate))
        }
      })

      // ユーザーが切断
      socketRef.current.on('user-disconnected', (peerId: string) => {
        console.log('ユーザーが切断:', peerId)
        // ピア接続を閉じる
        const pc = peerConnectionsRef.current.get(peerId)
        if (pc) {
          pc.close()
          peerConnectionsRef.current.delete(peerId)
        }
        // リモートストリームを削除
        setRemoteStreams(prev => {
          const newMap = new Map(prev)
          newMap.delete(peerId)
          return newMap
        })
      })

      socketRef.current.on('chat-message', (message: {senderId: string, text: string}) => {
        // 送信者を判定（自分のIDと比較）
        let sender: string
        if (message.senderId === socketRef.current?.id) {
          sender = 'あなた'
        } else {
          // 相手のIDの最初の8文字を表示
          sender = `参加者 (${message.senderId.slice(0, 8)})`
        }
        setMessages((prev) => [...prev, { sender, text: message.text }])
      })

      setJoined(true)
    } catch (error: any) {
      console.error('ルーム参加エラー:', error)

      let errorMessage = 'エラーが発生しました。'

      if (error.message) {
        errorMessage = error.message
      } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage = 'カメラ・マイクへのアクセスが拒否されました。\nブラウザの設定で許可してください。'
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage = 'カメラまたはマイクが見つかりません。\nデバイスが接続されているか確認してください。'
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        errorMessage = 'カメラ・マイクにアクセスできません。\n他のアプリで使用中の可能性があります。'
      } else if (error.name === 'OverconstrainedError') {
        errorMessage = 'カメラ・マイクの設定が対応していません。\n別のデバイスを試してください。'
      } else if (error.name === 'SecurityError') {
        errorMessage = 'セキュリティエラー。HTTPS接続を使用してください。'
      }

      alert(errorMessage)

      // 接続が確立されていた場合はクリーンアップ
      socketRef.current?.disconnect()
    }
  }

  const handleLeaveRoom = () => {
    // ストリームを停止
    localStreamRef.current?.getTracks().forEach(track => track.stop())
    screenStreamRef.current?.getTracks().forEach(track => track.stop())

    // 全てのピア接続を切断
    peerConnectionsRef.current.forEach(pc => pc.close())
    peerConnectionsRef.current.clear()

    // Socket.io切断
    socketRef.current?.disconnect()

    // 状態をリセット
    setRemoteStreams(new Map())
    setJoined(false)
  }

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0]
      audioTrack.enabled = !audioTrack.enabled
      setIsMuted(!audioTrack.enabled)
    }
  }

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0]
      videoTrack.enabled = !videoTrack.enabled
      setIsVideoOff(!videoTrack.enabled)
    }
  }

  const toggleScreenShare = async () => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

    // モバイルでの画面共有チェック
    if (isMobile && !isScreenSharing) {
      alert('申し訳ございません。\nこのデバイスでは画面共有機能がサポートされていません。')
      console.log('モバイルデバイスでは画面共有が制限されています')
      return
    }

    // getDisplayMediaのサポート確認
    if (!navigator.mediaDevices.getDisplayMedia && !isScreenSharing) {
      alert('このブラウザでは画面共有がサポートされていません。')
      console.error('getDisplayMedia is not supported')
      return
    }

    if (isScreenSharing) {
      // 画面共有を停止
      screenStreamRef.current?.getTracks().forEach(track => track.stop())

      try {
        // カメラに戻す
        const constraints = {
          video: {
            width: { ideal: isMobile ? 640 : 1280 },
            height: { ideal: isMobile ? 480 : 720 },
            facingMode: 'user'
          },
          audio: true
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        localStreamRef.current = stream

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream
        }

        // 全てのピア接続のトラックを更新
        const videoTrack = stream.getVideoTracks()[0]
        peerConnectionsRef.current.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          sender?.replaceTrack(videoTrack)
        })

        setIsScreenSharing(false)
        console.log('カメラに戻しました')
      } catch (error) {
        console.error('カメラ復帰エラー:', error)
        alert('カメラに戻せませんでした。')
      }
    } else {
      // 画面共有を開始
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        } as any)
        screenStreamRef.current = screenStream

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream
        }

        const videoTrack = screenStream.getVideoTracks()[0]
        peerConnectionsRef.current.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          sender?.replaceTrack(videoTrack)
        })

        // 画面共有が停止されたときのハンドラー
        videoTrack.onended = () => {
          console.log('画面共有が停止されました')
          setIsScreenSharing(false)
          // カメラに自動的に戻す
          toggleScreenShare()
        }

        setIsScreenSharing(true)
        console.log('画面共有を開始しました')
      } catch (error: any) {
        console.error('画面共有エラー:', error)

        if (error.name === 'NotAllowedError') {
          alert('画面共有が拒否されました。')
        } else {
          alert('画面共有を開始できませんでした。')
        }
      }
    }
  }

  const toggleCamera = async () => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

    if (!isMobile) {
      alert('カメラ切り替えはモバイルデバイスでのみ利用可能です。')
      return
    }

    try {
      // 現在のストリームを停止
      localStreamRef.current?.getTracks().forEach(track => track.stop())

      // 新しいfacingModeを設定
      const newFacingMode = facingMode === 'user' ? 'environment' : 'user'

      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: newFacingMode
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }

      console.log('カメラ切り替え中...', newFacingMode)
      const stream = await navigator.mediaDevices.getUserMedia(constraints)

      localStreamRef.current = stream

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        await localVideoRef.current.play()
      }

      // 全てのピア接続のビデオトラックを更新
      const videoTrack = stream.getVideoTracks()[0]
      const audioTrack = stream.getAudioTracks()[0]

      peerConnectionsRef.current.forEach(pc => {
        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video')
        const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio')

        if (videoSender && videoTrack) {
          videoSender.replaceTrack(videoTrack)
        }
        if (audioSender && audioTrack) {
          audioSender.replaceTrack(audioTrack)
        }
      })

      setFacingMode(newFacingMode)
      console.log('カメラ切り替え成功:', newFacingMode)
    } catch (error) {
      console.error('カメラ切り替えエラー:', error)
      alert('カメラの切り替えに失敗しました。')
    }
  }

  const sendMessage = () => {
    if (newMessage.trim() && socketRef.current) {
      const message = {
        senderId: socketRef.current.id,
        text: newMessage
      }
      socketRef.current.emit('chat-message', { message, roomId })
      // 自分のメッセージとして追加
      setMessages((prev) => [...prev, { sender: 'あなた', text: newMessage }])
      setNewMessage('')
    }
  }

  return (
    <div className="container">
      <h1>Video Meet - 無制限</h1>

      {!joined ? (
        <div className="join-section">
          <input
            type="text"
            placeholder="ルームIDを入力"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="room-input"
          />
          <button onClick={handleJoinRoom} className="btn-join">
            ルームに参加
          </button>
        </div>
      ) : (
        <>
          <div className="video-section">
            <div className="video-container">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="video"
                style={{
                  transform: facingMode === 'user' ? 'scaleX(-1)' : 'none'
                }}
                onLoadedMetadata={(e) => {
                  console.log('ローカルビデオメタデータ読み込み完了')
                  e.currentTarget.play().catch(err => {
                    console.error('ローカルビデオ再生失敗:', err)
                  })
                }}
              />
              <p>あなた</p>
            </div>
            {Array.from(remoteStreams.entries()).map(([peerId, stream]) => (
              <RemoteVideo key={peerId} peerId={peerId} stream={stream} />
            ))}
          </div>

          <div className="controls">
            <button onClick={toggleMute} className={isMuted ? 'btn-danger' : 'btn-control'}>
              {isMuted ? 'ミュート解除' : 'ミュート'}
            </button>
            <button onClick={toggleVideo} className={isVideoOff ? 'btn-danger' : 'btn-control'}>
              {isVideoOff ? 'カメラON' : 'カメラOFF'}
            </button>
            {/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && (
              <button onClick={toggleCamera} className="btn-control">
                {facingMode === 'user' ? '背面カメラ' : '前面カメラ'}
              </button>
            )}
            <button onClick={toggleScreenShare} className="btn-control">
              {isScreenSharing ? '画面共有停止' : '画面共有'}
            </button>
            <button onClick={handleLeaveRoom} className="btn-leave">
              退出
            </button>
          </div>

          <div className="chat-section">
            <div className="chat-messages">
              {messages.map((msg, index) => (
                <div key={index} className="message">
                  <strong>{msg.sender}:</strong> {msg.text}
                </div>
              ))}
            </div>
            <div className="chat-input-section">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="メッセージを入力..."
                className="chat-input"
              />
              <button onClick={sendMessage} className="btn-send">
                送信
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
