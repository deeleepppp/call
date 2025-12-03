const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

const users = [
  { id: 'user1', username: 'john', password: 'password123', name: 'John Doe', online: false, avatar: '👨‍💼' },
  { id: 'user2', username: 'jane', password: 'password123', name: 'Jane Smith', online: false, avatar: '👩‍💼' },
  { id: 'user3', username: 'bob', password: 'password123', name: 'Bob Wilson', online: false, avatar: '👨‍🔧' },
  { id: 'user4', username: 'alice', password: 'password123', name: 'Alice Johnson', online: false, avatar: '👩‍🔬' }
];

let connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log('✅ New connection:', socket.id);

  // Login
  socket.on('login', (data) => {
    console.log('Login attempt:', data.username);
    const user = users.find(u => u.username === data.username && u.password === data.password);
    
    if (user) {
      connectedUsers.set(socket.id, {
        socketId: socket.id,
        userId: user.id,
        username: user.username,
        name: user.name,
        avatar: user.avatar
      });
      
      user.online = true;
      
      // Get online users (excluding current user)
      const onlineUsersList = users.filter(u => u.id !== user.id).map(u => ({
        id: u.id,
        name: u.name,
        avatar: u.avatar,
        online: u.online
      }));
      
      socket.emit('login-success', {
        userId: user.id,
        name: user.name,
        avatar: user.avatar,
        users: onlineUsersList
      });
      
      // Notify all other users
      socket.broadcast.emit('user-online', {
        userId: user.id,
        name: user.name,
        avatar: user.avatar
      });
      
      console.log(`✅ ${user.name} logged in (${socket.id})`);
    } else {
      socket.emit('login-failed', { message: 'Invalid credentials' });
    }
  });

  // Start call
  socket.on('start-call', (data) => {
    const caller = connectedUsers.get(socket.id);
    
    if (!caller) {
      socket.emit('call-error', { message: 'Not authenticated' });
      return;
    }

    console.log(`📞 ${caller.name} calling ${data.targetUserId} (${data.callType})`);
    
    // Find target user
    let targetSocketId = null;
    let targetUserData = null;
    
    for (let [sockId, userData] of connectedUsers.entries()) {
      if (userData.userId === data.targetUserId) {
        targetSocketId = sockId;
        targetUserData = userData;
        break;
      }
    }

    if (targetSocketId) {
      // Send call to target
      io.to(targetSocketId).emit('incoming-call', {
        from: caller.userId,
        fromName: caller.name,
        fromAvatar: caller.avatar,
        callerSocketId: socket.id,
        callType: data.callType,
        timestamp: Date.now()
      });
      
      // Notify caller
      socket.emit('call-ringing', {
        targetUserId: data.targetUserId,
        targetName: targetUserData.name,
        targetAvatar: targetUserData.avatar,
        callType: data.callType
      });
      
    } else {
      socket.emit('call-error', { 
        message: 'User is offline or not found',
        targetUserId: data.targetUserId
      });
    }
  });

  // Accept call - FIXED
  socket.on('accept-call', (data) => {
    const receiver = connectedUsers.get(socket.id);
    
    if (data.callerSocketId && receiver) {
      console.log(`✅ ${receiver.name} accepted call from ${data.callerSocketId}`);
      
      // Get caller info
      const caller = connectedUsers.get(data.callerSocketId);
      
      if (caller) {
        // Send acceptance to caller
        io.to(data.callerSocketId).emit('call-accepted', {
          receiverSocketId: socket.id,
          receiverId: receiver.userId,
          receiverName: receiver.name,
          receiverAvatar: receiver.avatar,
          callType: data.callType || 'audio'
        });
        
        // Send confirmation to receiver
        socket.emit('call-connected', {
          callerSocketId: data.callerSocketId,
          callerId: caller.userId,
          callerName: caller.name,
          callerAvatar: caller.avatar,
          callType: data.callType || 'audio'
        });
      }
    }
  });

  // Reject call
  socket.on('reject-call', (data) => {
    if (data.callerSocketId) {
      io.to(data.callerSocketId).emit('call-rejected');
    }
  });

  // Cancel call
  socket.on('cancel-call', (data) => {
    if (data.targetSocketId) {
      io.to(data.targetSocketId).emit('call-cancelled');
    }
  });

  // WebRTC Signaling - FIXED
  socket.on('webrtc-signal', (data) => {
    console.log('📡 WebRTC Signal:', data.type, 'from:', socket.id, 'to:', data.targetSocketId);
    
    if (data.targetSocketId) {
      io.to(data.targetSocketId).emit('webrtc-signal', {
        fromSocketId: socket.id,
        type: data.type,
        data: data.data
      });
    }
  });

  // End call
  socket.on('end-call', (data) => {
    if (data.targetSocketId) {
      io.to(data.targetSocketId).emit('call-ended');
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      const userData = users.find(u => u.id === user.userId);
      if (userData) userData.online = false;
      
      connectedUsers.delete(socket.id);
      
      // Notify others
      socket.broadcast.emit('user-offline', { 
        userId: user.userId 
      });
      
      console.log(`❌ ${user.name} disconnected`);
    }
  });
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on:`);
  console.log(`   Local: http://localhost:${PORT}`);
  console.log(`   Network: http://${getLocalIP()}:${PORT}`);
  console.log('\n👥 Available Users:');
  users.forEach(user => {
    console.log(`   ${user.avatar} ${user.username} - ${user.name} (Password: ${user.password})`);
  });
});

// Function to get local IP address
function getLocalIP() {
  const interfaces = require('os').networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}