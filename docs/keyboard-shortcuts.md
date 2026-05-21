# Keyboard Shortcuts

otto web interface supports vim-style keyboard shortcuts for efficient navigation and git operations.

## Navigation Shortcuts

### Global

- **Ctrl+H** - Navigate to left sidebar (sessions)
  - Opens left sidebar and focuses session list
  - Press again to return to center (collapses left sidebar)
  - Auto-collapses right sidebar if open

- **Ctrl+L** - Navigate to right sidebar (git)
  - Opens right sidebar and focuses file list
  - Press again to return to center (collapses right sidebar)
  - Auto-collapses left sidebar if open

- **Ctrl+/** - Toggle left sidebar collapse/expand

- **Ctrl+\\** - Toggle right sidebar collapse/expand

- **Ctrl+J / Cmd+J** - Toggle terminal panel open/closed

- **Ctrl+N** - Create new session

- **ESC** - Close sidebar and return to center
  - Closes current sidebar if focused on left or right
  - Returns focus to chat input

### Session List (when focused with Ctrl+H)

- **J** - Navigate to next session
- **K** - Navigate to previous session
- **Enter** - Select focused session and return to input

### Git Panel (when focused with Ctrl+L)

- **J** - Navigate to next file
- **K** - Navigate to previous file
- **Space** - Toggle stage/unstage for focused file
- **A** - Stage all unstaged files
- **U** - Unstage all staged files
- **C** - Open commit modal (if files are staged)
- **Diff preview** - Automatically shown when file is focused (no need to press Enter)
- **Space** - Also shows diff when toggling stage/unstage

## Visual Indicators

- Focused items show a blue ring highlight
- Session list: ring around entire session item
- Git panel: ring around file item
- Auto-scrolls to keep focused item visible

## Implementation Details

The keyboard shortcuts system consists of:

- **Focus Store** (`packages/web-sdk/src/stores/focusStore.ts`) - Tracks current focus area and navigation indices
- **useKeyboardShortcuts Hook** (`packages/web-sdk/src/hooks/useKeyboardShortcuts.ts`) - Manages global keyboard event handling
- **Visual Focus** - Components show ring highlights for focused items with auto-scroll

### Adding New Shortcuts

To add new keyboard shortcuts:

1. Update the `useKeyboardShortcuts` hook to handle the new key combination
2. Add the callback handler to the hook's options interface
3. Wire up the callback in `SessionsLayout`
4. Update this documentation

### Notes

- Shortcuts are disabled when typing in input fields or textareas
- Ctrl or Cmd (Mac) modifiers work for system shortcuts
- Vim-style navigation (j/k) requires focus on a specific panel
- All shortcuts prevent default browser behavior
