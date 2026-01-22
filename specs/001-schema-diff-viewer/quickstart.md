# Schema Diff Viewer - Quickstart Guide

> Development guide for implementing the Schema Diff Viewer feature in vscode-mssql.

## Prerequisites

- **Node.js**: v18.x or higher
- **VS Code**: Latest stable version
- **Git**: For version control
- **SQL Server**: Local instance or Azure SQL for testing

## Getting Started

### 1. Clone and Setup

```bash
# Clone the repository (if not already done)
git clone https://github.com/microsoft/vscode-mssql.git
cd vscode-mssql

# Checkout the feature branch
git checkout 001-schema-diff-viewer

# Install dependencies
npm install
```

### 2. Build the Extension

```bash
# Navigate to mssql extension
cd extensions/mssql

# Build extension and webviews
npm run build

# Or build only React webviews (faster during development)
npm run build:webviews
```

### 3. Launch Development

1. Open VS Code in the repository root
2. Press `F5` to launch Extension Development Host
3. In the new window:
   - Connect to a SQL Server database
   - Open Schema Designer (right-click database → "Edit Schema")
   - Make changes to test the diff viewer

## Project Structure

```
extensions/mssql/src/
├── schemaDesigner/
│   ├── schemaDesignerWebviewController.ts   # Main webview controller
│   └── [new] diffCalculator.ts              # Diff calculation service
│
├── sharedInterfaces/
│   └── schemaDesigner.ts                    # Shared TypeScript interfaces
│
└── reactviews/pages/SchemaDesigner/
    ├── schemaDesignerStateProvider.tsx      # State management
    ├── schemaDesigner.tsx                   # Main component
    ├── toolbar.tsx                          # Toolbar with new button
    └── [new] diffViewer/                    # New diff viewer module
        ├── DiffViewerDrawer.tsx
        ├── ChangeGroup.tsx
        ├── ChangeItem.tsx
        ├── diffViewerContext.tsx
        ├── diffViewerHooks.ts
        └── diffViewer.module.css
```

## Key Files to Modify

### Phase 1: Core Infrastructure

| File | Changes |
|------|---------|
| `sharedInterfaces/schemaDesigner.ts` | Add DiffViewer interfaces |
| `reactviews/common/eventBus.ts` | Add diff viewer events |
| New: `diffViewer/diffViewerContext.tsx` | State management context |
| New: `schemaDesigner/diffCalculator.ts` | Diff calculation logic |

### Phase 2: UI Components

| File | Changes |
|------|---------|
| New: `diffViewer/DiffViewerDrawer.tsx` | Main drawer component |
| New: `diffViewer/ChangeGroup.tsx` | Collapsible table groups |
| New: `diffViewer/ChangeItem.tsx` | Individual change rows |
| `toolbar.tsx` | Add "Show Changes (N)" button |

### Phase 3: Integration

| File | Changes |
|------|---------|
| `schemaDesignerStateProvider.tsx` | Wire up diff context |
| `schemaDesigner.tsx` | Add drawer to layout |
| Canvas components | Add visual change indicators |

## Development Workflow

### Running Tests

```bash
# Unit tests
npm test

# Tests with coverage
npm run test:coverage

# E2E tests (requires Playwright)
npx playwright test
```

### Debugging React Components

1. In Extension Development Host, open DevTools:
   - `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Shift+I` (Mac)
2. Use React DevTools extension for component inspection
3. Console logs appear in DevTools console

### Debugging TypeScript

1. Set breakpoints in VS Code
2. Use "Extension Tests" launch config for test debugging
3. Use "Run Extension" for runtime debugging

## Key Patterns

### Using EventBus

```typescript
import { eventBus } from "../common/eventBus";

// Emit event
eventBus.emit("diffDrawer:toggle", { isOpen: true });

// Subscribe
useEffect(() => {
    const unsubscribe = eventBus.on("diffDrawer:countsUpdated", 
        ({ counts }) => setChangeCounts(counts)
    );
    return unsubscribe;
}, []);
```

### Using Fluent UI

```tsx
import {
    InlineDrawer,
    DrawerHeader,
    DrawerBody,
    Button,
    Badge
} from "@fluentui/react-components";

// Component example
<InlineDrawer open={isOpen} position="end">
    <DrawerHeader>
        <span>Schema Changes</span>
    </DrawerHeader>
    <DrawerBody>
        {/* Content */}
    </DrawerBody>
</InlineDrawer>
```

### Theme-Compatible Styling

```css
/* Use VS Code CSS variables */
.change-item--addition {
    border-left: 3px solid var(--vscode-gitDecoration-addedResourceForeground);
}

.change-item--modification {
    border-left: 3px solid var(--vscode-gitDecoration-modifiedResourceForeground);
}

.change-item--deletion {
    border-left: 3px solid var(--vscode-gitDecoration-deletedResourceForeground);
}
```

## Testing Checklist

### Manual Testing

- [ ] Open Schema Designer with existing database
- [ ] Add a new table → verify addition indicator
- [ ] Modify a column → verify modification indicator
- [ ] Delete a foreign key → verify deletion indicator
- [ ] Open diff drawer → verify changes grouped by table
- [ ] Click change → verify canvas navigates to element
- [ ] Click undo → verify change reverts
- [ ] Close/reopen drawer → verify state persists
- [ ] Test in Light and Dark themes

### Performance Testing

- [ ] Schema with 50+ tables: drawer opens in <500ms
- [ ] 100+ changes: list renders smoothly (no jank)
- [ ] Rapid undo/redo: counter updates in real-time

## Useful Links

- [Fluent UI React Components](https://react.fluentui.dev/)
- [ReactFlow Documentation](https://reactflow.dev/docs)
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [Feature Spec](./spec.md)
- [Data Model](./data-model.md)
- [Research Notes](./research.md)

## Troubleshooting

### Build Errors

```bash
# Clean rebuild
npm run clean
npm install
npm run build
```

### Webview Not Updating

1. Stop debugging
2. Delete `extensions/mssql/dist/` folder
3. Rebuild and restart

### Tests Failing

```bash
# Run specific test file
npm test -- --grep "DiffCalculator"

# Run with verbose output
npm test -- --reporter spec
```
