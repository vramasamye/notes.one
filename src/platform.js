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
    this.getWindows = null;
  }

  async initializeModules() {
    // No longer using robotjs or get-windows
    // All functionality is now handled through native OS APIs
    console.log('Platform modules initialized for', this.platform);
  }

  async simulateKeyPress(key = 'c', modifiers = ['command']) {
    try {
      await this.initializeModules();
      
      if (this.isMacOS) {
        // Use AppleScript for macOS (more reliable)
        const modifierStr = modifiers.includes('command') ? 'command down' : 'control down';
        execSync(`osascript -e 'tell application "System Events" to keystroke "${key}" using {${modifierStr}}'`, { timeout: 1000 });
      } else {
        // Use native Windows/Linux key simulation
        // For Windows, we can use PowerShell or Windows API
        if (this.isWindows) {
          const modifierStr = modifiers.includes('command') || modifiers.includes('control') ? '^' : '';
          const shiftStr = modifiers.includes('shift') ? '+' : '';
          const altStr = modifiers.includes('alt') ? '%' : '';
          
          execSync(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${modifierStr}${shiftStr}${altStr}${key}')"`, { timeout: 1000 });
        } else {
          // For Linux, use xdotool if available
          const modifierStr = modifiers.includes('command') || modifiers.includes('control') ? 'ctrl+' : '';
          const shiftStr = modifiers.includes('shift') ? 'shift+' : '';
          const altStr = modifiers.includes('alt') ? 'alt+' : '';
          
          execSync(`xdotool key ${modifierStr}${shiftStr}${altStr}${key}`, { timeout: 1000 });
        }
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
        // Use native Windows/Linux APIs
        if (this.isWindows) {
          // Use PowerShell to get active window on Windows
          const appName = execSync(
            `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Form]::ActiveForm | Select-Object -ExpandProperty Text"`,
            { encoding: 'utf8', timeout: 2000 }
          ).trim();
          
          return {
            owner: { name: appName || 'Unknown' },
            title: ''
          };
        } else {
          // Use xdotool for Linux
          const windowInfo = execSync('xdotool getactivewindow getwindowname', { 
            encoding: 'utf8', 
            timeout: 2000 
          }).trim();
          
          return {
            owner: { name: windowInfo || 'Unknown' },
            title: ''
          };
        }
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
      platformSupport: true
    };

    try {
      if (this.isMacOS) {
        // Check macOS accessibility permissions
        const { systemPreferences } = require('electron');
        requirements.accessibility = systemPreferences.isTrustedAccessibilityClient(false);
      } else if (this.isWindows) {
        // Windows doesn't require special accessibility permissions
        requirements.accessibility = true;
        // Check if PowerShell is available
        try {
          execSync('powershell -Command "Write-Host test"', { timeout: 1000 });
        } catch (error) {
          requirements.platformSupport = false;
        }
      } else {
        // Linux - check if xdotool is available
        requirements.accessibility = true;
        try {
          execSync('which xdotool', { timeout: 1000 });
        } catch (error) {
          requirements.platformSupport = false;
          console.warn('xdotool not found on Linux. Install with: sudo apt-get install xdotool');
        }
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
    const iconName = 'tray-icon.png';
    return `assets/${iconName}`;
  }
}

module.exports = { PlatformManager };