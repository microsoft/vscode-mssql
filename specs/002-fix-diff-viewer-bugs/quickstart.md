# Quickstart: Fix Diff Viewer Bugs

**Feature**: 002-fix-diff-viewer-bugs | **Date**: 2026-01-21

## Prerequisites

- Node.js v20.19.4+
- Yarn v1.22+
- VS Code (for testing the extension)

## Setup

```bash
# Navigate to mssql extension
cd extensions/mssql

# Install dependencies
yarn install

# Build extension
yarn build
```

## Development Workflow

```bash
# Watch mode for development
yarn watch

# Run unit tests
yarn test

# Lint source files
yarn lint src/ test/

# Run specific test file
yarn test --grep "ChangeCountTracker"
```

## Testing Changes

### Manual Testing

1. Open VS Code with the extension in development mode (F5)
2. Connect to a database
3. Open Schema Designer
4. Make schema changes (add table, modify column, delete foreign key)
5. Verify:
   - Toolbar button count updates without opening drawer
   - All colors are consistent (green=#73c991, amber=#e2c08d, red=#c74e39)
   - Drawer styling matches VS Code sidebar
   - Deleted tables show red border when drawer open

### Unit Tests

```bash
# Run all diff viewer tests
yarn test --grep "diffViewer"

# Run specific test
yarn test --grep "color standardization"
```

## Key Files

| File | Purpose |
|------|---------|
| `diffViewer/colorConstants.ts` | Centralized color definitions |
| `diffViewer/diffViewerContext.tsx` | Context and state management |
| `diffViewer/changeCountTracker.ts` | Live count tracking service |
| `toolbar/showChangesButton.tsx` | Toolbar button with safe context |
| `graph/schemaDesignerTableNode.tsx` | Table node with diff indicators |
| `diffViewer/diffViewer.css` | CSS styles with standardized colors |

## Validation Checklist

Before committing, run:

```bash
yarn build                 # Must pass
yarn test                  # Must pass
yarn lint src/ test/       # Must pass
yarn package --online      # Must create VSIX < 25MB
```
