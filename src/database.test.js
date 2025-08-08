const NotesDatabase = require('./database');
const path = require('path');
const fs = require('fs');

jest.mock('electron', () => require('./electronMock'));

describe('NotesDatabase', () => {
  let db;

  beforeAll(() => {
    db = new NotesDatabase();
    db.initialize();
  });

  afterAll(() => {
    db.close();
    // Clean up the test database
    const testDbPath = path.join(__dirname, 'test_data', 'notes.db');
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    const testDataPath = path.join(__dirname, 'test_data');
    if (fs.existsSync(testDataPath)) {
        fs.rmSync(testDataPath, { recursive: true, force: true });
    }
  });

  test('should initialize the database', () => {
    expect(db.isInitialized).toBe(true);
  });

  test('should add a note', () => {
    const note = {
      content: 'Test note',
      source: 'Test source',
      url: 'http://test.com',
      timestamp: new Date().toISOString(),
    };
    const id = db.addNote(note);
    expect(id).toBe(1);
  });

  test('should get notes', () => {
    const notes = db.getNotes();
    expect(notes.length).toBe(1);
    expect(notes[0].content).toBe('Test note');
  });

  test('should search notes', () => {
    const notes = db.searchNotes('Test');
    expect(notes.length).toBe(1);
    expect(notes[0].content).toBe('Test note');
  });

  test('should get notes count', () => {
    const count = db.getNotesCount();
    expect(count).toBe(1);
  });

  test('should get search count', () => {
    const count = db.getSearchCount('Test');
    expect(count).toBe(1);
  });

  test('should update a note', () => {
    const success = db.updateNote(1, 'Updated note');
    expect(success).toBe(true);
    const notes = db.getNotes();
    expect(notes[0].content).toBe('Updated note');
  });

  test('should delete a note', () => {
    const success = db.deleteNote(1);
    expect(success).toBe(true);
    const notes = db.getNotes();
    expect(notes.length).toBe(0);
  });
});
