// main.js - Electron main process
const { app, BrowserWindow, Tray, Menu, clipboard, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const io = require('socket.io-client');

let mainWindow;
let tray;
let socket;
let isAuthenticated = false;
let lastClipboardContent = '';
let clipboardCheckInterval;

// Server configuration
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

// Store user credentials (use secure storage in production)
let userToken = null;
let userId = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    },
    // icon: path.join(__dirname, 'assets/icon.png'), // Comment out for now
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    resizable: false
  });

  mainWindow.loadFile('index.html');
  
  // Hide window on close, don't quit app
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Use a simple text label if icon is missing
  try {
    const iconPath = path.join(__dirname, 'assets/tray-icon.png');
    if (require('fs').existsSync(iconPath)) {
      tray = new Tray(iconPath);
    } else {
      // Create tray without icon on macOS (will show text)
      if (process.platform === 'darwin') {
        tray = new Tray(path.join(__dirname, 'placeholder.png')); // Will fail but handle below
      }
    }
  } catch (error) {
    console.log('Tray icon not found, creating text-only tray');
    // For macOS, we can create an empty image as placeholder
    if (process.platform === 'darwin') {
      const { nativeImage } = require('electron');
      const image = nativeImage.createEmpty();
      tray = new Tray(image);
      tray.setTitle('SB'); // Show text in tray
    }
  }
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Syncboard',
      click: () => {
        mainWindow.show();
      }
    },
    {
      label: 'Clear History',
      click: () => {
        if (socket && socket.connected) {
          socket.emit('clear_history');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('Syncboard - Clipboard Sync');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

function startClipboardMonitoring() {
  clipboardCheckInterval = setInterval(() => {
    if (!isAuthenticated) return;
    
    const currentContent = clipboard.readText();
    
    if (currentContent && currentContent !== lastClipboardContent) {
      lastClipboardContent = currentContent;
      
      // Send to server
      if (socket && socket.connected) {
        socket.emit('clipboard_update', {
          content: currentContent,
          type: 'text',
          deviceId: require('os').hostname(),
          deviceName: require('os').hostname()
        });
        
        // Notify renderer
        mainWindow.webContents.send('clipboard-updated', currentContent);
      }
    }
  }, 500); // Check every 500ms
}

function stopClipboardMonitoring() {
  if (clipboardCheckInterval) {
    clearInterval(clipboardCheckInterval);
    clipboardCheckInterval = null;
  }
}

function connectSocket(token) {
  socket = io(SERVER_URL);
  
  socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('authenticate', token);
    mainWindow.webContents.send('connection-status', 'connected');
  });
  
  socket.on('clipboard_sync', (data) => {
    // Update local clipboard with synced content
    lastClipboardContent = data.content;
    clipboard.writeText(data.content);
    
    // Show notification
    mainWindow.webContents.send('show-notification', {
      title: 'Clipboard Synced',
      body: `From ${data.deviceName}: ${data.content.substring(0, 50)}...`
    });
  });
  
  socket.on('history', (history) => {
    mainWindow.webContents.send('history-update', history);
  });
  
  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    mainWindow.webContents.send('connection-status', 'disconnected');
  });
  
  socket.on('error', (error) => {
    console.error('Socket error:', error);
    mainWindow.webContents.send('error', error);
  });
}

// IPC handlers
ipcMain.handle('login', async (event, credentials) => {
  try {
    // Use net.request for Electron's built-in HTTP client
    const { net } = require('electron');
    
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'POST',
        url: `${SERVER_URL}/api/login`,
        headers: { 'Content-Type': 'application/json' }
      });
      
      let responseData = '';
      
      request.on('response', (response) => {
        response.on('data', (chunk) => {
          responseData += chunk;
        });
        
        response.on('end', () => {
          try {
            const data = JSON.parse(responseData);
            
            if (response.statusCode === 200) {
              userToken = data.token;
              userId = data.userId;
              isAuthenticated = true;
              
              connectSocket(userToken);
              startClipboardMonitoring();
              
              resolve({ success: true, data });
            } else {
              resolve({ success: false, error: data.error || 'Login failed' });
            }
          } catch (error) {
            resolve({ success: false, error: 'Invalid response from server' });
          }
        });
      });
      
      request.on('error', (error) => {
        console.error('Login request error:', error);
        resolve({ success: false, error: 'Connection failed. Is the server running?' });
      });
      
      request.write(JSON.stringify({
        ...credentials,
        deviceName: require('os').hostname()
      }));
      request.end();
    });
  } catch (error) {
    console.error('Login error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('register', async (event, credentials) => {
  try {
    const { net } = require('electron');
    
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'POST',
        url: `${SERVER_URL}/api/register`,
        headers: { 'Content-Type': 'application/json' }
      });
      
      let responseData = '';
      
      request.on('response', (response) => {
        response.on('data', (chunk) => {
          responseData += chunk;
        });
        
        response.on('end', () => {
          try {
            const data = JSON.parse(responseData);
            
            if (response.statusCode === 200) {
              userToken = data.token;
              userId = data.userId;
              isAuthenticated = true;
              
              connectSocket(userToken);
              startClipboardMonitoring();
              
              resolve({ success: true, data });
            } else {
              resolve({ success: false, error: data.error || 'Registration failed' });
            }
          } catch (error) {
            resolve({ success: false, error: 'Invalid response from server' });
          }
        });
      });
      
      request.on('error', (error) => {
        console.error('Register request error:', error);
        resolve({ success: false, error: 'Connection failed. Is the server running?' });
      });
      
      request.write(JSON.stringify({
        ...credentials,
        deviceName: require('os').hostname()
      }));
      request.end();
    });
  } catch (error) {
    console.error('Registration error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('copy-to-clipboard', (event, text) => {
  clipboard.writeText(text);
  lastClipboardContent = text;
  return true;
});

ipcMain.handle('delete-item', (event, itemId) => {
  if (socket && socket.connected) {
    socket.emit('delete_item', itemId);
  }
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  
  // Register global shortcut for quick paste from history (Cmd/Ctrl+Shift+V)
  globalShortcut.register('CommandOrControl+Shift+V', () => {
    mainWindow.show();
    mainWindow.webContents.send('show-quick-paste');
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', () => {
  stopClipboardMonitoring();
  if (socket) {
    socket.disconnect();
  }
  globalShortcut.unregisterAll();
});