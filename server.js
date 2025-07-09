require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const webpush = require('web-push');
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;
const fetch = require('node-fetch');


const app = express();
const server = http.createServer(app);
// Increase buffer size to allow base64 audio payload (~50MB)
const io = socketIo(server, { maxHttpBufferSize: 5e7 });

const USERS_FILE = path.join(__dirname, 'users.json');
let onlineUsers = {};
let pendingOtps = {}; // { email: { otp, type, data, expires } }
const lastSeen = {};

// Track sockets per user for robust online status
const userSockets = {};

// --- Blocked Users Map ---
// { userId: [blockedUserId1, blockedUserId2, ...] }
const blockedUsersMap = {};

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- Push Notification helpers ----------------
const SUBS_FILE = path.join(__dirname, 'subs.json');
function readSubs(){ if(!fs.existsSync(SUBS_FILE)) return []; return JSON.parse(fs.readFileSync(SUBS_FILE)); }
function writeSubs(arr){ fs.writeFileSync(SUBS_FILE, JSON.stringify(arr, null, 2)); }

webpush.setVapidDetails(
  'mailto:admin@example.com',
  process.env.PUBLIC_VAPID_KEY || 'BKs7xi3aybGvk9aLkh43jqejsaH0If2I_AlvVTo_l5ewIJgSOSeW-8DDrN2oL-IwULIBPv7qom4K_KLXCKdObfE',
  process.env.PRIVATE_VAPID_KEY || 'ur3ZsP4asH4PfLuPHY6WgvL3FtcPi20zU6o54f87DDs'
);
function sendPushToUser(userId, payload){
  const list = readSubs();
  const rec = list.find(s=>s.userId===userId);
  if(!rec) return;
  webpush.sendNotification(rec.sub, JSON.stringify(payload)).catch(err=>console.warn('[push] error', err));
}
// ------------------------------------------------------------

// Helper to read users
function readUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE));
}
// Helper to write users
function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Helper to generate OTP
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Signup OTP request
app.post('/api/request-otp', async (req, res) => {
  const { email, type, name, password } = req.body;
  if (!email || !type) return res.status(400).json({ message: 'Email and type required' });
  
  // For login requests, validate email and password first
  if (type === 'login') {
    if (!password) return res.status(400).json({ message: 'Password required for login OTP' });
    
    let users = readUsers();
    const user = users.find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
  }
  
  const otp = generateOtp();
  pendingOtps[email] = {
    otp,
    type,
    data: { name, email, password },
    expires: Date.now() + 5 * 60 * 1000 // 5 min
  };
  // For demo, send OTP in response
  res.json({ message: 'OTP sent', otp });
});

// Signup endpoint (with OTP)
app.post('/api/signup', async (req, res) => {
  const { name, email, password, otp } = req.body;
  let users = readUsers();
  if (users.find(u => u.email === email)) {
    return res.status(400).json({ message: 'User already exists' });
  }
  const pending = pendingOtps[email];
  if (!pending || pending.otp !== otp || pending.type !== 'signup' || pending.data.email !== email) {
    return res.status(400).json({ message: 'Invalid or expired OTP' });
  }
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
  users.push({ name, email, password: hashedPassword });
  writeUsers(users);
  delete pendingOtps[email];
  onlineUsers[email] = true;
  res.json({ message: 'Signup successful', email });
});

// Login endpoint (with OTP)
app.post('/api/login', async (req, res) => {
  const { email, password, otp } = req.body;
  let users = readUsers();
  const user = users.find(u => u.email === email);
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  const pending = pendingOtps[email];
  if (!pending || pending.otp !== otp || pending.type !== 'login') {
    return res.status(400).json({ message: 'Invalid or expired OTP' });
  }
  onlineUsers[email] = true;
  delete pendingOtps[email];
  res.json({ message: 'Login successful', email });
});

// Get all users (for user list) and online status
app.get('/api/online-users', (req, res) => {
  const users = readUsers().map(u => ({ email: u.email, name: u.name }));
  const online = Object.keys(onlineUsers);
  res.json({ users, online, lastSeen });
});

// Logout endpoint
app.post('/api/save-sub',(req,res)=>{
  const {userId, sub}=req.body;
  if(!userId||!sub) return res.status(400).json({message:'userId and sub required'});
  let list = readSubs();
  const idx = list.findIndex(x=>x.userId===userId);
  if(idx>-1) list[idx].sub=sub; else list.push({userId, sub});
  writeSubs(list);
  res.json({message:'saved'});
});

app.post('/api/logout', (req, res) => {
  const { userId } = req.body;
  delete onlineUsers[userId];
  res.json({ message: 'Logged out' });
});

// Delete account endpoint
app.post('/api/delete-account', (req, res) => {
  const { userId, otp } = req.body;
  if (!userId || !otp) return res.status(400).json({ message: 'userId and otp required' });
  // OTP validation for delete
  const pending = pendingOtps[userId];
  if (!pending || pending.otp !== otp || pending.type !== 'delete') {
    return res.status(400).json({ message: 'Invalid or expired OTP' });
  }
  let users = readUsers();
  const originalLen = users.length;
  users = users.filter(u => u.email !== userId);
  if (users.length === originalLen) {
    return res.status(404).json({ message: 'User not found' });
  }
  writeUsers(users);
  delete onlineUsers[userId];
  delete pendingOtps[userId]; // Remove OTP after use
  res.json({ message: 'Account deleted' });
});

// Password reset endpoint
app.post('/api/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  let users = readUsers();
  const userIdx = users.findIndex(u => u.email === email);
  if (userIdx === -1) {
    return res.status(404).json({ message: 'User not found' });
  }
  const pending = pendingOtps[email];
  if (!pending || pending.otp !== otp || pending.type !== 'forgot') {
    return res.status(400).json({ message: 'Invalid or expired OTP' });
  }
  const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
  users[userIdx].password = hashedPassword;
  writeUsers(users);
  delete pendingOtps[email];
  res.json({ message: 'Password reset successful' });
});

const MESSAGES_FILE = path.join(__dirname, 'messages.json');
function readMessages() {
  if (!fs.existsSync(MESSAGES_FILE)) return [];
  return JSON.parse(fs.readFileSync(MESSAGES_FILE));
}
function writeMessages(messages) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}
function saveMessage(msg) {
  // Ensure id is always a string
  if (!msg.id) {
    msg.id = Date.now().toString(36) + Math.random().toString(36).substr(2,5);
  } else {
    msg.id = String(msg.id);
  }
  const messages = readMessages();
  messages.push(msg);
  writeMessages(messages);
  console.log('[saveMessage] Saved message with id:', msg.id);
}

// Socket.IO for chat
io.on('connection', (socket) => {
  console.log(`[Socket.IO] A user connected with socket ID: ${socket.id}`);
  let currentUser = null;


  // Client will explicitly emit 'join' once it knows its userId. If desired, auto-join can be implemented here after user auth.
  socket.on('join', (userId) => {
    console.log(`[Socket.IO] Socket ID ${socket.id} is joining room: ${userId}`);
    currentUser = userId;
    socket.join(userId);
    onlineUsers[userId] = true; // Mark user as online on join
    // Track socket for this user
    if (!userSockets[userId]) userSockets[userId] = new Set();
    userSockets[userId].add(socket.id);
    console.log(`[Socket.IO] User ${userId} now has sockets:`, Array.from(userSockets[userId]));
  });

  // (Remove all block/unblock logic and events)

  socket.on('send_message', ({ to, from, message, id }) => {
    console.log(`[Socket.IO] Received message from ${from} to ${to}. Broadcasting to rooms: [${to}, ${from}]`);
    const messageData = { from, to, message, id: id || Date.now().toString(36)+Math.random().toString(36).substr(2,5), time: new Date() };
    io.to(to).emit('receive_message', messageData);
    io.to(from).emit('receive_message', messageData);
    // Save to messages.json
    saveMessage({
      id: messageData.id,
      from,
      to,
      type: 'text',
      content: message,
      timestamp: messageData.time
    });
    try{sendPushToUser(to,{title:'New message', body:`${from}: ${message}`, url:`/chat.html?userId=${from}`});}catch(e){}
  });

  socket.on('send_image', ({ to, from, image, id }) => {
    console.log(`[Socket.IO] Received image from ${from} to ${to}. Broadcasting to rooms: [${to}, ${from}]`);
    const imageData = { from, to, image, id: id || Date.now().toString(36)+Math.random().toString(36).substr(2,5), time: new Date() };
    io.to(to).emit('receive_image', imageData);
    io.to(from).emit('receive_image', imageData);
    // Save to messages.json
    saveMessage({
      id: imageData.id,
      from,
      to,
      type: 'image',
      content: image, // base64 or url
      timestamp: imageData.time
    });
  });

  // Voice message transfer
  socket.on('send_voice', ({ to, from, audioType, dataUrl, id }) => {
    console.log(`[Socket.IO] Voice message from ${from} to ${to}`);
    const voiceData = { from, to, audioType, dataUrl, id: id || Date.now().toString(36)+Math.random().toString(36).substr(2,5), time: new Date() };
    io.to(to).emit('receive_voice', voiceData);
    io.to(from).emit('receive_voice', voiceData);
    // Save to messages.json
    saveMessage({
      id: voiceData.id,
      from,
      to,
      type: 'voice',
      content: { audioType, dataUrl },
      timestamp: voiceData.time
    });
  });

  // Generic file transfer (e.g., PDF, docx, etc.)
  socket.on('send_file', ({ to, from, fileName, fileType, dataUrl, id }) => {
  });

  // Generic file transfer (e.g., PDF, docx, etc.)
  socket.on('send_file', ({ to, from, fileName, fileType, dataUrl, id }) => {
    console.log(`[Socket.IO] Received file '${fileName}' (${fileType}) from ${from} to ${to}. Broadcasting.`);
    const fileData = { from, to, fileName, fileType, dataUrl, id: id || Date.now().toString(36)+Math.random().toString(36).substr(2,5), time: new Date() };
    io.to(to).emit('receive_file', fileData);
    io.to(from).emit('receive_file', fileData);
    // Save to messages.json
    saveMessage({
      id: fileData.id,
      from,
      to,
      type: 'file',
      content: { fileName, fileType, dataUrl },
      timestamp: fileData.time
    });
  });

  // delete messages
  socket.on('delete_message', ({ ids, to, from }) => {
    console.log(`[Socket.IO] Delete request for ids ${JSON.stringify(ids)} from ${from} affecting ${to}`);
    console.log('[Socket.IO] typeof incoming ids:', ids.map(id => typeof id));
    io.to(to).emit('delete_message', { ids });
    io.to(from).emit('delete_message', { ids });
    // Remove from messages.json
    if (Array.isArray(ids) && ids.length > 0) {
      let allMessages = readMessages();
      const before = allMessages.length;
      // Log all message ids for debug
      console.log('All message ids in file:', allMessages.map(m => m.id));
      console.log('typeof all message ids:', allMessages.map(m => typeof m.id));
      console.log('Full messages:', allMessages);
      // Compare as strings for robustness
      const idsStr = ids.map(String);
      const allIdsStr = allMessages.map(m => String(m.id));
      console.log('Comparing incoming ids:', idsStr, 'with all message ids:', allIdsStr);
      allMessages = allMessages.filter(m => !idsStr.includes(String(m.id)));
      const after = allMessages.length;
      writeMessages(allMessages);
      if (before - after === 0) {
        console.warn('No messages were deleted! Check id format.');
      } else {
        console.log(`Deleted ${before - after} messages from messages.json`);
      }
      // For debug: print the new messages.json content
      console.log('messages.json after delete:', allMessages);
    }
  });

  // Voice call signaling
  socket.on('call_user', ({ to, from, offer }) => {
    console.log(`[Socket.IO] ${from} is calling ${to}`);
    console.log('DEBUG - Server received call_user with from:', from, 'to:', to);
    console.log('DEBUG - Server sending incoming_call to room:', to, 'with from:', from);
    console.log('DEBUG - Current user in this socket:', currentUser);
    console.log('DEBUG - Socket rooms:', socket.rooms);
    console.log('DEBUG - About to emit incoming_call to room:', to);
    io.to(to).emit('incoming_call', { from, offer });
    console.log('DEBUG - Emitted incoming_call to room:', to, 'with from:', from);
    try{sendPushToUser(to,{title:'Incoming call from ' + from, body:`${from} is calling you…`, url:`/chat.html?userId=${from}`});}catch(e){}
  });

  socket.on('call_signal', ({ to, from, data }) => {
    io.to(to).emit('call_signal', { from, data });
  });

  socket.on('end_call', ({ to, from }) => {
    io.to(to).emit('call_ended');
    io.to(from).emit('call_ended');
  });

    // video signalling
  socket.on('video_call',({to,from,offer})=>{io.to(to).emit('incoming_video',{from,offer});
  try{sendPushToUser(to,{title:'Incoming video call from ' + from, body:`${from} is video calling you…`, url:`/chat.html?userId=${from}`});}catch(e){}
});
  socket.on('video_signal',({to,from,data})=>{io.to(to).emit('video_signal',{from,data});});
  socket.on('video_end',({to,from})=>{io.to(to).emit('video_ended');io.to(from).emit('video_ended');});

  // Check if user is blocked by peer
  socket.on('check_blocked', ({ user, peer }) => {
    // user = currentUserId, peer = chattingWith
    const blocked = blockedUsersMap[peer] && blockedUsersMap[peer].includes(user);
    socket.emit('blocked_state', { blocked });
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      if (userSockets[currentUser]) {
        userSockets[currentUser].delete(socket.id);
        if (userSockets[currentUser].size === 0) {
          delete onlineUsers[currentUser]; // Only remove if no sockets left
          delete userSockets[currentUser];
          lastSeen[currentUser] = Date.now(); // Track last seen
          console.log(`[Socket.IO] User ${currentUser} is now offline. Last seen: ${new Date(lastSeen[currentUser])}`);
        } else {
          console.log(`[Socket.IO] User ${currentUser} still has sockets:`, Array.from(userSockets[currentUser]));
        }
      }
    }
  });
});

app.get('/api/all-users', (req, res) => {
  fs.readFile('./massanger/users.json', 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Could not read users.' });
    let users = [];
    try { users = JSON.parse(data); } catch { users = []; }
    res.json({ users: users.map(u => ({ name: u.name, email: u.email })) });
  });
});

// API to get all messages between two users
app.get('/api/messages', (req, res) => {
  try {
    const { user, peer } = req.query;
    if (!user || !peer) return res.status(400).json({ error: 'user and peer required' });
    const messages = readMessages().filter(m =>
      (m.from === user && m.to === peer) || (m.from === peer && m.to === user)
    ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    res.json({ messages });
  } catch (e) {
    console.error('Error in /api/messages:', e);
    res.status(500).json({ error: 'Internal Server Error', details: e.message });
  }
});

app.get('/api/users', (req, res) => {
  fs.readFile('./users.json', 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Failed to read users.json' });
    try {
      const users = JSON.parse(data);
      res.json(users);
    } catch (e) {
      res.status(500).json({ error: 'Invalid users.json' });
    }
  });
});

// Proxy endpoint for emojis
app.get('/api/emojis', async (req, res) => {
  try {
    const response = await fetch('https://www.emoji.family/api/emojis');
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch emojis' });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch emojis' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
