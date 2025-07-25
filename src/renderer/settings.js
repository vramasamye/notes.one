const { ipcRenderer, shell } = require('electron');

class SettingsRenderer {
  constructor() {
    this.currentSettings = {};
    this.originalSettings = {};
    this.hasChanges = false;
    
    this.initializeElements();
    this.attachEventListeners();
    this.loadSettings();
    this.checkAccessibilityStatus();
  }

  initializeElements() {
    this.shortcutSelect = document.getElementById('shortcutSelect');
    this.testShortcutBtn = document.getElementById('testShortcut');
    this.shortcutStatus = document.getElementById('shortcutStatus');
    this.accessibilityStatus = document.getElementById('accessibilityStatus');
    this.accessibilityIndicator = document.getElementById('accessibilityIndicator');
    this.openAccessibilityBtn = document.getElementById('openAccessibilitySettings');
    this.saveBtn = document.getElementById('saveSettings');
    this.cancelBtn = document.getElementById('cancelSettings');
    this.closeBtn = document.getElementById('closeSettings');
    this.themeSwitch = document.getElementById('themeSwitch');
  }

  attachEventListeners() {
    this.shortcutSelect.addEventListener('change', this.handleShortcutChange.bind(this));
    this.testShortcutBtn.addEventListener('click', this.testShortcut.bind(this));
    this.openAccessibilityBtn.addEventListener('click', this.openAccessibilitySettings.bind(this));
    this.saveBtn.addEventListener('click', this.saveSettings.bind(this));
    this.cancelBtn.addEventListener('click', this.cancelSettings.bind(this));
    this.closeBtn.addEventListener('click', this.closeSettings.bind(this));
    this.themeSwitch.addEventListener('change', this.handleThemeChange.bind(this));

    // Handle keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.cancelSettings();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        this.saveSettings();
      }
    });

    // IPC listeners
    ipcRenderer.on('settings-test-result', this.handleTestResult.bind(this));
    ipcRenderer.on('accessibility-status', this.handleAccessibilityStatus.bind(this));
  }

  async loadSettings() {
    try {
      this.currentSettings = await ipcRenderer.invoke('get-settings');
      this.originalSettings = { ...this.currentSettings };
      
      // Set current shortcut in dropdown
      this.shortcutSelect.value = this.currentSettings.globalShortcut || 'CommandOrControl+Shift+C';
      this.themeSwitch.checked = this.currentSettings.theme === 'dark';
      this.updateUI();
    } catch (error) {
      console.error('Error loading settings:', error);
      this.showStatus('Error loading settings', 'error');
    }
  }

  handleShortcutChange() {
    const newShortcut = this.shortcutSelect.value;
    this.currentSettings.globalShortcut = newShortcut;
    this.checkForChanges();
    this.clearStatus();
  }

  handleThemeChange() {
    const newTheme = this.themeSwitch.checked ? 'dark' : 'light';
    this.currentSettings.theme = newTheme;
    document.body.classList.toggle('dark-mode', this.themeSwitch.checked);
    this.checkForChanges();
  }

  checkForChanges() {
    this.hasChanges = JSON.stringify(this.currentSettings) !== JSON.stringify(this.originalSettings);
    this.updateUI();
  }

  updateUI() {
    this.saveBtn.disabled = !this.hasChanges;
    
    // Update button text based on changes
    if (this.hasChanges) {
      this.saveBtn.textContent = 'Save Changes';
      this.saveBtn.classList.add('has-changes');
    } else {
      this.saveBtn.textContent = 'No Changes';
      this.saveBtn.classList.remove('has-changes');
    }
  }

  async testShortcut() {
    const shortcut = this.shortcutSelect.value;
    this.testShortcutBtn.disabled = true;
    this.testShortcutBtn.textContent = 'Testing...';
    
    this.showStatus('Testing shortcut...', 'info');
    
    try {
      const result = await ipcRenderer.invoke('test-shortcut', shortcut);
      this.handleTestResult(result);
    } catch (error) {
      console.error('Error testing shortcut:', error);
      this.showStatus('Error testing shortcut', 'error');
    } finally {
      this.testShortcutBtn.disabled = false;
      this.testShortcutBtn.textContent = 'Test';
    }
  }

  handleTestResult(result) {
    if (result.success) {
      this.showStatus(`✓ Shortcut "${this.getShortcutDisplayName(result.shortcut)}" is working!`, 'success');
    } else {
      this.showStatus(`✗ ${result.error || 'Shortcut test failed'}`, 'error');
    }
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
      'CommandOrControl+Alt+C': '⌘/Ctrl + Alt + C'
    };
    
    return displayNames[shortcut] || shortcut;
  }

  showStatus(message, type) {
    this.shortcutStatus.textContent = message;
    this.shortcutStatus.className = `shortcut-status ${type} show`;
    
    // Auto-hide after 5 seconds for success/error messages
    if (type !== 'info') {
      setTimeout(() => {
        this.clearStatus();
      }, 5000);
    }
  }

  clearStatus() {
    this.shortcutStatus.classList.remove('show');
    setTimeout(() => {
      this.shortcutStatus.textContent = '';
      this.shortcutStatus.className = 'shortcut-status';
    }, 300);
  }

  async checkAccessibilityStatus() {
    try {
      const isGranted = await ipcRenderer.invoke('check-accessibility');
      this.handleAccessibilityStatus(isGranted);
    } catch (error) {
      console.error('Error checking accessibility:', error);
      this.accessibilityIndicator.textContent = 'Error';
      this.accessibilityIndicator.className = 'status-indicator error';
    }
  }

  handleAccessibilityStatus(isGranted) {
    if (isGranted) {
      this.accessibilityIndicator.textContent = 'Granted';
      this.accessibilityIndicator.className = 'status-indicator granted';
      this.openAccessibilityBtn.style.display = 'none';
    } else {
      this.accessibilityIndicator.textContent = 'Required';
      this.accessibilityIndicator.className = 'status-indicator denied';
      this.openAccessibilityBtn.style.display = 'block';
    }
  }

  async openAccessibilitySettings() {
    try {
      await ipcRenderer.invoke('open-accessibility-settings');
    } catch (error) {
      console.error('Error opening accessibility settings:', error);
    }
  }

  async saveSettings() {
    if (!this.hasChanges) return;

    this.saveBtn.disabled = true;
    this.saveBtn.textContent = 'Saving...';

    try {
      const result = await ipcRenderer.invoke('save-settings', this.currentSettings);
      
      if (result.success) {
        this.originalSettings = { ...this.currentSettings };
        this.hasChanges = false;
        this.updateUI();
        this.showStatus('✓ Settings saved successfully!', 'success');
        
        // Notify main window to update shortcut hint
        ipcRenderer.send('settings-changed', this.currentSettings);
        
        // Auto-close after success
        setTimeout(() => {
          this.closeSettings();
        }, 1500);
      } else {
        this.showStatus(`✗ ${result.error || 'Failed to save settings'}`, 'error');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      this.showStatus('✗ Error saving settings', 'error');
    } finally {
      this.saveBtn.disabled = false;
      this.saveBtn.textContent = 'Save Changes';
    }
  }

  cancelSettings() {
    if (this.hasChanges) {
      // Restore original settings
      this.currentSettings = { ...this.originalSettings };
      this.shortcutSelect.value = this.currentSettings.globalShortcut || 'CommandOrControl+Shift+C';
      this.hasChanges = false;
      this.updateUI();
      this.clearStatus();
    }
    this.closeSettings();
  }

  closeSettings() {
    ipcRenderer.send('close-settings');
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new SettingsRenderer();
});