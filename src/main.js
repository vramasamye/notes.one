const { app, BrowserWindow, Tray, Menu, globalShortcut, clipboard, dialog, ipcMain, systemPreferences, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const NotesDatabase = require('./database');
const EncryptedNotesDatabase = require('./database-encrypted');
const SettingsManager = require('./settings');
const logger = require('./logger');

const { uIOhook, UiohookKey } = require('uiohook-napi');

class NotesApp {
  constructor() {
    this.mainWindow = null;
    this.settingsWindow = null;
    this.encryptionWindow = null;
    this.updateProgressWindow = null;
    this.tray = null;
    this.db = new NotesDatabase();
    this.encryptedDb = new EncryptedNotesDatabase();
    this.settings = new SettingsManager();
    this.currentShortcut = null;
    this.useEncryption = false;
    this.isDbInitialized = false;
    
    // Double key press detection
    this.lastKeyPressTime = 0;
    this.doubleKeyPressTimeout = 500; // 500ms window for double press
    this.isDoubleKeyEnabled = false;
    this.uiohookStarted = false;
    this.targetKeyCode = null; // Will store the keycode for the target key
    this.shortcutName = null; // Human-readable name for the shortcut

    // Capture de-duplication
    this.lastCapturedText = '';
    this.lastCapturedAt = 0;
  }

  async initialize() {
    try {
      logger.initialize();
      logger.info('Starting notes.one application', { 
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch
      });

      // Clean up old logs
      logger.cleanupOldLogs();

      // Check accessibility permissions
      const isTrusted = systemPreferences.isTrustedAccessibilityClient(true);
      if (!isTrusted) {
        logger.warn('Accessibility permissions not granted');
        dialog.showErrorBox(
          'Accessibility Permissions Required',
          'Please grant accessibility permissions to notes.one in System Settings > Privacy & Security > Accessibility, then restart the app.'
        );
      } else {
        logger.info('Accessibility permissions granted');
      }

      await this.settings.initialize();
      logger.info('Settings initialized');
      
      // Check if user wants to use encryption
      const useEncryption = this.settings.getSetting('useEncryption');
      if (useEncryption) {
        logger.info('Encryption enabled, initializing encrypted database');
        this.useEncryption = true;
        await this.initializeEncryptedDatabase();
      } else {
        logger.info('Using regular database');
        this.db.initialize();
        this.isDbInitialized = true;
      }
      
      this.setupGlobalShortcuts();
      this.setupIpcHandlers();
      this.setupAutoUpdater();
      this.createTray();
      
      logger.info('Application initialization completed successfully');
    } catch (error) {
      logger.error('Failed to initialize application', error);
      dialog.showErrorBox('Initialization Error', 
        `Failed to start notes.one: ${error.message}\n\nCheck the logs for more details.`);
      app.quit();
    }
  }

  setupAutoUpdater() {
    // Configure auto-updater settings
    autoUpdater.autoDownload = false; // Don't auto-download, ask user first
    autoUpdater.autoInstallOnAppQuit = true;
    
    // Development vs Production handling
    if (!app.isPackaged) {
      console.log('Development mode - auto-updater disabled');
      return;
    }
    
    // Check for updates on startup (after 3 seconds delay)
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify();
    }, 3000);
    
    // Check for updates every 6 hours
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify();
    }, 6 * 60 * 60 * 1000);
    
    autoUpdater.on('checking-for-update', () => {
      logger.info('Checking for updates...');
    });
    
    autoUpdater.on('update-available', (info) => {
      logger.info('Update available', { version: info.version, releaseDate: info.releaseDate });
      
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `A new version (${info.version}) is available.`,
        detail: 'Would you like to download and install it now?',
        buttons: ['Download Now', 'View Release Notes', 'Remind Me Later'],
        defaultId: 0,
        cancelId: 2
      }).then((result) => {
        if (result.response === 0) {
          // Download now
          autoUpdater.downloadUpdate();
          this.showUpdateProgress();
        } else if (result.response === 1) {
          // View release notes
          shell.openExternal(`https://github.com/yourusername/notes.one/releases/tag/v${info.version}`);
        }
        // Response 2 (Remind Me Later) does nothing
      });
    });
    
    autoUpdater.on('update-not-available', () => {
      logger.info('No updates available');
    });
    
    autoUpdater.on('error', (err) => {
      logger.error('Auto-updater error', err);
      if (this.updateProgressWindow) {
        this.updateProgressWindow.close();
        this.updateProgressWindow = null;
      }
    });
    
    autoUpdater.on('download-progress', (progressObj) => {
      const logData = {
        percent: Math.round(progressObj.percent),
        transferred: this.formatBytes(progressObj.transferred),
        total: this.formatBytes(progressObj.total),
        speed: this.formatBytes(progressObj.bytesPerSecond)
      };
      logger.debug('Update download progress', logData);
      
      // Update progress window if open
      if (this.updateProgressWindow) {
        this.updateProgressWindow.webContents.send('update-progress', {
          percent: Math.round(progressObj.percent),
          transferred: this.formatBytes(progressObj.transferred),
          total: this.formatBytes(progressObj.total),
          speed: this.formatBytes(progressObj.bytesPerSecond)
        });
      }
    });
    
    autoUpdater.on('update-downloaded', (info) => {
      logger.info('Update downloaded successfully', { version: info.version });
      
      if (this.updateProgressWindow) {
        this.updateProgressWindow.close();
        this.updateProgressWindow = null;
      }
      
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} has been downloaded and is ready to install.`,
        detail: 'The application will restart to apply the update. All open windows will be closed.',
        buttons: ['Restart Now', 'Restart Later'],
        defaultId: 0
      }).then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    });
  }
  
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  showUpdateProgress() {
    if (this.updateProgressWindow) {
      this.updateProgressWindow.focus();
      return;
    }
    
    this.updateProgressWindow = new BrowserWindow({
      width: 400,
      height: 200,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      title: 'Downloading Update',
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      modal: true,
      parent: this.mainWindow
    });
    
    this.updateProgressWindow.once('ready-to-show', () => {
      this.updateProgressWindow.show();
    });
    
    const progressHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Downloading Update</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 30px;
            background: #f5f5f5;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: calc(100vh - 60px);
          }
          .progress-container {
            width: 100%;
            max-width: 300px;
            text-align: center;
          }
          .progress-bar {
            width: 100%;
            height: 8px;
            background: #e0e0e0;
            border-radius: 4px;
            overflow: hidden;
            margin: 20px 0;
          }
          .progress-fill {
            height: 100%;
            background: #007AFF;
            width: 0%;
            transition: width 0.3s ease;
          }
          .progress-text {
            color: #333;
            font-size: 14px;
            margin-bottom: 10px;
          }
          .progress-details {
            color: #666;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <div class="progress-container">
          <div class="progress-text">Downloading update...</div>
          <div class="progress-bar">
            <div class="progress-fill" id="progressFill"></div>
          </div>
          <div class="progress-details" id="progressDetails">Preparing download...</div>
        </div>
        
        <script>
          const { ipcRenderer } = require('electron');
          
          ipcRenderer.on('update-progress', (event, data) => {
            document.getElementById('progressFill').style.width = data.percent + '%';
            document.getElementById('progressDetails').textContent = 
              \`\${data.percent}% (\${data.transferred}/\${data.total}) at \${data.speed}/s\`;
          });
        </script>
      </body>
      </html>
    `;
    
    this.updateProgressWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(progressHtml)}`);
    
    this.updateProgressWindow.on('closed', () => {
      this.updateProgressWindow = null;
    });
  }

  setupIpcHandlers() {
    // Database handlers
    ipcMain.handle('database-get-notes', async (event, limit, offset) => {
      const db = this.useEncryption ? this.encryptedDb : this.db;
      const notes = await db.getNotes(limit, offset);
      const count = await db.getNotesCount();
      return { notes, count };
    });

    ipcMain.handle('database-search-notes', async (event, query, limit, offset) => {
      const db = this.useEncryption ? this.encryptedDb : this.db;
      const notes = await db.searchNotes(query, limit, offset);
      const count = await db.getSearchCount(query);
      return { notes, count };
    });

    ipcMain.handle('database-delete-note', async (event, noteId) => {
      const db = this.useEncryption ? this.encryptedDb : this.db;
      return await db.deleteNote(noteId);
    });

    // Version history handlers
    ipcMain.handle('database-get-note-history', async (event, noteId) => {
      const db = this.useEncryption ? this.encryptedDb : this.db;
      if (db.getNoteHistory) {
        return await db.getNoteHistory(noteId);
      }
      return [];
    });

    ipcMain.handle('database-restore-note-version', async (event, noteId, version) => {
      const db = this.useEncryption ? this.encryptedDb : this.db;
      if (db.restoreNoteVersion) {
        return await db.restoreNoteVersion(noteId, version);
      }
      return false;
    });

    ipcMain.handle('database-update-note', async (event, noteId, content) => {
      const db = this.useEncryption ? this.encryptedDb : this.db;
      if (db.updateNote) {
        return await db.updateNote(noteId, content);
      }
      return false;
    });

    // Encryption handlers
    ipcMain.handle('encryption-setup', async (event, password) => {
      try {
        const result = await this.encryptedDb.initialize(password);
        if (result.success) {
          this.useEncryption = true;
          this.isDbInitialized = true;
          await this.settings.saveSettings({ useEncryption: true });
        }
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('encryption-status', () => {
      if (this.useEncryption) {
        return this.encryptedDb.getEncryptionStatus();
      }
      return { isEnabled: false, hasKey: false };
    });

    ipcMain.handle('encryption-change-password', async (event, oldPassword, newPassword) => {
      if (this.useEncryption) {
        return await this.encryptedDb.changeEncryptionPassword(oldPassword, newPassword);
      }
      return { success: false, error: 'Encryption not enabled' };
    });

    ipcMain.handle('database-get-stats', async () => {
      const db = this.useEncryption ? this.encryptedDb : this.db;
      return db.getStats();
    });

    // Settings handlers
    ipcMain.handle('get-settings', () => {
      return this.settings.getSettings();
    });

    ipcMain.handle('save-settings', async (event, newSettings) => {
      const result = await this.settings.saveSettings(newSettings);
      if (result.success) {
        // Re-register global shortcut with new value
        this.setupGlobalShortcuts();
        // Update shortcut hint in main window if open
        if (this.mainWindow) {
          this.mainWindow.webContents.send('shortcut-changed', newSettings.globalShortcut);
          this.mainWindow.webContents.send('theme-changed', newSettings.theme);
        }
      }
      return result;
    });

    ipcMain.handle('test-shortcut', async (event, shortcut) => {
      try {
        // Handle double key shortcuts differently
        if (shortcut === 'DoubleRightShift' || shortcut === 'DoubleRightAlt' || 
            shortcut === 'DoubleLeftShift' || shortcut === 'DoubleLeftAlt') {
          return { success: true, shortcut };
        } else {
          // Test regular shortcuts normally
          const canRegister = globalShortcut.register(shortcut, () => {});
          if (canRegister) {
            globalShortcut.unregister(shortcut);
            return { success: true, shortcut };
          } else {
            return { success: false, error: 'Shortcut is already in use by another application' };
          }
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Debug handler for testing double key detection
    ipcMain.handle('debug-double-key', () => {
      return {
        isDoubleKeyEnabled: this.isDoubleKeyEnabled,
        uiohookStarted: this.uiohookStarted,
        targetKeyCode: this.targetKeyCode,
        shortcutName: this.shortcutName,
        currentShortcut: this.currentShortcut,
        lastKeyPressTime: this.lastKeyPressTime,
        availableKeys: {
          ShiftRight: UiohookKey.ShiftRight,
          AltRight: UiohookKey.AltRight,
          Shift: UiohookKey.Shift,
          Alt: UiohookKey.Alt
        }
      };
    });

    ipcMain.handle('check-accessibility', () => {
      return systemPreferences.isTrustedAccessibilityClient(false);
    });

    ipcMain.handle('open-accessibility-settings', () => {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    });
    
    // Asset path handler for logo resolution
    ipcMain.handle('get-assets-path', () => {
      if (app.isPackaged) {
        return path.join(process.resourcesPath, 'assets');
      } else {
        return path.join(__dirname, '../assets');
      }
    });

    // Window management
    ipcMain.on('close-settings', () => {
      if (this.settingsWindow) {
        this.settingsWindow.close();
      }
    });

    ipcMain.on('settings-changed', (event, settings) => {
      if (this.mainWindow) {
        this.mainWindow.webContents.send('settings-changed', settings);
      }
    });

    ipcMain.on('open-settings-window', () => {
      this.createSettingsWindow();
    });
  }

  setupGlobalShortcuts() {
    // Stop uIOhook monitoring if it was running
    this.stopUiohookMonitoring();
    this.isDoubleKeyEnabled = false;
    
    // Unregister existing shortcuts if any
    if (this.actualRegisteredKey) {
      globalShortcut.unregister(this.actualRegisteredKey);
      logger.info('Unregistered previous shortcut', { shortcut: this.actualRegisteredKey });
    }
    
    // Clean up any possible registered keys
    const possibleKeys = ['Right+Shift', 'RightShift', 'Shift', 'Right+Alt', 'RightAlt', 'Alt', 'Option', 'Right+Option', 'RightOption'];
    possibleKeys.forEach(key => {
      try {
        globalShortcut.unregister(key);
      } catch (e) {
        // Ignore errors for keys that weren't registered
      }
    });

    // Get shortcut from settings
    const shortcut = this.settings.getSetting('globalShortcut') || 'CommandOrControl+Shift+C';
    logger.info('Setting up global shortcut', { shortcut });
    
    // Check if double key press shortcuts are enabled
    if (shortcut === 'DoubleRightShift' || shortcut === 'DoubleRightAlt' || 
        shortcut === 'DoubleLeftShift' || shortcut === 'DoubleLeftAlt') {
      this.setupDoubleKeyShortcut(shortcut);
      this.currentShortcut = shortcut;
      return;
    }
    
    // Setup regular global shortcut
    try {
      const registered = globalShortcut.register(shortcut, () => {
        this.captureSelection();
      });
      
      if (registered) {
        this.currentShortcut = shortcut;
        this.actualRegisteredKey = shortcut;
        logger.info('Global shortcut registered successfully', { shortcut });
      } else {
        logger.error('Failed to register global shortcut', { shortcut });
        // Fallback to default if custom shortcut fails
        if (shortcut !== 'CommandOrControl+Shift+C') {
          const fallbackRegistered = globalShortcut.register('CommandOrControl+Shift+C', () => {
            this.captureSelection();
          });
          if (fallbackRegistered) {
            this.currentShortcut = 'CommandOrControl+Shift+C';
            this.actualRegisteredKey = 'CommandOrControl+Shift+C';
            logger.warn('Using fallback shortcut', { fallback: 'CommandOrControl+Shift+C' });
          }
        }
      }
    } catch (error) {
      logger.error('Error registering global shortcut', error);
    }
  }

  setupDoubleKeyShortcut(shortcutType) {
    // Use correct key codes from uIOhook constants
    if (shortcutType === 'DoubleRightShift') {
      this.targetKeyCode = UiohookKey.ShiftRight; // 54
      this.shortcutName = 'Right Shift';
    } else if (shortcutType === 'DoubleRightAlt') {
      this.targetKeyCode = UiohookKey.AltRight; // 3640  
      this.shortcutName = 'Right Alt/Option';
    } else if (shortcutType === 'DoubleLeftShift') {
      this.targetKeyCode = UiohookKey.Shift; // 42
      this.shortcutName = 'Left Shift';
    } else if (shortcutType === 'DoubleLeftAlt') {
      this.targetKeyCode = UiohookKey.Alt; // 56
      this.shortcutName = 'Left Alt/Option';
    } else {
      logger.error('Unknown double key shortcut type', { shortcutType });
      return;
    }
    
    logger.info('Setting up double key shortcut', { 
      shortcutType, 
      keyCode: this.targetKeyCode,
      keyName: this.shortcutName 
    });
    
    this.startUiohookMonitoring();
  }

  startUiohookMonitoring() {
    if (!uIOhook) {
      logger.error('uIOhook not available');
      return;
    }

    if (this.uiohookStarted) {
      logger.debug('uIOhook already started');
      return;
    }

    try {
      // Stop any existing uIOhook instance
      this.stopUiohookMonitoring();
      
      logger.info('Starting uIOhook monitoring', { 
        targetKeyCode: this.targetKeyCode,
        shortcutName: this.shortcutName 
      });
      
      uIOhook.start();
      
      uIOhook.on('keydown', (e) => {
        logger.debug('Key press detected', { keycode: e.keycode, target: this.targetKeyCode });
        if (e.keycode === this.targetKeyCode) {
          this.handleDoubleKeyPress();
        }
      });

      uIOhook.on('keyup', (e) => {
        // Optional: Add keyup handling for more precise detection
        logger.debug('Key release detected', { keycode: e.keycode });
      });

      this.uiohookStarted = true;
      this.isDoubleKeyEnabled = true;
      logger.info('uIOhook monitoring started successfully', { shortcutName: this.shortcutName });
      
    } catch (error) {
      logger.error('Error starting uiohook', error);
      dialog.showErrorBox(
        'Input Monitoring Permissions Required',
        `Please grant input monitoring permissions to notes.one in System Settings > Privacy & Security > Input Monitoring, then restart the app.\n\nThis is required for ${this.shortcutName} double-press detection.`
      );
    }
  }

  stopUiohookMonitoring() {
    if (uIOhook && this.uiohookStarted) {
      try {
        uIOhook.stop();
        this.uiohookStarted = false;
        console.log('uiohook monitoring stopped');
      } catch (error) {
        console.error('Error stopping uiohook:', error);
      }
    }
  }

  handleDoubleKeyPress() {
    const currentTime = Date.now();
    const timeSinceLastPress = this.lastKeyPressTime ? currentTime - this.lastKeyPressTime : 0;
    
    logger.debug('Double key press handler triggered', { 
      currentTime, 
      lastKeyPressTime: this.lastKeyPressTime, 
      timeDiff: timeSinceLastPress,
      threshold: this.doubleKeyPressTimeout,
      shortcutName: this.shortcutName
    });
    
    if (this.lastKeyPressTime && timeSinceLastPress < this.doubleKeyPressTimeout) {
      // Double press detected
      logger.info('Double key press detected - triggering note capture', { 
        timeBetweenPresses: timeSinceLastPress,
        threshold: this.doubleKeyPressTimeout,
        shortcutName: this.shortcutName
      });
      
      this.captureSelection();
      this.lastKeyPressTime = 0; // Reset to prevent triple press
    } else {
      // First press or too much time passed
      logger.debug('Single key press recorded', { 
        timeDiff: timeSinceLastPress,
        threshold: this.doubleKeyPressTimeout,
        shortcutName: this.shortcutName
      });
      this.lastKeyPressTime = currentTime;
    }
  }

  setupFallbackShortcut() {
    try {
      globalShortcut.register('CommandOrControl+Shift+C', () => {
        this.captureSelection();
      });
      this.currentShortcut = 'CommandOrControl+Shift+C';
      this.isDoubleKeyEnabled = false;
    } catch (error) {
      console.error('Error setting up fallback shortcut:', error);
    }
  }

  async captureSelection() {
    logger.debug('Note capture triggered');
    
    if (!this.isDbInitialized) {
      logger.warn('Database not initialized, skipping capture');
      return;
    }
    
    try {
      // Avoid capturing from inside our own app to prevent duplicates
      if (this.mainWindow && this.mainWindow.isVisible() && this.mainWindow.isFocused()) {
        logger.info('Capture skipped: app is focused');
        return;
      }
      
      const originalClipboard = clipboard.readText();
      clipboard.clear();

      const { execSync } = require('child_process');
      
      try {
        logger.debug('Executing copy command...');
        execSync(`osascript -e 'tell application "System Events" to keystroke "c" using {command down}'`, { timeout: 1000 });
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const selectedText = clipboard.readText();
        logger.debug('Text captured from clipboard', { length: selectedText?.length || 0 });
        
        if (selectedText && selectedText.trim()) {
          const sourceInfo = await this.getSourceInfo();

          // Skip if source is our own app (dev or packaged) to avoid duplicates
          const appName = (sourceInfo.source || '').toLowerCase();
          if (appName === 'electron' || appName === 'notes.one') {
            logger.info('Capture skipped: source is notes.one/electron');
            clipboard.writeText(originalClipboard);
            return;
          }

          // De-duplicate same content captured within 10 seconds
          const now = Date.now();
          if (selectedText.trim() === this.lastCapturedText && now - this.lastCapturedAt < 10000) {
            logger.info('Capture skipped: duplicate within 10s window');
            clipboard.writeText(originalClipboard);
            return;
          }
          const note = {
            content: selectedText.trim(),
            source: sourceInfo.source,
            url: sourceInfo.url,
            timestamp: new Date().toISOString()
          };
          
          const db = this.useEncryption ? this.encryptedDb : this.db;
          await db.addNote(note);
          
          logger.info('Note saved successfully', { 
            source: sourceInfo.source, 
            contentLength: selectedText.trim().length,
            hasUrl: !!sourceInfo.url
          });
          
          // Update last capture trackers
          this.lastCapturedText = selectedText.trim();
          this.lastCapturedAt = now;

          this.showNotification('Note saved!');
          if (this.mainWindow) {
            this.mainWindow.webContents.send('reload-notes');
          }
        } else {
          logger.warn('No text was captured or clipboard was empty');
        }
        
        clipboard.writeText(originalClipboard);
        
      } catch (copyError) {
        logger.error('Failed to copy text', copyError);
        dialog.showErrorBox('Error', 'Failed to copy selected text. Make sure the app has Accessibility permissions.');
        clipboard.writeText(originalClipboard);
      }
      
    } catch (error) {
      logger.error('Failed to capture selection', error);
    }
  }

  async getSourceInfo() {
    try {
      const { execSync } = require('child_process');
      const appName = execSync(`osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`, { encoding: 'utf8' }).trim();

      let url = null;
      if (['Google Chrome', 'Brave Browser', 'Microsoft Edge', 'Safari'].includes(appName)) {
        try {
          url = execSync(`osascript -e 'tell application "${appName}" to get URL of active tab of first window'`, { encoding: 'utf8' }).trim();
        } catch (e) {
          // Ignore errors if we can't get the URL
        }
      }

      return { source: appName, url };
    } catch {
      return { source: 'Unknown Application', url: null };
    }
  }

  showNotification(message) {
    if (this.tray) {
      this.tray.displayBalloon({
        title: 'notes.one',
        content: message
      });
    }
  }

  createTray() {
    const iconName = 'tray-icon.png';
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'assets', iconName)
      : path.join(__dirname, '../assets', iconName);

    try {
      this.tray = new Tray(iconPath);
      console.log('Tray icon loaded from:', iconPath);
    } catch (error) {
      console.error('Error creating tray icon:', error);
      // Fallback to a simple text-based tray icon if image fails
      this.tray = new Tray(require('electron').nativeImage.createEmpty());
      this.tray.setTitle('N');
    }
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Notes',
        click: () => this.createMainWindow()
      },
      { type: 'separator' },
      {
        label: 'Test Note Capture',
        click: () => this.testNoteCapture()
      },
      ...(this.isDoubleKeyEnabled ? [{
        label: `Debug Double Key (${this.shortcutName})`,
        click: () => this.showDoubleKeyDebugInfo()
      }] : []),
      { type: 'separator' },
      {
        label: 'Check for Updates',
        click: () => {
          autoUpdater.checkForUpdatesAndNotify();
          dialog.showMessageBox({
            type: 'info',
            title: 'Update Check',
            message: 'Checking for updates...',
            buttons: ['OK']
          });
        }
      },
      {
        label: 'About notes.one',
        click: () => this.showAboutDialog()
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit();
        }
      }
    ]);

    this.tray.setToolTip('notes.one - Background note capture');
    this.tray.setContextMenu(contextMenu);
  }

  async testNoteCapture() {
    console.log('Manual test triggered');
    
    if (!this.isDbInitialized) {
      console.log('Database not initialized, cannot create test note');
      this.showNotification('Database not initialized');
      return;
    }
    
    const testNote = {
      content: `Test note created at ${new Date().toLocaleTimeString()}`,
      source: 'Manual Test',
      timestamp: new Date().toISOString()
    };
    
    try {
      const db = this.useEncryption ? this.encryptedDb : this.db;
      await db.addNote(testNote);
      console.log('Test note saved successfully');
      this.showNotification('Test note saved!');
    } catch (error) {
      console.error('Failed to save test note:', error);
    }
  }

  showAboutDialog() {
    const packageJson = require('../package.json');
    const version = packageJson.version;
    const appName = packageJson.name;
    
    const iconName = 'app-logo.png';
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'assets', iconName)
      : path.join(__dirname, '../assets', iconName);
    
    dialog.showMessageBox({
      type: 'info',
      title: 'About notes.one',
      message: `${appName}`,
      detail: `Version: ${version}\n\nLightweight background note capture for macOS.\n\nCapture selected text from any application using global shortcuts.`,
      buttons: ['OK'],
      defaultId: 0,
      icon: iconPath
    });
  }

  showDoubleKeyDebugInfo() {
    const debugInfo = {
      isDoubleKeyEnabled: this.isDoubleKeyEnabled,
      uiohookStarted: this.uiohookStarted,
      targetKeyCode: this.targetKeyCode,
      shortcutName: this.shortcutName,
      currentShortcut: this.currentShortcut,
      lastKeyPressTime: this.lastKeyPressTime,
      timeSinceLastPress: this.lastKeyPressTime ? Date.now() - this.lastKeyPressTime : 'N/A'
    };

    dialog.showMessageBox({
      type: 'info',
      title: 'Double Key Debug Info',
      message: `Double Key Shortcut Status`,
      detail: `Shortcut: ${debugInfo.shortcutName} (${debugInfo.currentShortcut})\n` +
              `Target Key Code: ${debugInfo.targetKeyCode}\n` +
              `Double Key Enabled: ${debugInfo.isDoubleKeyEnabled}\n` +
              `uIOhook Started: ${debugInfo.uiohookStarted}\n` +
              `Last Key Press: ${debugInfo.lastKeyPressTime || 'None'}\n` +
              `Time Since Last Press: ${debugInfo.timeSinceLastPress}ms\n\n` +
              `Try pressing ${debugInfo.shortcutName} twice quickly to test.`,
      buttons: ['OK', 'Reset Timer'],
      defaultId: 0
    }).then((result) => {
      if (result.response === 1) {
        // Reset timer
        this.lastKeyPressTime = 0;
        logger.info('Double key timer reset by user');
      }
    });
  }

  createMainWindow(openSearch = false) {
    if (this.mainWindow) {
      this.mainWindow.webContents.send('reload-notes');
      this.mainWindow.focus();
      return;
    }

    const iconName = 'app-logo.png';
    const windowIcon = app.isPackaged
      ? path.join(process.resourcesPath, 'assets', iconName)
      : path.join(__dirname, '../assets', iconName);

    this.mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      title: 'notes.one',
      icon: windowIcon,
      show: false
    });

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
      this.mainWindow.focus();
    });

    this.mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

    // Open external links in default browser, not inside the app
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });
    this.mainWindow.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });

    if (openSearch) {
      this.mainWindow.webContents.once('did-finish-load', () => {
        this.mainWindow.webContents.send('focus-search');
      });
    }

    this.mainWindow.webContents.on('did-finish-load', () => {
      const currentSettings = this.settings.getSettings();
      this.mainWindow.webContents.send('theme-changed', currentSettings.theme);
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  createSettingsWindow() {
    if (this.settingsWindow) {
      this.settingsWindow.focus();
      return;
    }

    this.settingsWindow = new BrowserWindow({
      width: 600,
      height: 700,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      title: 'Settings - notes.one',
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      modal: true,
      parent: this.mainWindow,
      titleBarStyle: 'hiddenInset'
    });

    this.settingsWindow.once('ready-to-show', () => {
      this.settingsWindow.show();
      this.settingsWindow.focus();
    });

    this.settingsWindow.loadFile(path.join(__dirname, 'renderer/settings.html'));

    this.settingsWindow.on('closed', () => {
      this.settingsWindow = null;
    });
  }

  async initializeEncryptedDatabase() {
    // Check if encryption key exists
    const fs = require('fs').promises;
    const userDataPath = app.getPath('userData');
    const keyPath = path.join(userDataPath, 'encryption.key');
    
    try {
      await fs.access(keyPath);
      // Key exists, show password prompt
      this.createEncryptionWindow('unlock');
    } catch (error) {
      // No key exists, show setup dialog
      this.createEncryptionWindow('setup');
    }
  }

  createEncryptionWindow(mode = 'setup') {
    if (this.encryptionWindow) {
      this.encryptionWindow.focus();
      return;
    }

    this.encryptionWindow = new BrowserWindow({
      width: 400,
      height: mode === 'setup' ? 500 : 300,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      title: mode === 'setup' ? 'Setup Encryption - notes.one' : 'Unlock Database - notes.one',
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      modal: true,
      titleBarStyle: 'hiddenInset'
    });

    this.encryptionWindow.once('ready-to-show', () => {
      this.encryptionWindow.show();
      this.encryptionWindow.focus();
    });

    // Create a simple HTML page for encryption setup
    const encryptionHtml = this.createEncryptionHtml(mode);
    this.encryptionWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(encryptionHtml)}`);

    this.encryptionWindow.on('closed', () => {
      this.encryptionWindow = null;
      if (!this.isDbInitialized) {
        // If user closed without setting up, use regular database
        this.db.initialize();
        this.isDbInitialized = true;
      }
    });
  }

  createEncryptionHtml(mode) {
    const isSetup = mode === 'setup';
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${isSetup ? 'Setup Encryption' : 'Unlock Database'}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
            display: flex;
            flex-direction: column;
            height: calc(100vh - 40px);
          }
          .container {
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            flex: 1;
            display: flex;
            flex-direction: column;
          }
          h2 {
            margin: 0 0 20px 0;
            color: #333;
            text-align: center;
          }
          .description {
            color: #666;
            margin-bottom: 20px;
            line-height: 1.5;
            text-align: center;
          }
          .form-group {
            margin-bottom: 15px;
          }
          label {
            display: block;
            margin-bottom: 5px;
            color: #333;
            font-weight: 500;
          }
          input[type="password"] {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
            box-sizing: border-box;
          }
          input[type="password"]:focus {
            outline: none;
            border-color: #007AFF;
          }
          .buttons {
            display: flex;
            gap: 10px;
            margin-top: auto;
            padding-top: 20px;
          }
          button {
            flex: 1;
            padding: 12px;
            border: none;
            border-radius: 4px;
            font-size: 14px;
            cursor: pointer;
            font-weight: 500;
          }
          .primary {
            background: #007AFF;
            color: white;
          }
          .primary:hover {
            background: #0056CC;
          }
          .secondary {
            background: #f0f0f0;
            color: #333;
          }
          .secondary:hover {
            background: #e0e0e0;
          }
          .error {
            color: #FF3B30;
            font-size: 12px;
            margin-top: 5px;
          }
          .warning {
            background: #FFF3CD;
            border: 1px solid #FFEAA7;
            color: #856404;
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 20px;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>${isSetup ? 'Setup Database Encryption' : 'Unlock Encrypted Database'}</h2>
          <div class="description">
            ${isSetup 
              ? 'Protect your notes with encryption. Your notes will be encrypted using AES-256 encryption with your password.'
              : 'Enter your password to unlock the encrypted database.'
            }
          </div>
          
          ${isSetup ? `
            <div class="warning">
              <strong>Important:</strong> If you forget your password, your notes cannot be recovered. Make sure to remember it or store it securely.
            </div>
          ` : ''}
          
          <form id="encryptionForm">
            <div class="form-group">
              <label for="password">${isSetup ? 'Create Password:' : 'Password:'}</label>
              <input type="password" id="password" required minlength="6">
              <div id="passwordError" class="error"></div>
            </div>
            
            ${isSetup ? `
              <div class="form-group">
                <label for="confirmPassword">Confirm Password:</label>
                <input type="password" id="confirmPassword" required minlength="6">
                <div id="confirmError" class="error"></div>
              </div>
            ` : ''}
            
            <div class="buttons">
              <button type="button" class="secondary" onclick="skipEncryption()">
                ${isSetup ? 'Skip Encryption' : 'Cancel'}
              </button>
              <button type="submit" class="primary">
                ${isSetup ? 'Setup Encryption' : 'Unlock'}
              </button>
            </div>
          </form>
        </div>
        
        <script>
          const { ipcRenderer } = require('electron');
          
          document.getElementById('encryptionForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const password = document.getElementById('password').value;
            ${isSetup ? `
              const confirmPassword = document.getElementById('confirmPassword').value;
              
              if (password !== confirmPassword) {
                document.getElementById('confirmError').textContent = 'Passwords do not match';
                return;
              }
              
              if (password.length < 6) {
                document.getElementById('passwordError').textContent = 'Password must be at least 6 characters';
                return;
              }
            ` : ''}
            
            try {
              const result = await ipcRenderer.invoke('encryption-setup', password);
              if (result.success) {
                window.close();
              } else {
                document.getElementById('passwordError').textContent = result.error || 'Failed to setup encryption';
              }
            } catch (error) {
              document.getElementById('passwordError').textContent = 'An error occurred';
            }
          });
          
          function skipEncryption() {
            window.close();
          }
          
          // Focus password field
          document.getElementById('password').focus();
        </script>
      </body>
      </html>
    `;
  }

  cleanup() {
    if (this.actualRegisteredKey) {
      globalShortcut.unregister(this.actualRegisteredKey);
      console.log(`Cleanup: Unregistered shortcut: ${this.actualRegisteredKey}`);
    }
    this.stopUiohookMonitoring();
    if (this.db) {
      this.db.close();
    }
    if (this.encryptedDb) {
      this.encryptedDb.close();
    }
  }
}

const notesApp = new NotesApp();

app.whenReady().then(() => {
  // Set Dock icon to app logo on macOS (dev and packaged)
  try {
    if (process.platform === 'darwin' && app.dock) {
      const iconCandidates = [
        app.isPackaged
          ? path.join(process.resourcesPath, 'assets', 'icon.icns')
          : path.join(__dirname, '../assets', 'icon.icns'),
        app.isPackaged
          ? path.join(process.resourcesPath, 'assets', 'app-logo.png')
          : path.join(__dirname, '../assets', 'app-logo.png')
      ];
      const { nativeImage } = require('electron');
      for (const candidate of iconCandidates) {
        const img = nativeImage.createFromPath(candidate);
        if (img && !img.isEmpty()) {
          app.dock.setIcon(img);
          break;
        }
      }
    }
  } catch {}
  // When running packaged with LSUIElement, Dock is hidden by the system.
  // In dev, still hide Dock immediately to avoid showing Electron icon.
  if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
    try { app.dock.hide(); } catch {}
  }
  notesApp.initialize();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  notesApp.cleanup();
});

module.exports = NotesApp;
