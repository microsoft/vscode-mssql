# Research: Profiler Column-Level Filtering and Quick Filter

**Feature**: 001-profiler-column-filter
**Date**: February 4, 2026
**Status**: Complete

## Research Tasks

### 1. Existing FilteredBuffer Architecture

**Question**: How does FilteredBuffer currently handle filtering?

**Findings**:
- `FilteredBuffer<T>` wraps a `RingBuffer<T>` and applies filter clauses client-side
- Filter clauses use `FilterClause` interface with `field`, `operator`, `value`, and optional `typeHint`
- Multiple clauses are combined with AND logic
- Supports operators: Equals, NotEquals, LessThan, LessThanOrEqual, GreaterThan, GreaterThanOrEqual, IsNull, IsNotNull, Contains, NotContains, StartsWith, NotStartsWith
- Already supports case-insensitive string matching
- `getFilteredRows()` returns all matching rows
- `getFilteredRange(startIndex, count)` supports pagination

**Decision**: Extend existing FilteredBuffer to support:
1. Quick filter (cross-column search) as a separate filter state
2. Column-level filters stored as a map of column field → filter criteria
3. Combine quick filter AND column filters with AND logic

**Rationale**: Reusing existing FilteredBuffer maintains consistency and leverages proven filtering logic. The architecture already supports multiple clauses with AND logic.

### 2. Column Metadata Enhancement

**Question**: How should column filter types be declared?

**Findings**:
- `ProfilerColumnDef` already has `type?: ColumnType` where `ColumnType = "string" | "number" | "datetime"`
- `ViewColumn` in profilerTypes.ts has similar structure
- No existing `stringMode` to distinguish categorical vs. long text columns

**Decision**: Add `filterMode?: "categorical" | "text"` to `ProfilerColumnDef` for string columns. Categorical columns show checkbox list; text columns show operator + input.

**Rationale**: Explicit declaration (per clarification) avoids automatic cardinality detection complexity. Default to "text" mode for string columns if not specified.

**Alternatives Considered**:
- Auto-detect based on cardinality → Rejected per clarification session
- Single enum for all filter types → More complex, less flexible

### 3. Popover Component Pattern

**Question**: What UI component library patterns should be used for filter popovers?

**Findings**:
- Fluent UI React Components provides `Popover`, `PopoverTrigger`, `PopoverSurface`
- Existing `ProfilerFilterDialog` uses `Dialog`, `DialogSurface`, etc.
- Query Results grid in this codebase may have similar filter patterns

**Decision**: Use Fluent UI `Popover` component with:
- `PopoverTrigger` on the funnel icon button in column header
- `PopoverSurface` containing the filter controls
- Close on outside click, Escape key, or horizontal scroll

**Rationale**: Fluent UI provides accessibility features out of the box (focus management, ARIA). Consistent with existing Fluent UI usage in the extension.

### 4. SlickGrid Column Header Customization

**Question**: How to add funnel icons to SlickGrid column headers?

**Findings**:
- SlickGrid-React supports custom header renderers via `headerFormatter` in column definition
- Can inject React components into header via custom formatters
- Alternative: Use SlickGrid's `onHeaderCellRendered` event to modify DOM

**Decision**: Use `headerFormatter` to render a custom header component that includes:
1. Column name
2. Sort indicator (if sortable)
3. Funnel icon button (opens popover)
4. Visual indicator when filter is active

**Rationale**: Custom header formatter is the cleanest approach and keeps rendering within React's control.

### 5. Debouncing Without setTimeout

**Question**: How to implement 200ms debounce for quick filter without setTimeout?

**Findings**:
- Constitution prohibits `setTimeout` in webviews (Chrome throttles to 1s when backgrounded)
- Options:
  1. `requestAnimationFrame` loop with timestamp comparison
  2. Use a debounce utility that works with `requestAnimationFrame`
  3. Accept slight timing variance with RAF-based approach

**Decision**: Implement debounce using `requestAnimationFrame` with timestamp tracking:
```typescript
let lastInputTime = 0;
const DEBOUNCE_MS = 200;

function onQuickFilterChange(value: string) {
    lastInputTime = performance.now();
    const capturedTime = lastInputTime;
    
    requestAnimationFrame(function check() {
        if (performance.now() - capturedTime >= DEBOUNCE_MS) {
            if (capturedTime === lastInputTime) {
                applyQuickFilter(value);
            }
        } else {
            requestAnimationFrame(check);
        }
    });
}
```

**Rationale**: Complies with Constitution principle III. May have slight timing variance but acceptable for UX.

### 6. Distinct Value Caching for Categorical Filters

**Question**: How to efficiently cache and recompute distinct values?

**Findings**:
- FilteredBuffer has access to all rows via `buffer.getAllRows()`
- Need to compute distinct values per categorical column
- Should recompute when buffer changes (new events, clear)

**Decision**: Add `getDistinctValues(field: string): Set<string>` method to FilteredBuffer that:
1. Maintains a cache of distinct values per field
2. Invalidates cache on buffer mutation (add, clear)
3. Lazily computes on first access per field

**Rationale**: Caching avoids O(n) computation on every popover open. Lazy computation avoids unnecessary work for columns never filtered.

### 7. Text Input Length Validation

**Question**: How to enforce 1000 character limit on text inputs?

**Findings**:
- HTML `<input maxlength="1000">` attribute handles this natively
- Fluent UI `Input` component supports `maxLength` prop

**Decision**: Set `maxLength={1000}` on all text filter inputs (both quick filter and column text filters).

**Rationale**: Native browser enforcement is most reliable. No custom validation needed.

## Summary of Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| FilteredBuffer | Extend with quick filter + column filter map | Reuse proven architecture |
| Column metadata | Add `filterMode` for string columns | Explicit declaration per clarification |
| Popover UI | Fluent UI Popover component | Accessibility, consistency |
| Column headers | Custom `headerFormatter` | Clean React integration |
| Debouncing | requestAnimationFrame-based | Constitution compliance |
| Distinct values | Lazy-computed cached Set | Performance optimization |
| Text length | HTML maxLength attribute | Native browser enforcement |
---

## CRITICAL: Field Name Architecture (Added from Implementation Testing)

### Problem Discovered During Testing

The profiler uses **three different naming conventions** for the same data fields:

| Layer | Example Field | Format |
|-------|---------------|--------|
| View Config (column.field) | `TextData`, `ApplicationName` | PascalCase |
| EventRow properties | `textData`, `eventClass`, `spid` | camelCase |
| additionalData (raw xevent) | `client_app_name`, `sql_text` | snake_case |

The `eventsMapped` property bridges these:
```typescript
{
    field: "ApplicationName",           // View field name (displayed)
    header: "ApplicationName",
    eventsMapped: ["client_app_name"],  // Raw xevent key to look up
}
```

### Impact on Column Filtering

1. **FilteredBuffer operates on EventRow** - has camelCase properties + additionalData
2. **Grid displays ProfilerGridRow** - converted via `convertEventToViewRow()` using eventsMapped
3. **Filter UI uses View field names** - PascalCase from column config
4. **Direct field lookup fails** - "DatabaseName" ≠ "databaseName" ≠ "database_name"

### Required Solution

**For getDistinctValues**: Must pass `eventsMapped` array so it searches correct raw field names:
```typescript
// In profilerWebviewController
const column = view?.columns.find(c => c.field === payload.field);
const mappedFields = column?.eventsMapped ?? [payload.field];
const values = this._filteredBuffer.getDistinctValues(mappedFields);
```

**For filter evaluation**: Filter on ProfilerGridRow (after conversion), not EventRow. The `matchesFilter` method must operate on the converted grid rows where field names match the view config.

**For toViewConfig**: Must include `filterMode` in the column mapping so the popover knows which filter type to show.

### Performance Consideration

Converting all EventRows to ProfilerGridRows before filtering is O(n). Future optimization could build a field mapping table at view initialization to avoid full conversion.

See [implementation-issues.md](./implementation-issues.md) for complete list of issues found during testing.