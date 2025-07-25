# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

notes.one is a lightweight Mac menu bar application built with Electron that captures selected text globally using configurable keyboard shortcuts (default: Cmd/Ctrl+Shift+C). It runs continuously in the background and stores notes in a local SQLite database with full-text search capabilities.

## Architecture

### Main Components

- **Main Process** (`src/main.js`): NotesApp class managing Electron lifecycle, system tray, global shortcuts, clipboard operations, and IPC communication
- **Database Layer** (`src/database.js`): NotesDatabase class with prepared statements, WAL mode, and optimized indexing
- **Settings Manager** (`src/settings.js`): Persistent configuration storage for shortcuts, themes, and preferences
- **Renderer Process** (`src/renderer/`): Modern UI built with shadcn/ui inspired design system for note management

### Key Technologies

- **Electron**: Cross-platform desktop app framework with IPC communication
- **better-sqlite3**: Fast, synchronous SQLite3 bindings with WAL journaling
- **Electron globalShortcut**: Cross-platform global keyboard shortcut registration
- **shadcn/ui design system**: Modern CSS variables and component patterns

## Development Commands

```bash
# Install dependencies
npm install

# Run in development mode (rebuilds native modules first)
npm run dev

# Start the app (without rebuild)
npm start

# Build for distribution
npm run build

# Rebuild native modules for Electron
npm run rebuild

# Run tests
npm test
```

## Important Setup Notes

- **Native Dependencies**: This app uses `better-sqlite3` which requires native compilation. Run `npm run rebuild` if switching Node/Electron versions or after fresh install
- **Menu Bar Only**: App hides from dock (`app.dock.hide()`) and appears only in macOS menu bar as intended
- **Tray Icon**: Place 16x16 PNG at `assets/tray-icon.png`. Falls back to empty icon if missing
- **Accessibility Permissions**: Requires macOS accessibility permissions for global shortcut functionality

## Global Shortcut System

The app uses Electron's `globalShortcut` API with configurable shortcuts (default: Cmd/Ctrl+Shift+C). When triggered:
1. Simulates Cmd+C to copy selected text to clipboard
2. Detects active application using macOS AppleScript (`System Events`)
3. Stores note with timestamp and source information in SQLite
4. Shows system notification to user
5. Restores original clipboard contents

**Implementation Details:**
- Configurable shortcuts through settings UI with validation
- Preserves original clipboard to avoid data loss
- Graceful error handling if text selection fails
- Automatic fallback to default shortcut if registration fails

## Database Schema

```sql
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  source TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Performance indexes
CREATE INDEX idx_notes_timestamp ON notes(timestamp DESC);
CREATE INDEX idx_notes_content ON notes(content);
```

- Uses WAL mode (`journal_mode = WAL`) for better concurrent access
- Prepared statements for all database operations for performance
- Simple LIKE queries for search (no FTS for simplicity)

## IPC Communication

Main process exposes these handlers:
- `database-get-notes`: Paginated note retrieval with count
- `database-search-notes`: Full-text search with pagination and count  
- `database-delete-note`: Note deletion with success confirmation
- `get-settings`: Retrieve current application settings
- `save-settings`: Persist settings changes
- `validate-shortcut`: Test shortcut availability before assignment
- `open-settings-window`: Launch settings configuration window

## UI Architecture

### Design System
- **shadcn/ui inspired**: Modern CSS variables with HSL color system
- **Compact layout**: Header (48px) + Footer (44px) maximizing content space
- **Responsive design**: Mobile-optimized with adaptive components
- **Dark mode support**: Complete theme system with proper contrast ratios

### Key Features
- **Real-time search**: 300ms debounced input with regex highlighting
- **Pagination**: 50 notes per page with smooth transitions
- **Source tracking**: Shows originating application for each note
- **Date grouping**: Notes organized by date with collapsible sections
- **Long content handling**: Expandable notes with fade-out effect
- **Keyboard shortcuts**: Escape to clear search, smooth focus management
- **Confirmation dialogs**: Delete confirmation to prevent accidental loss

## Accessing Notes

**Tray Menu Options:**
- **"Open Notes"**: Browse all captured notes chronologically
- **"Search Notes"**: Opens window with search bar auto-focused
- **"Test Note Capture"**: Manual test function for development
- **"Quit"**: Stops uIOhook and exits application

**Note Management:**
- Chronological display with newest notes first
- Individual note deletion with confirmation
- Search across all note content with highlighting
- Source application and timestamp metadata

## Performance & Memory Optimization

- **WAL mode**: SQLite WAL journaling for better concurrent performance
- **Pagination**: Loads 50 notes per page to avoid memory issues with large datasets
- **Debounced search**: 300ms delay reduces excessive database queries during typing
- **Prepared statements**: All queries use prepared statements for efficiency and security
- **Minimal renderer**: Single window architecture, destroyed when closed to free memory
- **CSS transforms**: Hardware-accelerated animations using `transform` instead of layout properties
- **Event cleanup**: Proper shortcut unregistration and IPC handler cleanup on app quit

## Architecture Patterns

### Class-Based Organization
- **NotesApp** (`src/main.js`): Main orchestrator handling app lifecycle, shortcuts, and IPC
- **NotesDatabase** (`src/database.js`): Data layer with prepared statements and migrations
- **SettingsManager** (`src/settings.js`): Configuration persistence and validation
- **NotesRenderer** (`src/renderer/renderer.js`): UI controller with state management

### Key Design Principles
- **IPC separation**: Clean separation between main and renderer processes
- **Error handling**: Graceful fallbacks throughout (missing tray icon, failed shortcuts)
- **Memory optimization**: Prepared statements, pagination, debounced search
- **Event-driven UI**: Renderer responds to IPC events for window management
- **Performance focus**: WAL mode, indexed queries, minimal re-renders

### Component Patterns
- **Debounced search**: 300ms delay prevents excessive database queries
- **Staggered animations**: Notes appear with incremental delays for smooth loading
- **State management**: Single source of truth with reactive UI updates
- **Responsive utilities**: Adaptive layouts with mobile-first approach

## Development Workflow

### Testing & Debugging
- **Development mode**: Use `npm run dev` for hot-reloading and debugging
- **Database inspection**: SQLite database located in `app.getPath('userData')/notes.db`
- **IPC debugging**: Use Chrome DevTools to inspect renderer process communication
- **Global shortcut testing**: "Test Note Capture" in tray menu for manual testing

### UI Development
- **Component structure**: All UI components in `src/renderer/` with separated concerns
- **CSS organization**: Single `styles.css` file with CSS custom properties for theming
- **Animation principles**: Use `cubic-bezier(0.4, 0, 0.2, 1)` for smooth, natural motion
- **Accessibility**: Proper ARIA labels, keyboard navigation, and focus management

### Database Migrations
- **Schema changes**: Add migrations in `migrateDatabase()` method with version checks
- **Index optimization**: Create indexes for timestamp and content columns for search performance
- **Data integrity**: Use transactions for multi-step operations to prevent corruption