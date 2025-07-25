const { execSync } = require('child_process');
const os = require('os');

class PlatformManager {
  constructor() {
    this.platform = os.platform();
    this.isWindows = this.platform === 'win32';
    this.isMacOS = this.platform === 'darwin';
    this.isLinux = this.platform === 'linux';
    
    // Initialize platform-specific modules lazily
    this.robot = null;
    this.activeWin = null;
  }

  async initializeModules() {
    try {
      if (!this.robot) {
        this.robot = require('robotjs');
        // Configure robotjs for better performance
        this.robot.setDelay(10);
      }
      
      if (!this.activeWin) {
        this.activeWin = require('active-win');
      }
    } catch (error) {
      console.warn('Failed to initialize cross-platform modules:', error.message);
    }
  }

  async simulateKeyPress(key = 'c', modifiers = ['command']) {
    try {
      await this.initializeModules();
      
      if (this.isMacOS) {
        // Use AppleScript for macOS (more reliable)
        const modifierStr = modifiers.includes('command') ? 'command down' : 'control down';
        execSync(`osascript -e 'tell application "System Events" to keystroke "${key}" using {${modifierStr}}'`, { timeout: 1000 });
      } else {
        // Use robotjs for Windows/Linux
        if (!this.robot) {
          throw new Error('robotjs not available');
        }
        
        const robotModifiers = [];
        if (modifiers.includes('command') || modifiers.includes('control')) {
          robotModifiers.push('control');
        }
        if (modifiers.includes('shift')) {
          robotModifiers.push('shift');
        }
        if (modifiers.includes('alt')) {
          robotModifiers.push('alt');
        }
        
        this.robot.keyTap(key, robotModifiers);
      }
    } catch (error) {
      console.error('Failed to simulate key press:', error);
      throw new Error(`Failed to simulate ${modifiers.join('+')}+${key}: ${error.message}`);
    }
  }

  async getActiveWindow() {
    try {
      if (this.isMacOS) {
        // Use AppleScript for macOS
        const appName = execSync(
          `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
          { encoding: 'utf8', timeout: 2000 }
        ).trim();
        
        return {
          owner: { name: appName },
          title: await this.getWindowTitle(appName)
        };
      } else {
        // Use active-win for Windows/Linux
        await this.initializeModules();
        if (!this.activeWin) {
          throw new Error('active-win not available');
        }
        
        const windowInfo = await this.activeWin();
        return windowInfo || { owner: { name: 'Unknown' }, title: '' };
      }
    } catch (error) {
      console.error('Failed to get active window:', error);
      return { owner: { name: 'Unknown' }, title: '' };
    }
  }

  async getWindowTitle(appName) {
    if (!this.isMacOS) return '';
    
    try {
      // Try to get window title for macOS
      const title = execSync(
        `osascript -e 'tell application "System Events" to get title of front window of application process "${appName}"'`,
        { encoding: 'utf8', timeout: 1000 }
      ).trim();
      return title;
    } catch (error) {
      return '';
    }
  }

  async getBrowserUrl(appName) {
    try {
      const browserApps = {
        'Google Chrome': 'Google Chrome',
        'Brave Browser': 'Brave Browser', 
        'Microsoft Edge': 'Microsoft Edge',
        'Safari': 'Safari',
        'chrome.exe': 'Google Chrome',
        'brave.exe': 'Brave Browser',
        'msedge.exe': 'Microsoft Edge',
        'safari.exe': 'Safari'
      };

      const browserName = browserApps[appName] || browserApps[appName.toLowerCase()];
      if (!browserName) return null;

      if (this.isMacOS) {
        // Use AppleScript for macOS browsers
        let script;
        if (browserName === 'Safari') {
          script = `tell application "Safari" to get URL of current tab of front window`;
        } else {
          script = `tell application "${browserName}" to get URL of active tab of front window`;
        }
        
        const url = execSync(`osascript -e '${script}'`, { 
          encoding: 'utf8', 
          timeout: 2000 
        }).trim();
        
        return url.startsWith('http') ? url : null;
      } else {
        // For Windows, we'd need browser-specific implementations
        // This is a simplified approach - in practice, you might want to use
        // browser automation libraries or Windows-specific APIs
        return null; // TODO: Implement Windows browser URL extraction
      }
    } catch (error) {
      console.warn(`Failed to get browser URL from ${appName}:`, error.message);
      return null;
    }
  }

  showNotification(title, message, options = {}) {
    try {
      if (this.isMacOS) {
        // Use native macOS notifications
        execSync(`osascript -e 'display notification "${message}" with title "${title}"'`, { timeout: 1000 });
      } else {
        // For Windows/Linux, we'll rely on Electron's Notification API
        // which will be called from the main process
        return { title, message, ...options };
      }
    } catch (error) {
      console.error('Failed to show platform notification:', error);
      return { title, message, ...options };
    }
  }

  getShortcutDisplayString(shortcut) {
    if (this.isMacOS) {
      return shortcut
        .replace('CommandOrControl', '⌘')
        .replace('Shift', '⇧')
        .replace('Alt', '⌥')
        .replace('Control', '⌃');
    } else {
      return shortcut
        .replace('CommandOrControl', 'Ctrl')
        .replace(/\+/g, ' + ');
    }
  }

  getDefaultShortcut() {
    // Return the default shortcut for the platform
    return 'CommandOrControl+Shift+C';
  }

  async checkPlatformRequirements() {
    const requirements = {
      accessibility: false,
      robotjs: false,
      activeWin: false
    };

    try {
      if (this.isMacOS) {
        // Check macOS accessibility permissions
        const { systemPreferences } = require('electron');
        requirements.accessibility = systemPreferences.isTrustedAccessibilityClient(false);
      } else {
        // Windows doesn't require special accessibility permissions
        requirements.accessibility = true;
      }

      // Check if robotjs is available
      try {
        await this.initializeModules();
        requirements.robotjs = !!this.robot;
        requirements.activeWin = !!this.activeWin;
      } catch (error) {
        console.warn('Platform modules not available:', error.message);
      }

    } catch (error) {
      console.error('Failed to check platform requirements:', error);
    }

    return requirements;
  }

  openAccessibilitySettings() {
    try {
      if (this.isMacOS) {
        const { shell } = require('electron');
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      } else {
        // Windows doesn't have equivalent accessibility settings for this use case
        console.log('Accessibility settings not required on Windows');
      }
    } catch (error) {
      console.error('Failed to open accessibility settings:', error);
    }
  }

  shouldHideDock() {
    // Only hide dock on macOS
    return this.isMacOS;
  }

  getTrayIcon() {
    // Return platform-appropriate tray icon path
    const iconName = this.isWindows ? 'tray-icon.ico' : 'tray-icon.png';
    return `assets/${iconName}`;
  }
}

module.exports = { PlatformManager };