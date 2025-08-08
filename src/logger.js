const { app } = require('electron');
const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logPath = null;
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;
    
    try {
      const userDataPath = app.getPath('userData');
      const logsDir = path.join(userDataPath, 'logs');
      
      // Create logs directory if it doesn't exist
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      
      // Create log file with timestamp
      const timestamp = new Date().toISOString().split('T')[0];
      this.logPath = path.join(logsDir, `notes-one-${timestamp}.log`);
      
      this.initialized = true;
      this.info('Logger initialized', { logPath: this.logPath });
    } catch (error) {
      console.error('Failed to initialize logger:', error);
    }
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}\n`;
  }

  writeToFile(message) {
    if (!this.initialized || !this.logPath) return;
    
    try {
      fs.appendFileSync(this.logPath, message);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  info(message, data = null) {
    const formatted = this.formatMessage('info', message, data);
    if (process.env.NODE_ENV === 'development') {
      console.log(formatted.trim());
    }
    this.writeToFile(formatted);
  }

  warn(message, data = null) {
    const formatted = this.formatMessage('warn', message, data);
    if (process.env.NODE_ENV === 'development') {
      console.warn(formatted.trim());
    }
    this.writeToFile(formatted);
  }

  error(message, error = null, data = null) {
    const errorData = error ? {
      message: error.message,
      stack: error.stack,
      ...data
    } : data;
    
    const formatted = this.formatMessage('error', message, errorData);
    console.error(formatted.trim());
    this.writeToFile(formatted);
  }

  debug(message, data = null) {
    if (process.env.DEBUG) {
      const formatted = this.formatMessage('debug', message, data);
      if (process.env.NODE_ENV === 'development') {
        console.debug(formatted.trim());
      }
      this.writeToFile(formatted);
    }
  }

  // Clean up old log files (keep last 7 days)
  cleanupOldLogs() {
    if (!this.initialized) return;
    
    try {
      const logsDir = path.dirname(this.logPath);
      const files = fs.readdirSync(logsDir);
      const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      
      files.forEach(file => {
        if (file.startsWith('notes-one-') && file.endsWith('.log')) {
          const filePath = path.join(logsDir, file);
          const stats = fs.statSync(filePath);
          
          if (stats.mtime.getTime() < oneWeekAgo) {
            fs.unlinkSync(filePath);
            this.info('Cleaned up old log file', { file });
          }
        }
      });
    } catch (error) {
      this.error('Failed to cleanup old logs', error);
    }
  }
}

// Export singleton instance
const logger = new Logger();
module.exports = logger;