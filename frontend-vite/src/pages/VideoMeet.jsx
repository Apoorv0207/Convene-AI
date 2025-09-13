import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import { Badge, IconButton, TextField } from '@mui/material';
import { Button } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import styles from "../styles/videoComponent.module.css";
import CallEndIcon from '@mui/icons-material/CallEnd'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import ChatIcon from '@mui/icons-material/Chat'
import server from '../environment';
import CircularProgress from "@mui/material/CircularProgress";


const server_url = server;

var connections = {};



const peerConfigConnections = {
  "iceServers": [
    { "urls": "stun:stun.l.google.com:19302" }
  ]
}

export default function VideoMeetComponent() {

  var socketRef = useRef();
  let socketIdRef = useRef();

  let localVideoref = useRef();

  let [videoAvailable, setVideoAvailable] = useState(true);
  let [audioAvailable, setAudioAvailable] = useState(true);
  let [video, setVideo] = useState(false);
  let [audio, setAudio] = useState(false);
  let [screen, setScreen] = useState(false);
  let [showModal, setModal] = useState(true);
  let [screenAvailable, setScreenAvailable] = useState(false);

  let [messages, setMessages] = useState([])
  let [message, setMessage] = useState("");
  let [newMessages, setNewMessages] = useState(0);

  const messagesEndRef = useRef(null);

  let [askForUsername, setAskForUsername] = useState(true);
  let [username, setUsername] = useState("");

  const videoRef = useRef([])
  let [videos, setVideos] = useState([])
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Helper: create and send offer
  async function createAndSendOffer(pc, targetId) {
    try {
      const desc = await pc.createOffer();
      await pc.setLocalDescription(desc);
      socketRef.current.emit("signal", targetId, JSON.stringify({ sdp: pc.localDescription }));
      console.log("Offer sent to", targetId);
    } catch (e) {
      console.error("create/send offer error:", e);
    }
  }

  // Helper: handle incoming sdp (offer/answer)
  async function handleSdp(fromId, sdp) {
    try {
      if (!connections[fromId]) {
        console.warn("No RTCPeerConnection for", fromId);
        return;
      }
      await connections[fromId].setRemoteDescription(new RTCSessionDescription(sdp));
      console.log("Remote description set from", fromId);

      if (sdp.type === 'offer') {
        const answer = await connections[fromId].createAnswer();
        await connections[fromId].setLocalDescription(answer);
        socketRef.current.emit('signal', fromId, JSON.stringify({ sdp: connections[fromId].localDescription }));
        console.log("Answer sent to", fromId);
      }
    } catch (e) {
      console.error("handleSdp error:", e);
    }
  }

  useEffect(() => {
    console.log("HELLO")
    getPermissions();
  }, [])

  let getDislayMedia = () => {
    if (screen) {
      if (navigator.mediaDevices.getDisplayMedia) {
        navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
          .then(getDislayMediaSuccess)
          .catch((e) => console.log(e))
      }
    }
  }

  const getPermissions = async () => {
    try {
      // Just probing permissions
      try {
        await navigator.mediaDevices.getUserMedia({ video: true });
        setVideoAvailable(true);
        console.log('Video permission granted');
      } catch (e) {
        setVideoAvailable(false);
        console.log('Video permission denied or blocked');
      }

      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        setAudioAvailable(true);
        console.log('Audio permission granted');
      } catch (e) {
        setAudioAvailable(false);
        console.log('Audio permission denied or blocked');
      }

      setScreenAvailable(!!navigator.mediaDevices.getDisplayMedia);

      if (videoAvailable || audioAvailable) {
        const userMediaStream = await navigator.mediaDevices.getUserMedia({ video: videoAvailable, audio: audioAvailable });
        if (userMediaStream) {
          window.localStream = userMediaStream;
          if (localVideoref.current) {
            localVideoref.current.srcObject = userMediaStream;
          }
          connectToSocketServer();
        }
      }
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    if (video !== undefined && audio !== undefined) {
      getUserMedia();
      console.log("SET STATE HAS ", video, audio);
    }
  }, [video, audio])

  let getMedia = () => {
    setVideo(videoAvailable);
    setAudio(audioAvailable);
  }

  let getUserMediaSuccess = (stream) => {
    if (window.localStream) {
      try {
        window.localStream.getTracks().forEach(track => track.stop())
      } catch (e) { console.log(e) }
    }

    window.localStream = stream
    if (localVideoref.current) localVideoref.current.srcObject = stream

    for (let id in connections) {
      if (id === socketIdRef.current) continue

      // Add all tracks properly from localStream
      try {
        if (window.localStream) {
          window.localStream.getTracks().forEach(track => {
            try {
              connections[id].addTrack(track, window.localStream);
            } catch (e) { console.error('addTrack error', e) }
          });
        }
      } catch (e) { console.log(e) }

      // Create and send offer using helper
      createAndSendOffer(connections[id], id);
    }

    stream.getTracks().forEach(track => track.onended = () => {
      setVideo(false);
      setAudio(false);

      try {
        let tracks = localVideoref.current.srcObject.getTracks()
        tracks.forEach(track => track.stop())
      } catch (e) { console.log(e) }

      let blackSilence = (...args) => new MediaStream([black(...args), silence()])
      window.localStream = blackSilence()
      if (localVideoref.current) localVideoref.current.srcObject = window.localStream

      for (let id in connections) {
        try {
          if (window.localStream) {
            window.localStream.getTracks().forEach(track => {
              try { connections[id].addTrack(track, window.localStream) } catch (e) { console.error('addTrack error', e) }
            })
          }
        } catch (e) { console.log(e) }

        createAndSendOffer(connections[id], id);
      }
    })
  }

  let getUserMedia = () => {
    if ((video && videoAvailable) || (audio && audioAvailable)) {
      navigator.mediaDevices.getUserMedia({ video: video, audio: audio })
        .then(getUserMediaSuccess)
        .catch((e) => console.log(e))
    } else {
      try {
        if (localVideoref.current && localVideoref.current.srcObject) {
          let tracks = localVideoref.current.srcObject.getTracks()
          tracks.forEach(track => track.stop())
        }
      } catch (e) { }
    }
  }

  let getDislayMediaSuccess = (stream) => {
    console.log("HERE")
    try {
      if (window.localStream) window.localStream.getTracks().forEach(track => track.stop())
    } catch (e) { console.log(e) }

    window.localStream = stream
    if (localVideoref.current) localVideoref.current.srcObject = stream

    for (let id in connections) {
      if (id === socketIdRef.current) continue

      try {
        if (window.localStream) {
          window.localStream.getTracks().forEach(track => {
            try { connections[id].addTrack(track, window.localStream) } catch (e) { console.error('addTrack error', e) }
          })
        }
      } catch (e) { console.log(e) }

      createAndSendOffer(connections[id], id);
    }

    stream.getTracks().forEach(track => track.onended = () => {
      setScreen(false)

      try {
        let tracks = localVideoref.current.srcObject.getTracks()
        tracks.forEach(track => track.stop())
      } catch (e) { console.log(e) }

      let blackSilence = (...args) => new MediaStream([black(...args), silence()])
      window.localStream = blackSilence()
      if (localVideoref.current) localVideoref.current.srcObject = window.localStream

      getUserMedia()
    })
  }

  let gotMessageFromServer = (fromId, message) => {
    var signal = JSON.parse(message)

    if (fromId !== socketIdRef.current) {
      if (signal.sdp) {
        // delegate to async handler
        handleSdp(fromId, signal.sdp);
      }

      if (signal.ice) {
        if (connections[fromId]) {
          connections[fromId].addIceCandidate(new RTCIceCandidate(signal.ice)).catch(e => console.log(e))
        } else {
          console.warn('Received ICE for unknown connection', fromId);
        }
      }
    }
  }

  let connectToSocketServer = () => {
    socketRef.current = io.connect(server_url, { secure: false })

    socketRef.current.on('signal', gotMessageFromServer)

    socketRef.current.on('connect', () => {
      socketRef.current.emit('join-call', window.location.href)
      socketIdRef.current = socketRef.current.id

      socketRef.current.on('chat-message', addMessage)

      socketRef.current.on('user-left', (id) => {
        setVideos((videos) => videos.filter((video) => video.socketId !== id))
      })

      socketRef.current.on('user-joined', (id, clients) => {
        clients.forEach((socketListId) => {

          // create peer connection
          connections[socketListId] = new RTCPeerConnection(peerConfigConnections)

          // Wait for their ice candidate
          connections[socketListId].onicecandidate = function (event) {
            if (event.candidate != null) {
              socketRef.current.emit('signal', socketListId, JSON.stringify({ 'ice': event.candidate }))
            }
          }

          connections[socketListId].oniceconnectionstatechange = () => {
            console.log(`ICE state for ${socketListId}:`, connections[socketListId].iceConnectionState);
          };

          connections[socketListId].onconnectionstatechange = () => {
            console.log(`Connection state for ${socketListId}:`, connections[socketListId].connectionState);
          };

          // Wait for their video/audio stream
          connections[socketListId].ontrack = (event) => {
            console.log(`Received remote track of kind: ${event.track.kind} from ${socketListId}`);

            const remoteStream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);

            const videoExists = videoRef.current.find(video => video.socketId === socketListId);

            if (!videoExists) {
              console.log(`Adding new video element for ${socketListId}`);
              setVideos(prevVideos => {
                const newVideo = {
                  socketId: socketListId,
                  stream: remoteStream,
                };
                const updatedVideos = [...prevVideos, newVideo];
                videoRef.current = updatedVideos; // Keep ref in sync
                return updatedVideos;
              });
            } else {
              // update stream reference if needed
              setVideos(prev => prev.map(v => v.socketId === socketListId ? { ...v, stream: remoteStream } : v));
            }
          };

          // Add the local video/audio tracks correctly
          if (window.localStream) {
            try {
              window.localStream.getTracks().forEach(track => {
                try { connections[socketListId].addTrack(track, window.localStream) } catch (e) { console.error('addTrack failed:', e) }
              });
            } catch (e) { console.log(e) }
          } else {
            let blackSilence = (...args) => new MediaStream([black(...args), silence()]);
            window.localStream = blackSilence()
            window.localStream.getTracks().forEach(track => {
              try { connections[socketListId].addTrack(track, window.localStream) } catch (e) { console.error('addTrack failed (black):', e) }
            })
          }
        })

        if (id === socketIdRef.current) {
          for (let id2 in connections) {
            if (id2 === socketIdRef.current) continue

            try {
              if (window.localStream) {
                window.localStream.getTracks().forEach(track => {
                  try { connections[id2].addTrack(track, window.localStream) } catch (e) { /* ignore */ }
                })
              }
            } catch (e) { }

            // create offer using helper
            createAndSendOffer(connections[id2], id2);
          }
        }
      })
    })
  }

  let silence = () => {
    let ctx = new AudioContext()
    let oscillator = ctx.createOscillator()
    let dst = oscillator.connect(ctx.createMediaStreamDestination())
    oscillator.start()
    ctx.resume()
    return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false })
  }
  let black = ({ width = 640, height = 480 } = {}) => {
    let canvas = Object.assign(document.createElement("canvas"), { width, height })
    canvas.getContext('2d').fillRect(0, 0, width, height)
    let stream = canvas.captureStream()
    return Object.assign(stream.getVideoTracks()[0], { enabled: false })
  }

  let handleVideo = () => {
    setVideo(!video);
    // getUserMedia();
  }
  let handleAudio = () => {
    setAudio(!audio)
    // getUserMedia();
  }

  useEffect(() => {
    if (screen !== undefined) {
      getDislayMedia();
    }
  }, [screen])
  let handleScreen = () => {
    setScreen(!screen);
  }

  let handleEndCall = () => {
    try {
      let tracks = localVideoref.current.srcObject.getTracks()
      tracks.forEach(track => track.stop())
    } catch (e) { }
    window.location.href = "/"
  }

  let openChat = () => {
    setModal(true);
    setNewMessages(0);
  }
  let closeChat = () => {
    setModal(false);
  }
  let handleMessage = (e) => {
    setMessage(e.target.value);
  }

const addMessage = (data, sender) => {
  setMessages((prevMessages) => [...prevMessages, { sender, data }]);
  setNewMessages((prev) => prev + 1);
};





let sendMessage = async () => {
  if (!message.trim()) return;

  // AI case
  if (message.startsWith("@ai")) {
    setAiLoading(true);

    try {
      const res = await fetch(`${server_url}/api/v1/ai/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: message.replace("@ai", "").trim() }),
      });

      const data = await res.json();
      const aiResponse = { sender: "AI", data: data.reply || "No response from AI" };

      // broadcast AI response through socket
      socketRef.current.emit("chat-message", aiResponse.data, aiResponse.sender);

    } catch (error) {
      console.error("AI fetch error:", error);
      socketRef.current.emit("chat-message", "⚠️ Error getting response from AI", "AI");
    } finally {
      setAiLoading(false);
    }
  } else {
    // normal message → send only via socket
    socketRef.current.emit("chat-message", message, username);
  }

  setMessage("");
};








  let connect = () => {
    setAskForUsername(false);
    getMedia();
  }

  return (
    <div>

      {askForUsername === true ?

        <div>

          <h2>Enter into Lobby </h2>
          <TextField id="outlined-basic" label="Username" value={username} onChange={e => setUsername(e.target.value)} variant="outlined" />
          <Button variant="contained" onClick={connect}>Connect</Button>

          <div>
            <video ref={localVideoref} autoPlay muted playsInline></video>
          </div>

        </div> :


        <div className={styles.meetVideoContainer}>

          {showModal ? <div className={styles.chatRoom}>

            <div className={styles.chatContainer}>
              <h1>Chat</h1>

              <div className={styles.chattingDisplay}>
  {messages.length !== 0 ? messages.map((item, index) => (
    <div style={{ marginBottom: "20px" }} key={index}>
      <p style={{ fontWeight: "bold" }}>{item.sender}</p>
      <p>{item.data}</p>
    </div>
  )) : <p>No Messages Yet</p>}

  {aiLoading && (
  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
    <CircularProgress size={20} />
    <span>AI is typing...</span>
  </div>
)}


  <div ref={messagesEndRef} />
</div>


              <div className={styles.chattingArea}>
                <TextField value={message} onChange={(e) => setMessage(e.target.value)} id="outlined-basic" label="Enter Your chat" variant="outlined" />
                <Button variant='contained' onClick={sendMessage}>Send</Button>
              </div>

            </div>
          </div> : <></>}

          <div className={styles.buttonContainers}>
            <IconButton onClick={handleVideo} style={{ color: "white" }}>
              {(video === true) ? <VideocamIcon /> : <VideocamOffIcon />}
            </IconButton>
            <IconButton onClick={handleEndCall} style={{ color: "red" }}>
              <CallEndIcon />
            </IconButton>
            <IconButton onClick={handleAudio} style={{ color: "white" }}>
              {audio === true ? <MicIcon /> : <MicOffIcon />}
            </IconButton>

            {screenAvailable === true ?
              <IconButton onClick={handleScreen} style={{ color: "white" }}>
                {screen === true ? <ScreenShareIcon /> : <StopScreenShareIcon />}
              </IconButton> : <></>}

            <Badge badgeContent={newMessages} max={999} color='orange'>
              <IconButton onClick={() => setModal(!showModal)} style={{ color: "white" }}>
                <ChatIcon />                        </IconButton>
            </Badge>

          </div>

          <video className={styles.meetUserVideo} ref={localVideoref} autoPlay muted playsInline></video>

          <div className={styles.conferenceView}>
            {videos.map((video) => (
              <div key={video.socketId}>
                <video

                  data-socket={video.socketId}
                  ref={ref => {
                    if (ref && video.stream) {
                      ref.srcObject = video.stream;
                      ref.autoplay = true;
                      ref.playsInline = true;
                      ref.muted = false;
                      ref.play().catch(e => console.warn("video play error:", e));
                    }
                  }}
                  autoPlay
                  playsInline
                >
                </video>
              </div>

            ))}

          </div>

        </div>

      }

    </div>
  )
}
