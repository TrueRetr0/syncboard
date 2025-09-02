// Syncboard Backend Server
// Run with: node server.js

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// In-memory storage (use Redis or database in production)
const users = new Map();
const clipboardHistory = new Map(); // userId -> array of clipboard items
const userSockets = new Map(); // userId -> Set of socket IDs

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const MAX_HISTORY = 10;

// Helper function to broadcast to all user's devices
function broadcastToUserDevices(userId, event, data, excludeSocketId = null) {
  const sockets = userSockets.get(userId);
  if (sockets) {
    sockets.forEach(socketId => {
      if (socketId !== excludeSocketId) {
        io.to(socketId).emit(event, data);
      }
    });
  }
}

// REST API Endpoints

// Register new user
app.post('/api/register', async (req, res) => {
  const { email, password, deviceName } = req.body;
  
  if (users.has(email)) {
    return res.status(400).json({ error: 'User already exists' });
  }
  
  const hashedPassword = await bcrypt.hash(password, 10);
  const userId = Date.now().toString(); // Use UUID in production
  
  users.set(email, {
    id: userId,
    email,
    password: hashedPassword,
    devices: [{ name: deviceName, id: Date.now().toString() }]
  });
  
  clipboardHistory.set(userId, []);
  
  const token = jwt.sign({ userId, email }, JWT_SECRET);
  res.json({ token, userId });
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password, deviceName } = req.body;
  
  const user = users.get(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Add device if new
  const deviceId = Date.now().toString();
  if (!user.devices.find(d => d.name === deviceName)) {
    user.devices.push({ name: deviceName, id: deviceId });
  }
  
  const token = jwt.sign({ userId: user.id, email }, JWT_SECRET);
  res.json({ 
    token, 
    userId: user.id,
    clipboardHistory: clipboardHistory.get(user.id) || []
  });
});

// WebSocket handling
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.userId;
      
      // Track user's sockets
      if (!userSockets.has(decoded.userId)) {
        userSockets.set(decoded.userId, new Set());
      }
      userSockets.get(decoded.userId).add(socket.id);
      
      // Send current clipboard history
      socket.emit('history', clipboardHistory.get(decoded.userId) || []);
      
      console.log(`User ${decoded.userId} authenticated`);
    } catch (error) {
      socket.emit('auth_error', 'Invalid token');
      socket.disconnect();
    }
  });
  
  socket.on('clipboard_update', (data) => {
    if (!socket.userId) {
      socket.emit('error', 'Not authenticated');
      return;
    }
    
    const clipboardItem = {
      id: Date.now().toString(),
      content: data.content,
      type: data.type || 'text', // text, image, file
      timestamp: new Date().toISOString(),
      deviceId: data.deviceId,
      deviceName: data.deviceName
    };
    
    // Update history
    const history = clipboardHistory.get(socket.userId) || [];
    
    // Check for duplicate content
    const existingIndex = history.findIndex(item => 
      item.content === clipboardItem.content && item.type === clipboardItem.type
    );
    
    if (existingIndex !== -1) {
      // Move to front if duplicate
      history.splice(existingIndex, 1);
    }
    
    // Add to front
    history.unshift(clipboardItem);
    
    // Keep only MAX_HISTORY items
    if (history.length > MAX_HISTORY) {
      history.pop();
    }
    
    clipboardHistory.set(socket.userId, history);
    
    // Broadcast to all user's devices except sender
    broadcastToUserDevices(socket.userId, 'clipboard_sync', clipboardItem, socket.id);
    
    // Send updated history to all devices
    broadcastToUserDevices(socket.userId, 'history', history);
    
    console.log(`Clipboard updated for user ${socket.userId}`);
  });
  
  socket.on('clear_history', () => {
    if (!socket.userId) {
      socket.emit('error', 'Not authenticated');
      return;
    }
    
    clipboardHistory.set(socket.userId, []);
    broadcastToUserDevices(socket.userId, 'history', []);
    
    console.log(`History cleared for user ${socket.userId}`);
  });
  
  socket.on('delete_item', (itemId) => {
    if (!socket.userId) {
      socket.emit('error', 'Not authenticated');
      return;
    }
    
    const history = clipboardHistory.get(socket.userId) || [];
    const newHistory = history.filter(item => item.id !== itemId);
    clipboardHistory.set(socket.userId, newHistory);
    
    broadcastToUserDevices(socket.userId, 'history', newHistory);
    
    console.log(`Item ${itemId} deleted for user ${socket.userId}`);
  });
  
  socket.on('disconnect', () => {
    if (socket.userId && userSockets.has(socket.userId)) {
      userSockets.get(socket.userId).delete(socket.id);
      if (userSockets.get(socket.userId).size === 0) {
        userSockets.delete(socket.userId);
      }
    }
    console.log('Disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Syncboard server running on port ${PORT}`);
});

// Package.json for the server:
/*
{
  "name": "syncboard-server",
  "version": "1.0.0",
  "description": "Backend server for Syncboard clipboard sync",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.6.1",
    "cors": "^2.8.5",
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.0.2",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
*/