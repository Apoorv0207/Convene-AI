import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import { Badge, IconButton, TextField, CircularProgress, Button } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import CallEndIcon from '@mui/icons-material/CallEnd';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare';
import ChatIcon from '@mui/icons-material/Chat';
import server from '../environment';
import styles from "../styles/videoComponent.module.css";

const server_url = server;
var connections = {};

const peerConfigConnections = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

export default function VideoMeetComponent() {
  const socketRef = useRef();
  const socketIdRef = useRef();
  const localVideoref = useRef();
  const videoRef = useRef([]);
  const messagesEndRef = useRef(null);

  const [videoAvailable, setVideoAvailable] = useState(true);
  const [audioAvailable, setAudioAvailable] = useState(true);
  const [video, setVideo] = useState(false);
  const [audio, setAudio] = useState(false);
  const [screen, setScreen] = useState(false);
  const [showModal, setModal] = useState(true);
  const [screenAvailable, setScreenAvailable] = useState(false);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [newMessages, setNewMessages] = useState(0);
  const [askForUsername, setAskForUsername] = useState(true);
  const [username, setUsername] = useState("");
  const [videos, setVideos] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    getPermissions();
  }, []);

  useEffect(() => {
    if (video !== undefined && audio !== undefined) {
      getUserMedia();
    }
  }, [video, audio]);

  useEffect(() => {
    if (screen !== undefined) {
      getDislayMedia();
    }
  }, [screen]);

  const getPermissions = async () => {
    try {
      try {
        await navigator.mediaDevices.getUserMedia({ video: true });
        setVideoAvailable(true);
      } catch {
        setVideoAvailable(false);
      }
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        setAudioAvailable(true);
      } catch {
        setAudioAvailable(false);
      }
      setScreenAvailable(!!navigator.mediaDevices.getDisplayMedia);
      if (videoAvailable || audioAvailable) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoAvailable,
          audio: audioAvailable
        });
        window.localStream = stream;
        if (localVideoref.current) {
          localVideoref.current.srcObject = stream;
        }
        connectToSocketServer();
      }
    } catch (error) {
      console.error(error);
    }
  };

  const getUserMedia = () => {
    if ((video && videoAvailable) || (audio && audioAvailable)) {
      navigator.mediaDevices.getUserMedia({ video: video, audio: audio })
        .then(getUserMediaSuccess)
        .catch((e) => console.log(e));
    }
  };

  const getUserMediaSuccess = (stream) => {
    if (window.localStream) {
      window.localStream.getTracks().forEach(track => track.stop());
    }
    window.localStream = stream;
    if (localVideoref.current) {
      localVideoref.current.srcObject = stream;
    }
    for (let id in connections) {
      if (id !== socketIdRef.current) {
        stream.getTracks().forEach(track => {
          try {
            connections[id].addTrack(track, stream);
          } catch (e) {
            console.error('addTrack error', e);
          }
        });
        createAndSendOffer(connections[id], id);
      }
    }
  };

  const getDislayMedia = () => {
    if (screen) {
      if (navigator.mediaDevices.getDisplayMedia) {
        navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
          .then(getDislayMediaSuccess)
          .catch(e => console.log(e));
      }
    }
  };

  const getDislayMediaSuccess = (stream) => {
    if (window.localStream) {
      window.localStream.getTracks().forEach(track => track.stop());
    }
    window.localStream = stream;
    if (localVideoref.current) {
      localVideoref.current.srcObject = stream;
    }
    for (let id in connections) {
      if (id !== socketIdRef.current) {
        stream.getTracks().forEach(track => {
          try {
            connections[id].addTrack(track, stream);
          } catch (e) {
            console.error('addTrack error', e);
          }
        });
        createAndSendOffer(connections[id], id);
      }
    }
  };

  const createAndSendOffer = async (pc, targetId) => {
    try {
      const desc = await pc.createOffer();
      await pc.setLocalDescription(desc);
      socketRef.current.emit("signal", targetId, JSON.stringify({ sdp: pc.localDescription }));
    } catch (e) {
      console.error("create/send offer error:", e);
    }
  };

  const handleSdp = async (fromId, sdp) => {
    try {
      if (!connections[fromId]) return;
      await connections[fromId].setRemoteDescription(new RTCSessionDescription(sdp));
      if (sdp.type === "offer") {
        const answer = await connections[fromId].createAnswer();
        await connections[fromId].setLocalDescription(answer);
        socketRef.current.emit("signal", fromId, JSON.stringify({ sdp: connections[fromId].localDescription }));
      }
    } catch (e) {
      console.error("handleSdp error:", e);
    }
  };

  const gotMessageFromServer = (fromId, message) => {
    const signal = JSON.parse(message);
    if (fromId !== socketIdRef.current) {
      if (signal.sdp) {
        handleSdp(fromId, signal.sdp);
      }
      if (signal.ice) {
        if (connections[fromId]) {
          connections[fromId].addIceCandidate(new RTCIceCandidate(signal.ice)).catch(e => console.error(e));
        }
      }
    }
  };

  const connectToSocketServer = () => {
    socketRef.current = io.connect(server_url, { secure: false });

    socketRef.current.on("signal", gotMessageFromServer);

    socketRef.current.on("connect", () => {
      socketIdRef.current = socketRef.current.id;
      socketRef.current.emit("join-call", window.location.href);

      socketRef.current.on("chat-message", addMessage);

      socketRef.current.on("user-left", (id) => {
        setVideos(videos => videos.filter(v => v.socketId !== id));
      });

      socketRef.current.on("user-joined", (id, clients) => {
        clients.forEach((socketListId) => {
          if (!connections[socketListId]) {
            connections[socketListId] = new RTCPeerConnection(peerConfigConnections);

            const pc = connections[socketListId];

            pc.onicecandidate = event => {
              if (event.candidate) {
                socketRef.current.emit("signal", socketListId, JSON.stringify({ ice: event.candidate }));
              }
            };

            pc.onnegotiationneeded = async () => {
              try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                socketRef.current.emit("signal", socketListId, JSON.stringify({ sdp: pc.localDescription }));
              } catch (e) {
                console.error('Negotiation error:', e);
              }
            };

            pc.ontrack = event => {
              const videoExists = videoRef.current.find(v => v.socketId === socketListId);
              if (!videoExists) {
                const remoteStream = new MediaStream([event.track]);
                setVideos(prev => {
                  const updated = [...prev, { socketId: socketListId, stream: remoteStream }];
                  videoRef.current = updated;
                  return updated;
                });
              } else {
                videoExists.stream.addTrack(event.track);
                setVideos(prev => [...prev]);
              }
            };

            if (window.localStream) {
              window.localStream.getTracks().forEach(track => {
                try {
                  pc.addTrack(track, window.localStream);
                } catch (e) {
                  console.error('addTrack failed', e);
                }
              });
            }
          }
        });
      });
    });
  };

  const addMessage = (data, sender) => {
    setMessages(prev => [...prev, { sender, data }]);
    setNewMessages(prev => prev + 1);
  };

  const sendMessage = async () => {
    if (!message.trim()) return;
    if (message.startsWith("@ai")) {
      setAiLoading(true);
      try {
        const res = await fetch(`${server_url}/api/v1/ai/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: message.replace("@ai", "").trim() }),
        });
        const data = await res.json();
        socketRef.current.emit("chat-message", data.reply || "No response from AI", "AI");
      } catch (e) {
        console.error("AI error:", e);
      } finally {
        setAiLoading(false);
      }
    } else {
      socketRef.current.emit("chat-message", message, username);
    }
    setMessage("");
  };

  const getMedia = () => {
    setVideo(videoAvailable);
    setAudio(audioAvailable);
  };

  const handleVideo = () => {
    setVideo(!video);
  };

  const handleAudio = () => {
    setAudio(!audio);
  };

  const handleScreen = () => {
    setScreen(!screen);
  };

  const handleEndCall = () => {
    try {
      let tracks = localVideoref.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
    } catch (e) {}
    window.location.href = "/";
  };

  const openChat = () => {
    setModal(true);
    setNewMessages(0);
  };

  const closeChat = () => {
    setModal(false);
  };

  const handleMessage = (e) => {
    setMessage(e.target.value);
  };

  const connect = () => {
    setAskForUsername(false);
    getMedia();
  };

  return (
    <div>
      {askForUsername ? (
        <div>
          <h2>Enter into Lobby</h2>
          <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} variant="outlined" />
          <Button variant="contained" onClick={connect}>Connect</Button>
          <div>
            <video ref={localVideoref} autoPlay muted playsInline />
          </div>
        </div>
      ) : (
        <div className={styles.meetVideoContainer}>
          {showModal && (
            <div className={styles.chatRoom}>
              <div className={styles.chatContainer}>
                <h1>Chat</h1>
                <div className={styles.chattingDisplay}>
                  {messages.length ? (
                    messages.map((item, index) => (
                      <div key={index} style={{ marginBottom: "20px" }}>
                        <p style={{ fontWeight: "bold" }}>{item.sender}</p>
                        <p>{item.data}</p>
                      </div>
                    ))
                  ) : (
                    <p>No Messages Yet</p>
                  )}
                  {aiLoading && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                      <CircularProgress size={20} />
                      <span>AI is typing...</span>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
                <div className={styles.chattingArea}>
                  <TextField value={message} onChange={handleMessage} label="Enter Your chat" variant="outlined" />
                  <Button variant="contained" onClick={sendMessage}>Send</Button>
                </div>
              </div>
            </div>
          )}
          <div className={styles.buttonContainers}>
            <IconButton onClick={handleVideo} style={{ color: "white" }}>
              {video ? <VideocamIcon /> : <VideocamOffIcon />}
            </IconButton>
            <IconButton onClick={handleEndCall} style={{ color: "red" }}>
              <CallEndIcon />
            </IconButton>
            <IconButton onClick={handleAudio} style={{ color: "white" }}>
              {audio ? <MicIcon /> : <MicOffIcon />}
            </IconButton>
            {screenAvailable && (
              <IconButton onClick={handleScreen} style={{ color: "white" }}>
                {screen ? <StopScreenShareIcon /> : <ScreenShareIcon />}
              </IconButton>
            )}
            <Badge badgeContent={newMessages} max={999} color="orange">
              <IconButton onClick={() => setModal(!showModal)} style={{ color: "white" }}>
                <ChatIcon />
              </IconButton>
            </Badge>
          </div>
          <video className={styles.meetUserVideo} ref={localVideoref} autoPlay muted playsInline />
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
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

