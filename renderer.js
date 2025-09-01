const { ipcRenderer } = require('electron');

let currentHistory = [];
let isLoggedIn = false;

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  // DOM elements
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const mainView = document.getElementById('main-view');
  const authView = document.getElementById('auth-view');
  const historyList = document.getElementById('history-list');
  const connectionStatus = document.getElementById('connection-status');
  const currentClipboard = document.getElementById('current-clipboard');
  const showRegisterLink = document.getElementById('show-register');
  const showLoginLink = document.getElementById('show-login');
  const clearBtn = document.getElementById('clear-btn');

  // Handle login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    console.log('Attempting login...', email);
    const result = await ipcRenderer.invoke('login', { email, password });
    
    if (result.success) {
      console.log('Login successful');
      showMainView();
      if (result.data && result.data.clipboardHistory) {
        updateHistory(result.data.clipboardHistory);
      }
    } else {
      console.error('Login failed:', result.error);
      showError(result.error || 'Login failed');
    }
  });

  // Handle register
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    
    console.log('Attempting registration...', email);
    const result = await ipcRenderer.invoke('register', { email, password });
    
    if (result.success) {
      console.log('Registration successful');
      showMainView();
      updateHistory([]);
    } else {
      console.error('Registration failed:', result.error);
      showError(result.error || 'Registration failed');
    }
  });

  // Switch between login and register
  showRegisterLink.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
  });

  showLoginLink.addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.style.display = 'none';
    loginForm.style.display = 'block';
  });

  // Clear history button
  clearBtn.addEventListener('click', () => {
    if (confirm('Clear all clipboard history?')) {
      if (socket && socket.connected) {
        socket.emit('clear_history');
      }
    }
  });

  function showMainView() {
    isLoggedIn = true;
    authView.style.display = 'none';
    mainView.style.display = 'block';
  }

  function updateHistory(history) {
    currentHistory = history || [];
    historyList.innerHTML = '';
    
    if (currentHistory.length === 0) {
      historyList.innerHTML = '<div class=\"empty-state\">No clipboard history yet</div>';
      return;
    }
    
    currentHistory.forEach((item, index) => {
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';
      
      // Truncate long content
      const displayContent = item.content.length > 100 
        ? item.content.substring(0, 100) + '...' 
        : item.content;
      
      historyItem.innerHTML = `
        <div class=\"item-content\">
          <div class=\"item-text\">${escapeHtml(displayContent)}</div>
          <div class=\"item-meta\">
            <span class=\"device-name\">${escapeHtml(item.deviceName || 'Unknown')}</span>
            <span class=\"timestamp\">${new Date(item.timestamp).toLocaleTimeString()}</span>
          </div>
        </div>
        <div class=\"item-actions\">
          <button class=\"copy-btn\" data-index=\"${index}\">Copy</button>
          <button class=\"delete-btn\" data-id=\"${item.id}\">×</button>
        </div>
      `;
      
      historyList.appendChild(historyItem);
    });
    
    // Add event listeners for copy buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(btn.getAttribute('data-index'));
        const content = currentHistory[index].content;
        ipcRenderer.invoke('copy-to-clipboard', content);
        showNotification('Copied to clipboard!');
      });
    });
    
    // Add event listeners for delete buttons
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        ipcRenderer.invoke('delete-item', id);
      });
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
      errorDiv.remove();
    }, 3000);
  }

  function showNotification(message) {
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.textContent = message;
    document.body.appendChild(notif);
    
    setTimeout(() => {
      notif.remove();
    }, 2000);
  }

  // IPC event listeners
  ipcRenderer.on('connection-status', (event, status) => {
    console.log('Connection status:', status);
    connectionStatus.textContent = status === 'connected' ? 'Online' : 'Offline';
    connectionStatus.className = `status ${status}`;
  });

  ipcRenderer.on('history-update', (event, history) => {
    console.log('History update received:', history);
    updateHistory(history);
  });

  ipcRenderer.on('clipboard-updated', (event, content) => {
    console.log('Clipboard updated:', content);
    const displayContent = content.length > 50 
      ? content.substring(0, 50) + '...' 
      : content;
    currentClipboard.textContent = displayContent;
  });

  ipcRenderer.on('show-notification', (event, data) => {
    // Check if Notification is available
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(data.title, { body: data.body });
    } else {
      showNotification(`${data.title}: ${data.body}`);
    }
  });

  ipcRenderer.on('error', (event, error) => {
    console.error('Error received:', error);
    showError(error);
  });

  ipcRenderer.on('show-quick-paste', (event) => {
    // Show quick paste UI (could be a modal or focus on history)
    if (isLoggedIn) {
      historyList.scrollTop = 0;
      if (currentHistory.length > 0) {
        historyList.firstElementChild.classList.add('highlight');
        setTimeout(() => {
          historyList.firstElementChild.classList.remove('highlight');
        }, 1000);
      }
    }
  });

  // Request notification permission
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Log that renderer is ready
  console.log('Renderer process initialized');
});

// Export for debugging
window.debugSyncboard = {
  getCurrentHistory: () => currentHistory,
  isLoggedIn: () => isLoggedIn
};