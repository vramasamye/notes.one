# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - 2025-08-10

### Fixed
- Fixed notes display issue where notes were not showing in the UI due to missing DOM element references
- Fixed sidebar collapsed state initialization

### Changed  
- Sidebar now starts collapsed by default for better initial user experience
- Default filter changed from 'today' to 'all' for better compatibility with existing filter options
- Improved DOM element initialization in renderer process

### Technical
- Added proper initialization for all DOM elements (notesList, loadingState, emptyState, filterItems, etc.)
- Fixed renderer.js missing element references that caused silent failures
- Updated HTML to include 'collapsed' class by default on sidebar
- Set 'All Notes' as the default active filter

## [0.0.1] - 2025-08-09

### Added
- Initial release of notes.one
- Background note capture with global keyboard shortcuts
- SQLite database with full-text search
- Modern UI with shadcn/ui inspired design
- Support for both regular and encrypted databases
- Global shortcut customization including double-key press shortcuts
- Dark mode support
- Note editing and management features
- Cross-platform support (macOS, Windows, Linux)
- Auto-updater integration
- System tray integration
- Version history support (optional)