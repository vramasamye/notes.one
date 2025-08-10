const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
const CryptoJS = require('crypto-js');
const crypto = require('crypto');

class EncryptedNotesDatabase {
  constructor() {
    this.db = null;
    this.isInitialized = false;
    this.encryptionKey = null;
    this.isEncryptionEnabled = false;
    
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'notes-encrypted.db');
    this.keyPath = path.join(userDataPath, 'encryption.key');
    console.log('Database path:', this.dbPath);
  }

  // Generate or load encryption key
  async initializeEncryption(password = null) {
    const fs = require('fs').promises;
    
    try {
      // Check if encryption key file exists
      try {
        const keyData = await fs.readFile(this.keyPath, 'utf8');
        const keyInfo = JSON.parse(keyData);
        
        if (password) {
          // Verify password
          const testKey = CryptoJS.PBKDF2(password, keyInfo.salt, {
            keySize: 256/32,
            iterations: 10000
          }).toString();
          
          if (testKey === keyInfo.key) {
            this.encryptionKey = testKey;
            this.isEncryptionEnabled = true;
            console.log('Encryption key loaded successfully');
            return { success: true, isNewKey: false };
          } else {
            return { success: false, error: 'Invalid password' };
          }
        } else {
          // No password provided but key exists
          return { success: false, error: 'Password required for encrypted database' };
        }
      } catch (error) {
        // Key file doesn't exist, create new one if password provided
        if (password) {
          const salt = crypto.randomBytes(32).toString('hex');
          const key = CryptoJS.PBKDF2(password, salt, {
            keySize: 256/32,
            iterations: 10000
          }).toString();
          
          const keyInfo = {
            key: key,
            salt: salt,
            created: new Date().toISOString()
          };
          
          await fs.writeFile(this.keyPath, JSON.stringify(keyInfo, null, 2));
          this.encryptionKey = key;
          this.isEncryptionEnabled = true;
          console.log('New encryption key created');
          return { success: true, isNewKey: true };
        } else {
          // No password and no key file - use unencrypted mode
          this.isEncryptionEnabled = false;
          console.log('Running in unencrypted mode');
          return { success: true, isNewKey: false };
        }
      }
    } catch (error) {
      console.error('Error initializing encryption:', error);
      return { success: false, error: error.message };
    }
  }

  // Encrypt data
  encrypt(data) {
    if (!this.isEncryptionEnabled || !this.encryptionKey) {
      return data;
    }
    
    try {
      return CryptoJS.AES.encrypt(data, this.encryptionKey).toString();
    } catch (error) {
      console.error('Encryption error:', error);
      return data;
    }
  }

  // Decrypt data
  decrypt(encryptedData) {
    if (!this.isEncryptionEnabled || !this.encryptionKey || !encryptedData) {
      return encryptedData;
    }
    
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedData, this.encryptionKey);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch (error) {
      console.error('Decryption error:', error);
      return encryptedData;
    }
  }

  async initialize(password = null) {
    try {
      console.log('Initializing encrypted database...');
      
      // Initialize encryption first
      const encryptionResult = await this.initializeEncryption(password);
      if (!encryptionResult.success) {
        return encryptionResult;
      }
      
      this.db = new Database(this.dbPath);
      console.log('Database opened successfully');
      
      // Enable WAL mode for better performance
      this.db.pragma('journal_mode = WAL');
      console.log('WAL mode enabled');
      
      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');
      
      // Optimize for performance
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = 10000');
      this.db.pragma('temp_store = MEMORY');
      
      // Create tables and indexes
      this.createTables();
      
      this.isInitialized = true;
      console.log('Encrypted database initialized successfully');
      
      return { success: true, isNewKey: encryptionResult.isNewKey };
      
    } catch (error) {
      console.error('Error initializing database:', error);
      return { success: false, error: error.message };
    }
  }

  createTables() {
    try {
      // Create notes table with version support
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          source TEXT,
          url TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          version INTEGER DEFAULT 1,
          is_deleted BOOLEAN DEFAULT FALSE,
          is_sensitive BOOLEAN DEFAULT FALSE
        )
      `);
      
      // Add is_sensitive column if it doesn't exist (for existing databases)
      try {
        this.db.exec('ALTER TABLE notes ADD COLUMN is_sensitive BOOLEAN DEFAULT FALSE');
      } catch (error) {
        // Column already exists, which is fine
      }
      
      // Create note versions table for history
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS note_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          note_id INTEGER NOT NULL,
          content TEXT NOT NULL,
          source TEXT,
          url TEXT,
          version INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          change_type TEXT DEFAULT 'update',
          FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE
        )
      `);
      
      // Create encryption metadata table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS encryption_metadata (
          id INTEGER PRIMARY KEY,
          is_encrypted BOOLEAN DEFAULT FALSE,
          encryption_version TEXT DEFAULT '1.0',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Insert encryption metadata if not exists
      const metadataExists = this.db.prepare('SELECT COUNT(*) as count FROM encryption_metadata').get();
      if (metadataExists.count === 0) {
        this.db.prepare(`
          INSERT INTO encryption_metadata (is_encrypted, encryption_version)
          VALUES (?, ?)
        `).run(this.isEncryptionEnabled, '1.0');
      }
      
      // Create optimized indexes
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_notes_timestamp ON notes(timestamp DESC)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_notes_content ON notes(content)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_notes_source ON notes(source)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(is_deleted)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_notes_version ON notes(version)');
      
      // Indexes for version history
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_versions_note_id ON note_versions(note_id)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_versions_created ON note_versions(created_at DESC)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_versions_note_version ON note_versions(note_id, version)');
      
      // Create a composite index for search queries
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_notes_search ON notes(content, source, timestamp DESC) WHERE is_deleted = FALSE');
      
      console.log('Database tables and indexes created');
    } catch (error) {
      console.error('Error creating tables:', error);
      throw error;
    }
  }

  addNote(note) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }
    
    try {
      // Encrypt content if encryption is enabled
      const encryptedContent = this.encrypt(note.content);
      const encryptedSource = this.encrypt(note.source || '');
      const encryptedUrl = this.encrypt(note.url || '');
      
      const stmt = this.db.prepare(`
        INSERT INTO notes (content, source, url, timestamp, version)
        VALUES (?, ?, ?, ?, 1)
      `);
      
      const result = stmt.run(
        encryptedContent,
        encryptedSource,
        encryptedUrl,
        note.timestamp
      );
      
      const noteId = result.lastInsertRowid;
      
      // Add initial version to history
      this.addNoteVersion(noteId, {
        content: encryptedContent,
        source: encryptedSource,
        url: encryptedUrl,
        version: 1,
        change_type: 'create'
      });
      
      console.log('Note added with ID:', noteId);
      return noteId;
      
    } catch (error) {
      console.error('Error adding note:', error);
      throw error;
    }
  }

  addNoteVersion(noteId, versionData) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO note_versions (note_id, content, source, url, version, change_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        noteId,
        versionData.content,
        versionData.source,
        versionData.url,
        versionData.version,
        versionData.change_type || 'update'
      );
      
    } catch (error) {
      console.error('Error adding note version:', error);
      throw error;
    }
  }

  updateNote(noteId, updatedContent) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }
    
    try {
      // Get current note
      const currentNote = this.db.prepare('SELECT * FROM notes WHERE id = ? AND is_deleted = FALSE').get(noteId);
      if (!currentNote) {
        throw new Error('Note not found');
      }
      
      // Encrypt new content
      const encryptedContent = this.encrypt(updatedContent);
      
      // Update note with new version
      const newVersion = currentNote.version + 1;
      const stmt = this.db.prepare(`
        UPDATE notes 
        SET content = ?, version = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      
      stmt.run(encryptedContent, newVersion, noteId);
      
      // Add version to history
      this.addNoteVersion(noteId, {
        content: encryptedContent,
        source: currentNote.source,
        url: currentNote.url,
        version: newVersion,
        change_type: 'update'
      });
      
      console.log('Note updated with new version:', newVersion);
      return true;
      
    } catch (error) {
      console.error('Error updating note:', error);
      throw error;
    }
  }

  toggleSensitiveNote(noteId) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }
    
    try {
      // First get the current sensitive status
      const getStmt = this.db.prepare('SELECT is_sensitive FROM notes WHERE id = ? AND is_deleted = FALSE');
      const note = getStmt.get(noteId);
      
      if (!note) {
        console.log(`Note with ID ${noteId} not found`);
        return null;
      }
      
      // Toggle the sensitive status (convert boolean to integer for SQLite)
      const newSensitiveStatus = !note.is_sensitive;
      const newSensitiveStatusInt = newSensitiveStatus ? 1 : 0;
      const stmt = this.db.prepare('UPDATE notes SET is_sensitive = ? WHERE id = ?');
      const result = stmt.run(newSensitiveStatusInt, noteId);
      const success = result.changes > 0;
      
      console.log(`Note sensitivity ${success ? 'updated' : 'failed'} for ID: ${noteId}. New status: ${newSensitiveStatus}`);
      return success ? newSensitiveStatus : null;
      
    } catch (error) {
      console.error('Error toggling note sensitivity:', error);
      return null;
    }
  }

  getNotes(limit = 50, offset = 0) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }
    
    try {
      const stmt = this.db.prepare(`
        SELECT id, content, source, url, timestamp, created_at, updated_at, version, is_deleted, is_sensitive
        FROM notes
        WHERE is_deleted = FALSE
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `);
      
      const notes = stmt.all(limit, offset);
      
      // Decrypt content if encryption is enabled
      if (this.isEncryptionEnabled) {
        const decryptedNotes = notes.map(note => ({
          ...note,
          content: this.decrypt(note.content),
          source: this.decrypt(note.source || ''),
          url: this.decrypt(note.url || '')
        }));
        
        console.log(`Retrieved ${decryptedNotes.length} notes`);
        return decryptedNotes || [];
      }
      
      console.log(`Retrieved ${notes.length} notes`);
      return notes || [];
      
    } catch (error) {
      console.error('Error getting notes:', error);
      return [];
    }
  }

  searchNotes(query, limit = 50, offset = 0) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }
    
    try {
      // For encrypted databases, we need to decrypt and search in memory
      // This is less efficient but necessary for security
      if (this.isEncryptionEnabled) {
        const allNotes = this.getNotes(1000, 0); // Get more notes for search
        const searchLower = query.toLowerCase();
        
        const filteredNotes = allNotes.filter(note => 
          note.content.toLowerCase().includes(searchLower) ||
          (note.source && note.source.toLowerCase().includes(searchLower))
        );
        
        return filteredNotes.slice(offset, offset + limit);
      } else {
        // For unencrypted databases, use SQL search
        const searchPattern = `%${query}%`;
        const stmt = this.db.prepare(`
          SELECT id, content, source, url, timestamp, created_at, updated_at, version, is_sensitive
          FROM notes
          WHERE (content LIKE ? OR source LIKE ?) AND is_deleted = FALSE
          ORDER BY timestamp DESC
          LIMIT ? OFFSET ?
        `);
        
        const notes = stmt.all(searchPattern, searchPattern, limit, offset);
        console.log(`Search found ${notes.length} notes for query: "${query}"`);
        return notes || [];
      }
      
    } catch (error) {
      console.error('Error searching notes:', error);
      return [];
    }
  }

  getNoteHistory(noteId) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }
    
    try {
      const stmt = this.db.prepare(`
        SELECT id, content, source, url, version, created_at, change_type
        FROM note_versions
        WHERE note_id = ?
        ORDER BY version DESC
      `);
      
      const versions = stmt.all(noteId);
      
      // Decrypt versions
      const decryptedVersions = versions.map(version => ({
        ...version,
        content: this.decrypt(version.content),
        source: this.decrypt(version.source),
        url: this.decrypt(version.url)
      }));
      
      console.log(`Retrieved ${decryptedVersions.length} versions for note ${noteId}`);
      return decryptedVersions;
      
    } catch (error) {
      console.error('Error getting note history:', error);
      return [];
    }
  }

  restoreNoteVersion(noteId, version) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }
    
    try {
      // Get the specific version
      const versionData = this.db.prepare(`
        SELECT content, source, url
        FROM note_versions
        WHERE note_id = ? AND version = ?
      `).get(noteId, version);
      
      if (!versionData) {
        throw new Error('Version not found');
      }
      
      // Get current note version
      const currentNote = this.db.prepare('SELECT version FROM notes WHERE id = ?').get(noteId);
      const newVersion = currentNote.version + 1;
      
      // Update note with restored content
      const stmt = this.db.prepare(`
        UPDATE notes 
        SET content = ?, source = ?, url = ?, version = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      
      stmt.run(versionData.content, versionData.source, versionData.url, newVersion, noteId);
      
      // Add restore action to history
      this.addNoteVersion(noteId, {
        content: versionData.content,
        source: versionData.source,
        url: versionData.url,
        version: newVersion,
        change_type: `restore_v${version}`
      });
      
      console.log(`Note ${noteId} restored to version ${version}`);
      return true;
      
    } catch (error) {
      console.error('Error restoring note version:', error);
      throw error;
    }
  }

  getNotesCount() {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }
    
    try {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM notes WHERE is_deleted = FALSE');
      const result = stmt.get();
      const count = result ? result.count : 0;
      console.log(`Total notes count: ${count}`);
      return count;
      
    } catch (error) {
      console.error('Error getting notes count:', error);
      return 0;
    }
  }

  getSearchCount(query) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }
    
    try {
      if (this.isEncryptionEnabled) {
        // For encrypted databases, search in memory
        const searchResults = this.searchNotes(query, 1000, 0);
        return searchResults.length;
      } else {
        const searchPattern = `%${query}%`;
        const stmt = this.db.prepare(`
          SELECT COUNT(*) as count FROM notes 
          WHERE (content LIKE ? OR source LIKE ?) AND is_deleted = FALSE
        `);
        
        const result = stmt.get(searchPattern, searchPattern);
        const count = result ? result.count : 0;
        console.log(`Search count for "${query}": ${count}`);
        return count;
      }
      
    } catch (error) {
      console.error('Error getting search count:', error);
      return 0;
    }
  }

  deleteNote(id) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }
    
    try {
      // Soft delete - mark as deleted instead of removing
      const stmt = this.db.prepare('UPDATE notes SET is_deleted = TRUE WHERE id = ?');
      const result = stmt.run(id);
      const success = result.changes > 0;
      
      if (success) {
        // Add deletion to version history
        const note = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
        if (note) {
          this.addNoteVersion(id, {
            content: note.content,
            source: note.source,
            url: note.url,
            version: note.version + 1,
            change_type: 'delete'
          });
        }
      }
      
      console.log(`Note deletion ${success ? 'successful' : 'failed'} for ID: ${id}`);
      return success;
      
    } catch (error) {
      console.error('Error deleting note:', error);
      return false;
    }
  }

  // Permanently delete a note and its history
  permanentlyDeleteNote(id) {
    if (!this.isInitialized) {
      throw new Error('Database not initialized');
    }
    
    try {
      const transaction = this.db.transaction(() => {
        // Delete versions first (due to foreign key constraint)
        this.db.prepare('DELETE FROM note_versions WHERE note_id = ?').run(id);
        // Delete note
        this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
      });
      
      transaction();
      console.log(`Note ${id} permanently deleted`);
      return true;
      
    } catch (error) {
      console.error('Error permanently deleting note:', error);
      return false;
    }
  }

  // Get encryption status
  getEncryptionStatus() {
    return {
      isEnabled: this.isEncryptionEnabled,
      hasKey: !!this.encryptionKey
    };
  }

  // Change encryption password
  async changeEncryptionPassword(oldPassword, newPassword) {
    if (!this.isEncryptionEnabled) {
      return { success: false, error: 'Encryption not enabled' };
    }
    
    try {
      const fs = require('fs').promises;
      
      // Verify old password
      const keyData = await fs.readFile(this.keyPath, 'utf8');
      const keyInfo = JSON.parse(keyData);
      
      const oldKey = CryptoJS.PBKDF2(oldPassword, keyInfo.salt, {
        keySize: 256/32,
        iterations: 10000
      }).toString();
      
      if (oldKey !== keyInfo.key) {
        return { success: false, error: 'Invalid current password' };
      }
      
      // Generate new key
      const newSalt = crypto.randomBytes(32).toString('hex');
      const newKey = CryptoJS.PBKDF2(newPassword, newSalt, {
        keySize: 256/32,
        iterations: 10000
      }).toString();
      
      // Re-encrypt all data with new key
      const allNotes = this.db.prepare('SELECT * FROM notes').all();
      const allVersions = this.db.prepare('SELECT * FROM note_versions').all();
      
      const transaction = this.db.transaction(() => {
        // Update notes
        const updateNoteStmt = this.db.prepare('UPDATE notes SET content = ?, source = ?, url = ? WHERE id = ?');
        for (const note of allNotes) {
          const decryptedContent = this.decrypt(note.content);
          const decryptedSource = this.decrypt(note.source);
          const decryptedUrl = this.decrypt(note.url);
          
          // Temporarily switch to new key for encryption
          const oldEncryptionKey = this.encryptionKey;
          this.encryptionKey = newKey;
          
          const newEncryptedContent = this.encrypt(decryptedContent);
          const newEncryptedSource = this.encrypt(decryptedSource);
          const newEncryptedUrl = this.encrypt(decryptedUrl);
          
          updateNoteStmt.run(newEncryptedContent, newEncryptedSource, newEncryptedUrl, note.id);
          
          // Restore old key temporarily
          this.encryptionKey = oldEncryptionKey;
        }
        
        // Update versions
        const updateVersionStmt = this.db.prepare('UPDATE note_versions SET content = ?, source = ?, url = ? WHERE id = ?');
        for (const version of allVersions) {
          const decryptedContent = this.decrypt(version.content);
          const decryptedSource = this.decrypt(version.source);
          const decryptedUrl = this.decrypt(version.url);
          
          // Switch to new key for encryption
          this.encryptionKey = newKey;
          
          const newEncryptedContent = this.encrypt(decryptedContent);
          const newEncryptedSource = this.encrypt(decryptedSource);
          const newEncryptedUrl = this.encrypt(decryptedUrl);
          
          updateVersionStmt.run(newEncryptedContent, newEncryptedSource, newEncryptedUrl, version.id);
          
          // Restore old key temporarily
          this.encryptionKey = oldEncryptionKey;
        }
      });
      
      transaction();
      
      // Update key file
      const newKeyInfo = {
        key: newKey,
        salt: newSalt,
        created: keyInfo.created,
        updated: new Date().toISOString()
      };
      
      await fs.writeFile(this.keyPath, JSON.stringify(newKeyInfo, null, 2));
      
      // Update current key
      this.encryptionKey = newKey;
      
      console.log('Encryption password changed successfully');
      return { success: true };
      
    } catch (error) {
      console.error('Error changing encryption password:', error);
      return { success: false, error: error.message };
    }
  }

  // Database maintenance
  vacuum() {
    if (!this.isInitialized) return;
    
    try {
      this.db.exec('VACUUM');
      console.log('Database vacuumed successfully');
    } catch (error) {
      console.error('Error vacuuming database:', error);
    }
  }

  analyze() {
    if (!this.isInitialized) return;
    
    try {
      this.db.exec('ANALYZE');
      console.log('Database statistics updated');
    } catch (error) {
      console.error('Error analyzing database:', error);
    }
  }

  // Get database stats
  getStats() {
    if (!this.isInitialized) {
      return { totalNotes: 0, totalVersions: 0, dbSize: 0, dbPath: this.dbPath, isEncrypted: this.isEncryptionEnabled };
    }
    
    try {
      const totalNotes = this.getNotesCount();
      const totalVersionsStmt = this.db.prepare('SELECT COUNT(*) as count FROM note_versions');
      const totalVersions = totalVersionsStmt.get().count;
      
      const stmt = this.db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()");
      const dbSize = stmt.get();
      
      return {
        totalNotes,
        totalVersions,
        dbSize: dbSize ? dbSize.size : 0,
        dbPath: this.dbPath,
        isEncrypted: this.isEncryptionEnabled
      };
    } catch (error) {
      console.error('Error getting database stats:', error);
      return { totalNotes: 0, totalVersions: 0, dbSize: 0, dbPath: this.dbPath, isEncrypted: this.isEncryptionEnabled };
    }
  }

  close() {
    try {
      if (this.db) {
        this.db.close();
        console.log('Database connection closed');
      }
    } catch (error) {
      console.error('Error closing database:', error);
    }
  }
}

module.exports = EncryptedNotesDatabase;
