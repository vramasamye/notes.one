const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

class NotesDatabase {
  constructor() {
    this.db = null;
    this.isInitialized = false;
    
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'notes.db');
    console.log('Database path:', this.dbPath);
  }

  initialize() {
    try {
      console.log('Opening SQLite database...');
      
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
      console.log('Database initialized successfully');
      
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    }
  }

  createTables() {
    try {
      // Create notes table with optimized schema
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          source TEXT,
          url TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          is_sensitive BOOLEAN DEFAULT FALSE
        )
      `);
      
      // Add is_sensitive column if it doesn't exist (for existing databases)
      try {
        this.db.exec('ALTER TABLE notes ADD COLUMN is_sensitive BOOLEAN DEFAULT FALSE');
      } catch (error) {
        // Column already exists, which is fine
      }
      
      // Create optimized indexes
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_notes_timestamp ON notes(timestamp DESC)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_notes_content ON notes(content)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_notes_source ON notes(source)');
      
      // Create a composite index for search queries
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_notes_search ON notes(content, source, timestamp DESC)');
      
      console.log('Database tables and indexes created');
    } catch (error) {
      console.error('Error creating tables:', error);
      throw error;
    }
  }

  addNote(note) {
    if (!this.isInitialized) this.initialize();
    
    try {
      const stmt = this.db.prepare(`
        INSERT INTO notes (content, source, url, timestamp)
        VALUES (?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        note.content,
        note.source,
        note.url,
        note.timestamp
      );
      
      console.log('Note added with ID:', result.lastInsertRowid);
      return result.lastInsertRowid;
      
    } catch (error) {
      console.error('Error adding note:', error);
      throw error;
    }
  }

  getNotes(limit = 50, offset = 0) {
    if (!this.isInitialized) this.initialize();
    
    try {
      const stmt = this.db.prepare(`
        SELECT id, content, source, url, timestamp, created_at, is_sensitive
        FROM notes
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `);
      
      const notes = stmt.all(limit, offset);
      
      console.log(`Retrieved ${notes.length} notes`);
      return notes || [];
      
    } catch (error) {
      console.error('Error getting notes:', error);
      return [];
    }
  }

  searchNotes(query, limit = 50, offset = 0) {
    if (!this.isInitialized) this.initialize();
    
    try {
      // Use optimized search with the composite index
      const searchPattern = `%${query}%`;
      const stmt = this.db.prepare(`
        SELECT id, content, source, url, timestamp, created_at, is_sensitive
        FROM notes
        WHERE content LIKE ? OR source LIKE ?
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `);
      
      const notes = stmt.all(searchPattern, searchPattern, limit, offset);
      
      console.log(`Search found ${notes.length} notes for query: "${query}"`);
      return notes || [];
      
    } catch (error) {
      console.error('Error searching notes:', error);
      return [];
    }
  }

  getNotesCount() {
    if (!this.isInitialized) this.initialize();
    
    try {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM notes');
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
    if (!this.isInitialized) this.initialize();
    
    try {
      const searchPattern = `%${query}%`;
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM notes 
        WHERE content LIKE ? OR source LIKE ?
      `);
      
      const result = stmt.get(searchPattern, searchPattern);
      
      const count = result ? result.count : 0;
      console.log(`Search count for "${query}": ${count}`);
      return count;
      
    } catch (error) {
      console.error('Error getting search count:', error);
      return 0;
    }
  }

  deleteNote(id) {
    if (!this.isInitialized) this.initialize();
    
    try {
      const stmt = this.db.prepare('DELETE FROM notes WHERE id = ?');
      const result = stmt.run(id);
      const success = result.changes > 0;
      
      console.log(`Note deletion ${success ? 'successful' : 'failed'} for ID: ${id}`);
      return success;
      
    } catch (error) {
      console.error('Error deleting note:', error);
      return false;
    }
  }

  updateNote(id, content) {
    if (!this.isInitialized) this.initialize();
    
    try {
      const stmt = this.db.prepare('UPDATE notes SET content = ? WHERE id = ?');
      const result = stmt.run(content, id);
      const success = result.changes > 0;
      
      console.log(`Note update ${success ? 'successful' : 'failed'} for ID: ${id}`);
      return success;
      
    } catch (error) {
      console.error('Error updating note:', error);
      return false;
    }
  }

  toggleSensitiveNote(id) {
    if (!this.isInitialized) this.initialize();
    
    try {
      // First get the current sensitive status
      const getStmt = this.db.prepare('SELECT is_sensitive FROM notes WHERE id = ?');
      const note = getStmt.get(id);
      
      if (!note) {
        console.log(`Note with ID ${id} not found`);
        return false;
      }
      
      // Toggle the sensitive status (convert boolean to integer for SQLite)
      const newSensitiveStatus = !note.is_sensitive;
      const newSensitiveStatusInt = newSensitiveStatus ? 1 : 0;
      const stmt = this.db.prepare('UPDATE notes SET is_sensitive = ? WHERE id = ?');
      const result = stmt.run(newSensitiveStatusInt, id);
      const success = result.changes > 0;
      
      console.log(`Note sensitivity ${success ? 'updated' : 'failed'} for ID: ${id}. New status: ${newSensitiveStatus}`);
      return success ? newSensitiveStatus : null;
      
    } catch (error) {
      console.error('Error toggling note sensitivity:', error);
      return null;
    }
  }

  // Batch operations for better performance
  addNotes(notes) {
    if (!this.isInitialized) this.initialize();
    
    const insert = this.db.prepare(`
      INSERT INTO notes (content, source, url, timestamp)
      VALUES (@content, @source, @url, @timestamp)
    `);
    
    const insertMany = this.db.transaction((notes) => {
      for (const note of notes) insert.run(note);
    });
    
    try {
      insertMany(notes);
      console.log(`Added ${notes.length} notes in batch`);
    } catch (error) {
      console.error('Error adding notes in batch:', error);
      throw error;
    }
  }

  // Database maintenance
  vacuum() {
    if (!this.isInitialized) this.initialize();
    
    try {
      this.db.exec('VACUUM');
      console.log('Database vacuumed successfully');
    } catch (error) {
      console.error('Error vacuuming database:', error);
    }
  }

  analyze() {
    if (!this.isInitialized) this.initialize();
    
    try {
      this.db.exec('ANALYZE');
      console.log('Database statistics updated');
    } catch (error) {
      console.error('Error analyzing database:', error);
    }
  }

  // Get database stats
  getStats() {
    if (!this.isInitialized) this.initialize();
    
    try {
      const totalNotes = this.getNotesCount();
      const stmt = this.db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()");
      const dbSize = stmt.get();
      
      return {
        totalNotes,
        dbSize: dbSize ? dbSize.size : 0,
        dbPath: this.dbPath
      };
    } catch (error) {
      console.error('Error getting database stats:', error);
      return { totalNotes: 0, dbSize: 0, dbPath: this.dbPath };
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

module.exports = NotesDatabase;