const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;

class SettingsManager {
  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
    this.defaultSettings = {
      globalShortcut: 'CommandOrControl+Shift+C',
      version: '1.0.0',
      enableVersionHistory: false
    };
    this.currentSettings = null;
  }

  async initialize() {
    await this.loadSettings();
  }

  async loadSettings() {
    try {
      const settingsData = await fs.readFile(this.settingsPath, 'utf8');
      this.currentSettings = { ...this.defaultSettings, ...JSON.parse(settingsData) };
    } catch (error) {
      // File doesn't exist or is corrupted, use defaults
      console.log('Settings file not found, using defaults');
      this.currentSettings = { ...this.defaultSettings };
      await this.saveSettings();
    }
    return this.currentSettings;
  }

  async saveSettings(newSettings = null) {
    if (newSettings) {
      this.currentSettings = { ...this.currentSettings, ...newSettings };
    }

    try {
      await fs.writeFile(this.settingsPath, JSON.stringify(this.currentSettings, null, 2));
      console.log('Settings saved successfully');
      return { success: true };
    } catch (error) {
      console.error('Error saving settings:', error);
      return { success: false, error: error.message };
    }
  }

  getSettings() {
    return this.currentSettings || this.defaultSettings;
  }

  getSetting(key) {
    const settings = this.getSettings();
    return settings[key];
  }

  async updateSetting(key, value) {
    const newSettings = { [key]: value };
    return await this.saveSettings(newSettings);
  }

  getShortcutDisplayName(shortcut) {
    const displayNames = {
      'CommandOrControl+Shift+C': '⌘/Ctrl + Shift + C',
      'CommandOrControl+Shift+N': '⌘/Ctrl + Shift + N',
      'CommandOrControl+Alt+N': '⌘/Ctrl + Alt + N',
      'Alt+N': 'Alt/Option + N',
      'F9': 'F9',
      'F10': 'F10',
      'F11': 'F11',
      'F12': 'F12',
      'CommandOrControl+F9': '⌘/Ctrl + F9',
      'Alt+F9': 'Alt/Option + F9',
      'CommandOrControl+Alt+C': '⌘/Ctrl + Alt + C',
      'DoubleRightShift': 'Double Right Shift',
      'DoubleRightAlt': 'Double Right Alt/Option'
    };
    
    return displayNames[shortcut] || shortcut;
  }
}

module.exports = SettingsManager;