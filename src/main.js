const { app, BrowserWindow, Tray, Menu, globalShortcut, clipboard, dialog, ipcMain, systemPreferences, shell } = require('electron');
const path = require('path');
const NotesDatabase = require('./database');
const SettingsManager = require('./settings');

class NotesApp {
  constructor() {
    this.mainWindow = null;
    this.settingsWindow = null;
    this.tray = null;
    this.db = new NotesDatabase();
    this.settings = new SettingsManager();
    this.currentShortcut = null;
  }

  async initialize() {
    const isTrusted = systemPreferences.isTrustedAccessibilityClient(true);
    if (!isTrusted) {
      dialog.showErrorBox(
        'Accessibility Permissions Required',
        'Please grant accessibility permissions to notes.one in System Settings > Privacy & Security > Accessibility, then restart the app.'
      );
    }

    this.db.initialize();
    await this.settings.initialize();
    this.setupGlobalShortcuts();
    this.setupIpcHandlers();
    this.createTray();
  }

  setupIpcHandlers() {
    // Database handlers
    ipcMain.handle('database-get-notes', async (event, limit, offset) => {
      const notes = await this.db.getNotes(limit, offset);
      const count = await this.db.getNotesCount();
      return { notes, count };
    });

    ipcMain.handle('database-search-notes', async (event, query, limit, offset) => {
      const notes = await this.db.searchNotes(query, limit, offset);
      const count = await this.db.getSearchCount(query);
      return { notes, count };
    });

    ipcMain.handle('database-delete-note', async (event, noteId) => {
      return await this.db.deleteNote(noteId);
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
        // Test if shortcut can be registered
        const canRegister = globalShortcut.register(shortcut, () => {});
        if (canRegister) {
          globalShortcut.unregister(shortcut);
          return { success: true, shortcut };
        } else {
          return { success: false, error: 'Shortcut is already in use by another application' };
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('check-accessibility', () => {
      return systemPreferences.isTrustedAccessibilityClient(false);
    });

    ipcMain.handle('open-accessibility-settings', () => {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
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
    // Unregister existing shortcut if any
    if (this.currentShortcut) {
      globalShortcut.unregister(this.currentShortcut);
    }

    // Get shortcut from settings
    const shortcut = this.settings.getSetting('globalShortcut') || 'CommandOrControl+Shift+C';
    
    try {
      const registered = globalShortcut.register(shortcut, () => {
        this.captureSelection();
      });
      
      if (registered) {
        this.currentShortcut = shortcut;
        console.log(`Global shortcut registered: ${shortcut}`);
      } else {
        console.error(`Failed to register global shortcut: ${shortcut}`);
        // Fallback to default if custom shortcut fails
        if (shortcut !== 'CommandOrControl+Shift+C') {
          globalShortcut.register('CommandOrControl+Shift+C', () => {
            this.captureSelection();
          });
          this.currentShortcut = 'CommandOrControl+Shift+C';
        }
      }
    } catch (error) {
      console.error('Error registering global shortcut:', error);
    }
  }

  async captureSelection() {
    console.log('captureSelection triggered');
    try {
      const originalClipboard = clipboard.readText();
      clipboard.clear();

      const { execSync } = require('child_process');
      
      try {
        console.log('Executing copy command...');
        execSync(`osascript -e 'tell application "System Events" to keystroke "c" using {command down}'`, { timeout: 1000 });
        console.log('Copy command executed.');
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const selectedText = clipboard.readText();
        console.log(`Selected text: "${selectedText}"`);
        
        if (selectedText && selectedText.trim()) {
          const sourceInfo = await this.getSourceInfo();
          const note = {
            content: selectedText.trim(),
            source: sourceInfo.source,
            url: sourceInfo.url,
            timestamp: new Date().toISOString()
          };
          
          await this.db.addNote(note);
          this.showNotification('Note saved!');
          if (this.mainWindow) {
            this.mainWindow.webContents.send('reload-notes');
          }
        }
        
        clipboard.writeText(originalClipboard);
        
      } catch (copyError) {
        console.error('Failed to copy text:', copyError);
        dialog.showErrorBox('Error', 'Failed to copy selected text. Make sure the app has Accessibility permissions.');
        clipboard.writeText(originalClipboard);
      }
      
    } catch (error) {
      console.error('Failed to capture selection:', error);
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
    const iconPath = path.join(__dirname, '../assets/tray-icon.png');
    
    try {
      this.tray = new Tray(iconPath);
    } catch (error) {
      console.warn('Tray icon not found, creating empty tray');
      this.tray = new Tray(require('electron').nativeImage.createEmpty());
    }
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Notes',
        click: () => this.createMainWindow()
      },
      {
        label: 'Search Notes',
        click: () => this.createMainWindow(true)
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => this.createSettingsWindow()
      },
      { type: 'separator' },
      {
        label: 'Test Note Capture',
        click: () => this.testNoteCapture()
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
    const testNote = {
      content: `Test note created at ${new Date().toLocaleTimeString()}`,
      source: 'Manual Test',
      timestamp: new Date().toISOString()
    };
    
    try {
      await this.db.addNote(testNote);
      console.log('Test note saved successfully');
      this.showNotification('Test note saved!');
    } catch (error) {
      console.error('Failed to save test note:', error);
    }
  }

  createMainWindow(openSearch = false) {
    if (this.mainWindow) {
      this.mainWindow.webContents.send('reload-notes');
      this.mainWindow.focus();
      return;
    }

    this.mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      title: 'notes.one',
      show: false
    });

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
      this.mainWindow.focus();
    });

    this.mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

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

  cleanup() {
    if (this.currentShortcut) {
      globalShortcut.unregister(this.currentShortcut);
    }
    if (this.db) {
      this.db.close();
    }
  }
}

const notesApp = new NotesApp();

app.whenReady().then(() => {
  app.dock.hide();
  notesApp.initialize();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  notesApp.cleanup();
});

module.exports = NotesApp;
