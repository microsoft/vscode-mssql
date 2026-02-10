# Quickstart: Profiler Column-Level Filtering

**Feature**: 001-profiler-column-filter
**Date**: February 4, 2026

## Prerequisites

- Node.js >= 20.19.4
- Yarn >= 1.22
- VS Code >= 1.98.0

## Setup

```bash
# Navigate to mssql extension
cd extensions/mssql

# Install dependencies
yarn install

# Build the extension
yarn build
```

## Development Workflow

### 1. Run in Watch Mode

```bash
cd extensions/mssql
yarn watch
```

Press F5 in VS Code to launch Extension Development Host.

### 2. Run Tests

```bash
cd extensions/mssql

# Run all profiler tests
yarn test --grep "profiler"

# Run specific test file
yarn test --grep "FilteredBuffer"

# Run with coverage
yarn test:coverage
```

### 3. Lint Changes

```bash
cd extensions/mssql
yarn lint src/ test/
```

### 4. Build and Package

```bash
cd extensions/mssql
yarn build
yarn package
```

## Key Files to Modify

| File | Purpose |
|------|---------|
| `src/profiler/filteredBuffer.ts` | Add quick filter and column filter support |
| `src/profiler/profilerTypes.ts` | Add new filter type interfaces |
| `src/sharedInterfaces/profiler.ts` | Add column filter metadata, reducers |
| `src/profiler/profilerWebviewController.ts` | Handle new filter reducers |
| `src/reactviews/pages/Profiler/profiler.tsx` | Add funnel icons to headers |
| `src/reactviews/pages/Profiler/profilerToolbar.tsx` | Add quick filter input |

## Key Files to Create

| File | Purpose |
|------|---------|
| `src/reactviews/pages/Profiler/components/ColumnFilterPopover.tsx` | Main popover container |
| `src/reactviews/pages/Profiler/components/CategoricalFilter.tsx` | Checkbox list filter |
| `src/reactviews/pages/Profiler/components/NumericFilter.tsx` | Operator + numeric input |
| `src/reactviews/pages/Profiler/components/DateFilter.tsx` | Operator + date input |
| `src/reactviews/pages/Profiler/components/TextFilter.tsx` | Operator + text input |
| `test/unit/profiler/columnFilter.test.ts` | Unit tests for filter components |

## Testing the Feature

1. Launch Extension Development Host (F5)
2. Connect to a SQL Server instance
3. Right-click server in Object Explorer → "Launch Profiler"
4. Create and start a profiler session
5. Execute some queries to generate events
6. Test filtering:
   - Click funnel icon on EventClass column → categorical filter
   - Click funnel icon on Duration column → numeric filter
   - Type in "Quick filter all columns..." input → cross-column search
   - Click "Clear All Filters" → reset all filters

## Common Issues

### Build Errors

```bash
# Clean and rebuild
cd extensions/mssql
rm -rf out/
yarn build
```

### Test Failures

```bash
# Run with verbose output
yarn test --grep "FilteredBuffer" --reporter spec
```

### Webview Not Updating

1. Close and reopen the Profiler tab
2. Reload the Extension Development Host window (Ctrl+R)

## Architecture Notes

- **FilteredBuffer**: All filtering logic must be in FilteredBuffer, not SlickGrid
- **No setTimeout**: Use `requestAnimationFrame` or `queueMicrotask` in webviews
- **Debouncing**: Quick filter uses RAF-based debounce (~200ms)
- **Popover State**: Only one popover open at a time; pending changes discarded on close
