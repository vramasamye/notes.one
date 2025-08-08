const { ipcRenderer } = require('electron');

class NotesRenderer {
  constructor() {
    this.currentFilter = 'today';
    this.currentSearch = '';
    this.allNotes = [];
    this.filteredNotes = [];
    this.isLoading = false;
    this.customTitles = {};
    
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
    this.sidebar.classList.add('collapsed');
    this.filterItems = document.querySelectorAll('.filter-item');
    this.allNotesCount = document.getElementById('allNotesCount');
    this.last7DaysCount = document.getElementById('last7DaysCount');
    this.last30DaysCount = document.getElementById('last30DaysCount');
    
    // Content elements
    
    this.notesList = document.getElementById('notesList');
    this.emptyState = document.getElementById('emptyState');
    this.loadingState = document.getElementById('loadingState');
    this.dateBadge = document.getElementById('dateBadge');
    this.shortcutHint = document.getElementById('shortcutHint');
    this.shortcutCurrent = document.getElementById('shortcutCurrent');

    // In-app settings elements
    this.settingsOverlay = document.getElementById('settingsOverlay');
    this.settingsClose = document.getElementById('settingsClose');
    this.inShortcut = document.getElementById('inShortcut');
    this.inTestShortcut = document.getElementById('inTestShortcut');
    this.inShortcutStatus = document.getElementById('inShortcutStatus');
    this.inTheme = document.getElementById('inTheme');
    this.inOpenAccess = document.getElementById('inOpenAccess');
    this.inAccessStatus = document.getElementById('inAccessStatus');
    this.inSave = document.getElementById('inSave');
    this.inCancel = document.getElementById('inCancel');
    this.inVersionHistory = document.getElementById('inVersionHistory');
    this.currentSettings = {};
    this.originalSettings = {};
  }

  attachEventListeners() {
    // Search functionality
    this.searchInput.addEventListener('input', this.debounce(this.handleSearch.bind(this), 300));
    this.clearSearchBtn.addEventListener('click', this.clearSearch.bind(this));
    
    // Settings button (open in-app panel)
    this.settingsBtn.addEventListener('click', () => this.showSettingsPanel());
    
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
        this.closeNoteModal();
      }
    });

    // IPC event listeners
    ipcRenderer.on('focus-search', () => {
      this.searchInput.focus();
    });

    ipcRenderer.on('reload-notes', () => {
      this.loadNotes();
    });

    ipcRenderer.on('theme-changed', (event, theme) => {
      this.applyTheme(theme);
    });

    // Update shortcut hint when settings change
    ipcRenderer.on('settings-changed', (event, settings) => {
      if (settings && settings.globalShortcut) {
        this.updateShortcutHint(settings.globalShortcut);
      }
    });

    this.notesList.addEventListener('scroll', this.handleScroll.bind(this));
    
    // Close modal when clicking outside
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        this.closeNoteModal();
      }
    });

    // In-app settings listeners
    if (this.settingsOverlay) {
      this.settingsClose.addEventListener('click', () => this.hideSettingsPanel());
      this.inCancel.addEventListener('click', () => this.hideSettingsPanel());
      this.inSave.addEventListener('click', () => this.savePanelSettings());
      this.inTestShortcut.addEventListener('click', () => this.testPanelShortcut());
      this.inShortcut.addEventListener('change', () => this.onPanelChanged());
      this.inTheme.addEventListener('change', () => this.onPanelChanged());
      this.inOpenAccess.addEventListener('click', async () => {
        await ipcRenderer.invoke('open-accessibility-settings');
      });
    }
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
      // Load custom titles
      try {
        this.customTitles = JSON.parse(localStorage.getItem('customNoteTitles') || '{}');
      } catch { this.customTitles = {}; }
      // Initialize shortcut hint from current settings
      const currentSettings = await ipcRenderer.invoke('get-settings');
      this.updateShortcutHint(currentSettings?.globalShortcut || 'CommandOrControl+Shift+C');
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
    this.allNotesCount.textContent = String(this.allNotes.length);
    if (this.last7DaysCount) this.last7DaysCount.textContent = String(last7DaysCount);
    if (this.last30DaysCount) this.last30DaysCount.textContent = String(last30DaysCount);
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

  updateContentTitle(filter) {
    // This method updates the content area title based on current filter
    // Implementation can be added if needed for UI consistency
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
    // Infinite load
    if (this.notesList.scrollTop + this.notesList.clientHeight >= this.notesList.scrollHeight - 200) {
      this.loadMoreNotes();
    }

    // Update floating date badge
    this.updateDateBadgeOnScroll();
  }

  updateDateBadgeOnScroll() {
    if (!this.dateBadge) return;
    const headers = this.notesList.querySelectorAll('.note-group-header');
    let current = null;
    const containerTop = this.notesList.getBoundingClientRect().top;
    headers.forEach(h => {
      const rect = h.getBoundingClientRect();
      if (rect.top - containerTop <= 30) {
        current = h.textContent.trim();
      }
    });
    // Hide all headers and only show the one just above viewport to avoid duplication
    headers.forEach(h => h.classList.add('hidden'));
    if (current) {
      this.dateBadge.style.display = 'block';
      this.dateBadge.textContent = current;
      // Find header with same text nearest to top and reveal it slightly when near top to keep structure
      for (const h of headers) {
        if (h.textContent.trim() === current) {
          h.classList.add('hidden');
        }
      }
    } else {
      this.dateBadge.style.display = 'none';
      headers.forEach(h => h.classList.remove('hidden'));
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

    // Refresh badge after render
    this.updateDateBadgeOnScroll();
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
    
    const customTitle = this.customTitles[String(note.id)];
    const displayTitle = customTitle || this.createNoteTitle(note.content);
    const isLong = note.content.length > 300;
    const truncatedContent = isLong ? note.content.substring(0, 300) + '...' : note.content;
    const displayContent = this.highlightSearch(truncatedContent);

    const enableHistory = (this.currentSettings && this.currentSettings.enableVersionHistory);
    noteElement.innerHTML = `
      <div class="note-header">
        <div class="note-title">${this.escapeHtml(displayTitle)}</div>
      </div>
      <div class="note-content${isLong ? ' truncated' : ''}">${displayContent}</div>
      ${isLong ? '<button class="expand-btn" data-expanded="false">Show more</button>' : ''}
      <div class="note-footer">
        <div class="note-meta">
          ${note.url ? `<a href="${this.escapeHtml(note.url)}" target="_blank" class="note-url" rel="noopener noreferrer" title="${this.escapeHtml(note.url)}">${this.escapeHtml(this.shortenUrl(note.url))}</a>` : ''}
          <div class="note-source">${this.escapeHtml(note.source || 'Unknown')}</div>
          <div class="note-time" title="${timestamp.toLocaleString()}">${timeString}</div>
        </div>
      </div>
      <div class="note-actions">
        <button class="note-action-btn edit" title="Edit note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        ${enableHistory ? `
        <button class="note-action-btn history" title="View version history">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
            <path d="M3 3v5h5"></path>
            <path d="M12 7v5l4 2"></path>
          </svg>
        </button>` : ''}
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
    const editBtn = noteElement.querySelector('.edit');
    const historyBtn = noteElement.querySelector('.history');
    const copyBtn = noteElement.querySelector('.copy');
    const deleteBtn = noteElement.querySelector('.delete');
    const expandBtn = noteElement.querySelector('.expand-btn');

    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.editNote(note);
    });

    if (historyBtn) {
      historyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showNoteHistory(note);
      });
    }

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
    // Custom confirm dialog to avoid Electron default icon
    const confirmed = await this.showConfirmDialog('Delete Note', 'Are you sure you want to delete this note?');
    if (!confirmed) return;

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

  showConfirmDialog(title, message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-content" style="max-width:420px">
          <div class="modal-header">
            <h3>${this.escapeHtml(title)}</h3>
            <button class="modal-close" aria-label="Close">✕</button>
          </div>
          <div class="modal-body">
            <p style="margin:0 0 12px 0">${this.escapeHtml(message)}</p>
          </div>
          <div class="modal-actions">
            <button class="btn-secondary" data-action="cancel">Cancel</button>
            <button class="btn-danger" data-action="ok">Delete</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const close = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.querySelector('.modal-close')?.addEventListener('click', () => close(false));
      overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
      overlay.querySelector('[data-action="ok"]').addEventListener('click', () => close(true));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(false);
      });
    });
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
    // Deprecated external settings window. Use in-app panel instead.
    this.showSettingsPanel();
  }

  async showSettingsPanel() {
    try {
      const cfg = await ipcRenderer.invoke('get-settings');
      this.currentSettings = { ...cfg };
      this.originalSettings = { ...cfg };
      this.inShortcut.value = this.currentSettings.globalShortcut || 'CommandOrControl+Shift+C';
      this.inTheme.checked = this.currentSettings.theme === 'dark';
      this.inSave.disabled = true;
      this.inSave.textContent = 'No Changes';
      if (this.inVersionHistory) {
        this.inVersionHistory.checked = !!this.currentSettings.enableVersionHistory;
        this.inVersionHistory.addEventListener('change', () => this.onPanelChanged());
      }
      // accessibility
      const isGranted = await ipcRenderer.invoke('check-accessibility');
      this.updateAccessIndicator(isGranted);
      this.settingsOverlay.style.display = 'flex';
    } catch (e) {
      console.error('Failed to open settings:', e);
    }
  }

  hideSettingsPanel() {
    if (this.settingsOverlay) this.settingsOverlay.style.display = 'none';
    this.inShortcutStatus.textContent = '';
  }

  onPanelChanged() {
    this.currentSettings.globalShortcut = this.inShortcut.value;
    this.currentSettings.theme = this.inTheme.checked ? 'dark' : 'light';
    if (this.inVersionHistory) {
      this.currentSettings.enableVersionHistory = this.inVersionHistory.checked;
    }
    const changed = JSON.stringify(this.currentSettings) !== JSON.stringify(this.originalSettings);
    this.inSave.disabled = !changed;
    this.inSave.textContent = changed ? 'Save Changes' : 'No Changes';
  }

  updateAccessIndicator(isGranted) {
    this.inAccessStatus.classList.remove('granted', 'denied', 'checking');
    if (isGranted) {
      this.inAccessStatus.textContent = 'Granted';
      this.inAccessStatus.classList.add('granted');
    } else {
      this.inAccessStatus.textContent = 'Required';
      this.inAccessStatus.classList.add('denied');
    }
  }

  async testPanelShortcut() {
    try {
      this.inTestShortcut.disabled = true;
      this.inTestShortcut.textContent = 'Testing...';
      this.inShortcutStatus.textContent = 'Testing shortcut...';
      const result = await ipcRenderer.invoke('test-shortcut', this.inShortcut.value);
      this.inShortcutStatus.textContent = result.success ? 'Shortcut works!' : (result.error || 'Shortcut failed');
    } catch (e) {
      this.inShortcutStatus.textContent = 'Error testing shortcut';
    } finally {
      this.inTestShortcut.disabled = false;
      this.inTestShortcut.textContent = 'Test';
    }
  }

  async savePanelSettings() {
    try {
      const result = await ipcRenderer.invoke('save-settings', this.currentSettings);
      if (result.success) {
        this.originalSettings = { ...this.currentSettings };
        this.inSave.disabled = true;
        this.inSave.textContent = 'Saved';
        // Apply theme immediately
        this.applyTheme(this.currentSettings.theme);
        setTimeout(() => this.hideSettingsPanel(), 600);
      } else {
        this.inShortcutStatus.textContent = result.error || 'Failed to save settings';
      }
    } catch (e) {
      this.inShortcutStatus.textContent = 'Error saving settings';
    }
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

  // Note editing functionality
  editNote(note) {
    // Do not mutate content; only allow editing a custom display title
    const customTitle = this.customTitles[String(note.id)] || this.createNoteTitle(note.content);
    note.title = customTitle;
    this.showNoteModal(note, 'edit');
  }

  // Show note history
  async showNoteHistory(note) {
    try {
      const history = await ipcRenderer.invoke('database-get-note-history', note.id);
      this.showNoteModal(note, 'history', history);
    } catch (error) {
      console.error('Error loading note history:', error);
      alert('Failed to load note history');
    }
  }

  // Show note modal (edit or history)
  showNoteModal(note, mode, history = null) {
    // Remove existing modal if any
    this.closeNoteModal();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = this.createNoteModalHtml(note, mode, history);

    document.body.appendChild(modal);

    // Hide floating date badge while modal is open
    if (this.dateBadge) this.dateBadge.style.display = 'none';

    // Attach modal event listeners
    this.attachModalEventListeners(modal, note, mode);

    // Focus on textarea if in edit mode
    if (mode === 'edit') {
      const textarea = modal.querySelector('#noteContent');
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    }
  }

  createNoteModalHtml(note, mode, history = null) {
    const isEdit = mode === 'edit';
    const isHistory = mode === 'history';
    const title = note.title || this.createNoteTitle(note.content);
    const content = note.content || '';

    return `
      <div class="modal-content ${mode}-modal">
        <div class="modal-header">
          <h3>${isEdit ? 'Edit Note' : 'Version History'}</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div class="modal-body">
          ${isEdit ? `
            <div class="note-meta-info" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:16px;">
              <div class="meta-item"><strong>Source:</strong> ${this.escapeHtml(note.source || 'Unknown')}</div>
              <div class="meta-item"><strong>Created:</strong> ${new Date(note.timestamp).toLocaleString()}</div>
              ${note.version ? `<div class="meta-item"><strong>Version:</strong> ${note.version}</div>` : ''}
            </div>
            
            <div class="edit-form">
              <div class="form-group">
                <label for="noteTitle">Title</label>
                <input type="text" id="noteTitle" value="${this.escapeHtml(title)}" placeholder="Add a clear title" maxlength="160">
              </div>
              <div class="form-group">
                <label for="noteContent">Content</label>
                <textarea id="noteContent" rows="1" readonly>${this.escapeHtml(content)}</textarea>
              </div>
            </div>
            
            <div class="modal-actions">
              <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
              <button class="btn-primary" id="saveNote">Save</button>
            </div>
          ` : ''}
          
          ${isHistory ? `
            <div class="note-info">
              <h4>${this.createNoteTitle(note.content)}</h4>
              <div class="note-meta-info">
                <div class="meta-item">
                  <strong>Source:</strong> ${this.escapeHtml(note.source || 'Unknown')}
                </div>
                <div class="meta-item">
                  <strong>Current Version:</strong> ${note.version || 1}
                </div>
              </div>
            </div>
            
            <div class="history-list">
              ${history && history.length > 0 ? history.map(version => `
                <div class="history-item" data-version="${version.version}">
                  <div class="history-header">
                    <div class="version-info">
                      <strong>Version ${version.version}</strong>
                      <span class="change-type ${version.change_type}">${this.formatChangeType(version.change_type)}</span>
                    </div>
                    <div class="version-date">${new Date(version.created_at).toLocaleString()}</div>
                  </div>
                  <div class="history-content">
                    ${this.escapeHtml(version.content.substring(0, 200))}${version.content.length > 200 ? '...' : ''}
                  </div>
                  <div class="history-actions">
                    <button class="btn-small view-version" data-version="${version.version}">View Full</button>
                    ${version.version !== note.version ? `
                      <button class="btn-small restore-version" data-version="${version.version}">Restore</button>
                    ` : ''}
                  </div>
                </div>
              `).join('') : '<div class="no-history">No version history available</div>'}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  attachModalEventListeners(modal, note, mode) {
    if (mode === 'edit') {
      const saveBtn = modal.querySelector('#saveNote');
      const titleInput = modal.querySelector('#noteTitle');
      const contentInput = modal.querySelector('#noteContent');
      
      if (saveBtn && titleInput) {
        saveBtn.addEventListener('click', async () => {
          const title = titleInput.value.trim();
          // Persist only custom title locally
          this.customTitles[String(note.id)] = title || this.createNoteTitle(note.content);
          localStorage.setItem('customNoteTitles', JSON.stringify(this.customTitles));
          this.closeNoteModal();
          this.applyCurrentFilter();
        });

        // Allow saving with Cmd/Ctrl + Enter
        titleInput.addEventListener('keydown', (e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            saveBtn.click();
          }
        });

        // Auto-resize read-only content to fit text
        if (contentInput) {
          const autoresize = () => {
            contentInput.style.height = 'auto';
            const maxHeight = Math.min(400, contentInput.scrollHeight);
            contentInput.style.height = `${maxHeight}px`;
          };
          setTimeout(autoresize); // after styles apply
          window.addEventListener('resize', autoresize, { once: true });
        }
      }
    } else if (mode === 'history') {
      // View version buttons
      modal.querySelectorAll('.view-version').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const version = parseInt(e.target.dataset.version);
          this.showVersionContent(note, version);
        });
      });

      // Restore version buttons
      modal.querySelectorAll('.restore-version').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const version = parseInt(e.target.dataset.version);
          this.showConfirmDialog('Restore Version', `Are you sure you want to restore to version ${version}? This will create a new version with the restored content.`).then(async (ok) => {
            if (!ok) return;
            try {
              const success = await ipcRenderer.invoke('database-restore-note-version', note.id, version);
              if (success) {
                this.closeNoteModal();
                this.loadNotes(); // Reload notes to show restored content
              } else {
                alert('Failed to restore version');
              }
            } catch (error) {
              console.error('Error restoring version:', error);
              alert('Failed to restore version');
            }
          });
        });
      });
    }
  }

  async showVersionContent(note, version) {
    try {
      const history = await ipcRenderer.invoke('database-get-note-history', note.id);
      const versionData = history.find(v => v.version === version);
      
      if (versionData) {
        // Create a new modal for viewing the full version content
        const viewModal = document.createElement('div');
        viewModal.className = 'modal-overlay version-view';
        viewModal.innerHTML = `
          <div class="modal-content">
            <div class="modal-header">
              <h3>Version ${version} - ${this.formatChangeType(versionData.change_type)}</h3>
              <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div class="modal-body">
              <div class="version-meta">
                <strong>Date:</strong> ${new Date(versionData.created_at).toLocaleString()}
              </div>
              <div class="version-content-full">
                ${this.escapeHtml(versionData.content).replace(/\n/g, '<br>')}
              </div>
              <div class="modal-actions">
                <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
                <button class="btn-primary copy-version">Copy Content</button>
              </div>
            </div>
          </div>
        `;

        document.body.appendChild(viewModal);

        // Add copy functionality
        const copyBtn = viewModal.querySelector('.copy-version');
        copyBtn.addEventListener('click', () => {
          this.copyToClipboard(versionData.content, copyBtn);
        });
      }
    } catch (error) {
      console.error('Error loading version content:', error);
      alert('Failed to load version content');
    }
  }

  formatChangeType(changeType) {
    const types = {
      'create': 'Created',
      'update': 'Updated',
      'delete': 'Deleted',
      'restore': 'Restored'
    };
    
    if (changeType.startsWith('restore_v')) {
      return `Restored from v${changeType.split('_v')[1]}`;
    }
    
    return types[changeType] || changeType;
  }

  closeNoteModal() {
    const modals = document.querySelectorAll('.modal-overlay');
    modals.forEach(modal => modal.remove());
    // Restore date badge
    this.updateDateBadgeOnScroll();
  }

  applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  updateShortcutHint(shortcut) {
    if (this.shortcutHint) {
      this.shortcutHint.textContent = this.formatShortcutForText(shortcut);
    }
    if (this.shortcutCurrent) {
      this.shortcutCurrent.innerHTML = this.formatShortcutForKeycaps(shortcut);
    }
  }

  formatShortcutForText(shortcut) {
    const map = {
      'CommandOrControl': navigator.platform.includes('Mac') ? '⌘' : 'Ctrl',
      'Shift': 'Shift',
      'Alt': navigator.platform.includes('Mac') ? '⌥' : 'Alt',
      'Option': '⌥',
      'Command': '⌘',
      'Control': 'Ctrl',
    };
    let display = shortcut
      .replace(/CommandOrControl/g, map['CommandOrControl'])
      .replace(/Command/g, map['Command'])
      .replace(/Control/g, map['Control'])
      .replace(/Alt/g, map['Alt'])
      .replace(/Shift/g, map['Shift']);

    if (shortcut.startsWith('Double')) {
      const name = shortcut.replace('Double', '').replace('Right', 'Right ').replace('Left', 'Left ');
      display = `Double ${name}`;
    }
    return display;
  }

  formatShortcutForKeycaps(shortcut) {
    if (shortcut.startsWith('Double')) {
      const label = shortcut
        .replace('Double', 'Double')
        .replace('RightAlt', 'Right ⌥')
        .replace('RightShift', 'Right Shift')
        .replace('LeftAlt', 'Left ⌥')
        .replace('LeftShift', 'Left Shift');
      return `<span class="double-label">${this.escapeHtml(label)}</span>`;
    }

    const parts = shortcut.split('+').map(s => s.trim()).map(s => {
      if (s === 'CommandOrControl') return navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
      if (s === 'Command') return '⌘';
      if (s === 'Control') return 'Ctrl';
      if (s === 'Alt') return navigator.platform.includes('Mac') ? '⌥' : 'Alt';
      return s;
    });
    return parts.map(p => `<kbd>${this.escapeHtml(p)}</kbd>`).join(' <span class="sep">+</span> ');
  }
}

// Initialize the renderer when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new NotesRenderer();
});
