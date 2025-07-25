const { ipcRenderer } = require('electron');

class NotesRenderer {
  constructor() {
    this.currentFilter = 'today';
    this.currentSearch = '';
    this.allNotes = [];
    this.filteredNotes = [];
    this.isLoading = false;
    
    this.initializeElements();
    this.attachEventListeners();
    this.loadNotes();
    this.updateFilterCounts();
  }

  initializeElements() {
    // Header elements
    this.searchInput = document.getElementById('searchInput');
    this.clearSearchBtn = document.getElementById('clearSearch');
    this.settingsBtn = document.getElementById('settingsBtn');
    this.sidebarToggle = document.getElementById('sidebarToggle');
    
    // Sidebar elements
    this.sidebar = document.querySelector('.sidebar');
    this.filterItems = document.querySelectorAll('.filter-item');
    this.allNotesCount = document.getElementById('allNotesCount');
    
    // Content elements
    
    this.notesList = document.getElementById('notesList');
    this.emptyState = document.getElementById('emptyState');
    this.loadingState = document.getElementById('loadingState');
  }

  attachEventListeners() {
    // Search functionality
    this.searchInput.addEventListener('input', this.debounce(this.handleSearch.bind(this), 300));
    this.clearSearchBtn.addEventListener('click', this.clearSearch.bind(this));
    
    // Settings button
    this.settingsBtn.addEventListener('click', this.openSettings.bind(this));
    
    // Sidebar toggle
    this.sidebarToggle.addEventListener('click', this.toggleSidebar.bind(this));
    
    // Filter items
    this.filterItems.forEach(item => {
      item.addEventListener('click', (e) => {
        const filter = item.dataset.filter;
        this.setActiveFilter(filter);
      });
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.clearSearch();
      }
    });

    // IPC event listeners
    ipcRenderer.on('focus-search', () => {
      this.searchInput.focus();
    });

    ipcRenderer.on('reload-notes', () => {
      this.loadNotes();
    });

    this.notesList.addEventListener('scroll', this.handleScroll.bind(this));
  }

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  async loadNotes() {
    if (this.isLoading) return;
    
    this.isLoading = true;
    this.showLoading();

    try {
      const result = await ipcRenderer.invoke('database-get-notes', 1000, 0); // Load more notes
      this.allNotes = result.notes || [];
      this.applyCurrentFilter();
      this.updateFilterCounts();
    } catch (error) {
      console.error('Error loading notes:', error);
      this.showError('Failed to load notes');
    } finally {
      this.isLoading = false;
    }
  }

  updateFilterCounts() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const last7Days = new Date(today);
    last7Days.setDate(last7Days.getDate() - 7);
    const last30Days = new Date(today);
    last30Days.setDate(last30Days.getDate() - 30);

    let todayCount = 0;
    let yesterdayCount = 0;
    let last7DaysCount = 0;
    let last30DaysCount = 0;

    this.allNotes.forEach(note => {
      const noteDate = new Date(note.timestamp);
      const noteDateOnly = new Date(noteDate.getFullYear(), noteDate.getMonth(), noteDate.getDate());
      
      if (noteDateOnly.getTime() === today.getTime()) {
        todayCount++;
      } else if (noteDateOnly.getTime() === yesterday.getTime()) {
        yesterdayCount++;
      }
      
      if (noteDate >= last7Days) {
        last7DaysCount++;
      }
      
      if (noteDate >= last30Days) {
        last30DaysCount++;
      }
    });

    // Update counts in UI
    this.allNotesCount.textContent = this.allNotes.length;
  }

  setActiveFilter(filter) {
    // Update active state
    this.filterItems.forEach(item => {
      item.classList.toggle('active', item.dataset.filter === filter);
    });
    
    this.currentFilter = filter;
    this.updateContentTitle(filter);
    this.applyCurrentFilter();
  }

  

  applyCurrentFilter() {
    let filtered = this.allNotes;

    // Apply search filter first
    if (this.currentSearch) {
      const searchLower = this.currentSearch.toLowerCase();
      filtered = filtered.filter(note => 
        note.content.toLowerCase().includes(searchLower) ||
        (note.source && note.source.toLowerCase().includes(searchLower))
      );
    }

    // Apply date filter
    if (!this.currentSearch) { // Only apply date filter if not searching
      filtered = this.filterNotesByDate(filtered, this.currentFilter);
    }

    this.filteredNotes = filtered;
    this.renderNotes();
  }

  filterNotesByDate(notes, filter) {
    if (filter === 'all') return notes;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const last7Days = new Date(today);
    last7Days.setDate(last7Days.getDate() - 7);
    const last30Days = new Date(today);
    last30Days.setDate(last30Days.getDate() - 30);

    return notes.filter(note => {
      const noteDate = new Date(note.timestamp);
      
      switch (filter) {
        case 'last7days':
          return noteDate >= last7Days;
        case 'last30days':
          return noteDate >= last30Days;
        default:
          return true;
      }
    });
  }

  handleScroll() {
    if (this.notesList.scrollTop + this.notesList.clientHeight >= this.notesList.scrollHeight - 200) {
      this.loadMoreNotes();
    }
  }

  async loadMoreNotes() {
    if (this.isLoading || this.allNotes.length === 0) return;

    this.isLoading = true;
    const offset = this.allNotes.length;
    try {
      const result = await ipcRenderer.invoke('database-get-notes', 50, offset);
      if (result.notes.length > 0) {
        this.allNotes = this.allNotes.concat(result.notes);
        this.applyCurrentFilter();
      }
    } catch (error) {
      console.error('Error loading more notes:', error);
    } finally {
      this.isLoading = false;
    }
  }

  renderNotes() {
    this.hideAllStates();

    if (this.filteredNotes.length === 0) {
      this.showEmptyState();
      return;
    }

    // Group notes by date
    const groupedNotes = this.groupNotesByDate(this.filteredNotes);

    // Clear the notes list
    this.notesList.innerHTML = '';

    // Render each group
    for (const group in groupedNotes) {
      const groupContainer = document.createElement('div');
      groupContainer.className = 'note-group';

      const groupHeader = document.createElement('h3');
      groupHeader.className = 'note-group-header';
      groupHeader.textContent = group;
      groupContainer.appendChild(groupHeader);

      groupedNotes[group].forEach((note, index) => {
        const noteElement = this.createNoteElement(note);
        noteElement.style.animationDelay = `${index * 50}ms`;
        groupContainer.appendChild(noteElement);
      });

      this.notesList.appendChild(groupContainer);
    }
  }

  groupNotesByDate(notes) {
    const grouped = {};
    notes.forEach(note => {
      const dateString = this.formatDate(new Date(note.timestamp));
      if (!grouped[dateString]) {
        grouped[dateString] = [];
      }
      grouped[dateString].push(note);
    });
    return grouped;
  }

  createNoteElement(note) {
    const noteElement = document.createElement('div');
    noteElement.className = 'note-item';
    noteElement.dataset.noteId = note.id;
    
    const timestamp = new Date(note.timestamp);
    const timeString = this.formatTime(timestamp);
    const dateString = this.formatDate(timestamp);
    
    const isLong = note.content.length > 300;
    const truncatedContent = isLong ? note.content.substring(0, 300) + '...' : note.content;
    const displayContent = this.highlightSearch(truncatedContent);

    noteElement.innerHTML = `
      <div class="note-header">
        <div class="note-title">${this.createNoteTitle(note.content)}</div>
        <div class="note-meta">
          <div class="note-source">${this.escapeHtml(note.source || 'Unknown')}</div>
          <div class="note-time" title="${timestamp.toLocaleString()}">${timeString}</div>
        </div>
      </div>
      <div class="note-content${isLong ? ' truncated' : ''}">${displayContent}</div>
      ${isLong ? '<button class="expand-btn" data-expanded="false">Show more</button>' : ''}
      ${note.url ? `<a href="${this.escapeHtml(note.url)}" target="_blank" class="note-url" rel="noopener noreferrer" title="${this.escapeHtml(note.url)}">${this.escapeHtml(this.shortenUrl(note.url))}</a>` : ''}
      <div class="note-actions">
        <button class="note-action-btn copy" title="Copy note content">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
        <button class="note-action-btn delete" title="Delete note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/>
          </svg>
        </button>
      </div>
    `;

    // Attach event listeners
    const copyBtn = noteElement.querySelector('.copy');
    const deleteBtn = noteElement.querySelector('.delete');
    const expandBtn = noteElement.querySelector('.expand-btn');

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.copyToClipboard(note.content, copyBtn);
    });

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteNote(note.id);
    });

    if (expandBtn) {
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleNoteExpansion(noteElement, note, expandBtn);
      });
    }

    return noteElement;
  }

  createNoteTitle(content) {
    // Extract first line or first 50 characters as title
    const firstLine = content.split('\n')[0];
    const title = firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
    return this.escapeHtml(title);
  }

  toggleNoteExpansion(noteElement, note, button) {
    const contentElement = noteElement.querySelector('.note-content');
    const isExpanded = button.dataset.expanded === 'true';
    
    if (isExpanded) {
      contentElement.innerHTML = this.highlightSearch(note.content.substring(0, 300) + '...');
      contentElement.classList.add('truncated');
      button.textContent = 'Show more';
      button.dataset.expanded = 'false';
    } else {
      contentElement.innerHTML = this.highlightSearch(note.content);
      contentElement.classList.remove('truncated');
      button.textContent = 'Show less';
      button.dataset.expanded = 'true';
    }
  }

  formatTime(date) {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
  }

  formatDate(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
      });
    }
  }

  highlightSearch(content) {
    if (!this.currentSearch) return this.escapeHtml(content);
    
    const escapedContent = this.escapeHtml(content);
    const searchRegex = new RegExp(`(${this.escapeRegex(this.currentSearch)})`, 'gi');
    return escapedContent.replace(searchRegex, '<span class="search-highlight">$1</span>');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async handleSearch() {
    const query = this.searchInput.value.trim();

    if (query === this.currentSearch) return;

    this.currentSearch = query;
    this.clearSearchBtn.style.display = query ? 'block' : 'none';

    if (query) {
      this.isLoading = true;
      this.showLoading();
      try {
        const result = await ipcRenderer.invoke('database-search-notes', query, 1000, 0);
        this.filteredNotes = result.notes || [];
        this.renderNotes();
      } catch (error) {
        console.error('Error searching notes:', error);
        this.showError('Failed to search notes');
      } finally {
        this.isLoading = false;
      }
    } else {
      this.applyCurrentFilter();
    }
  }

  clearSearch() {
    this.searchInput.value = '';
    this.currentSearch = '';
    this.clearSearchBtn.style.display = 'none';
    this.updateContentTitle(this.currentFilter);
    this.applyCurrentFilter();
    this.searchInput.focus();
  }

  async deleteNote(noteId) {
    if (!confirm('Are you sure you want to delete this note?')) {
      return;
    }

    const noteElement = document.querySelector(`[data-note-id="${noteId}"]`);
    if (noteElement) {
      noteElement.classList.add('deleting');
    }

    try {
      const success = await ipcRenderer.invoke('database-delete-note', noteId);
      if (success) {
        // Remove from local arrays
        this.allNotes = this.allNotes.filter(note => note.id !== noteId);
        this.filteredNotes = this.filteredNotes.filter(note => note.id !== noteId);
        
        // Update UI
        setTimeout(() => {
          if (noteElement) {
            noteElement.remove();
          }
          this.updateFilterCounts();
          if (this.filteredNotes.length === 0) {
            this.showEmptyState();
          }
        }, 400);
      } else {
        if (noteElement) {
          noteElement.classList.remove('deleting');
        }
        alert('Failed to delete note');
      }
    } catch (error) {
      console.error('Error deleting note:', error);
      if (noteElement) {
        noteElement.classList.remove('deleting');
      }
      alert('Failed to delete note');
    }
  }

  copyToClipboard(text, button) {
    navigator.clipboard.writeText(text).then(() => {
      button.classList.add('copying');
      const originalInner = button.innerHTML;
      
      button.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;
      
      setTimeout(() => {
        button.innerHTML = originalInner;
        button.classList.remove('copying');
      }, 1500);
    }, (err) => {
      console.error('Could not copy text: ', err);
    });
  }

  openSettings() {
    ipcRenderer.send('open-settings-window');
  }

  toggleSidebar() {
    this.sidebar.classList.toggle('collapsed');
  }

  shortenUrl(url) {
    if (!url) return '';
    
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace('www.', '');
      const path = urlObj.pathname;
      
      // Show domain + short path
      if (path && path !== '/') {
        const shortPath = path.length > 20 ? path.substring(0, 20) + '...' : path;
        return `${domain}${shortPath}`;
      }
      
      return domain;
    } catch (e) {
      // If URL parsing fails, just show first 30 chars
      return url.length > 30 ? url.substring(0, 30) + '...' : url;
    }
  }

  // State management methods
  showLoading() {
    this.hideAllStates();
    this.loadingState.style.display = 'flex';
  }

  showEmptyState() {
    this.hideAllStates();
    this.emptyState.style.display = 'flex';
  }

  showError(message) {
    this.hideAllStates();
    this.notesList.innerHTML = `
      <div class="error-state">
        <h3>Error</h3>
        <p>${message}</p>
      </div>
    `;
  }

  hideAllStates() {
    this.loadingState.style.display = 'none';
    this.emptyState.style.display = 'none';
  }
}

// Initialize the renderer when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new NotesRenderer();
});