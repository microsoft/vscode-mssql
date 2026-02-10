# Data Model: Profiler Column-Level Filtering

**Feature**: 001-profiler-column-filter
**Date**: February 4, 2026
**Status**: Complete

## Entities

### FilterState (Extended)

Represents the complete filter configuration for a profiler session.

```typescript
interface FilterState {
    /** Whether filtering is currently enabled */
    enabled: boolean;
    /** Legacy array of filter clauses (for backwards compatibility) */
    clauses: FilterClause[];
    /** Quick filter term for cross-column search */
    quickFilter?: string;
    /** Column-level filters keyed by column field name */
    columnFilters?: Record<string, ColumnFilterCriteria>;
}
```

**Relationships**: Used by FilteredBuffer to determine row visibility. Stored per session in ProfilerWebviewState.

### ColumnFilterCriteria

Represents the filter criteria for a single column.

```typescript
interface ColumnFilterCriteria {
    /** The column field this filter applies to */
    field: string;
    /** Filter type matching the column's data type */
    filterType: ColumnFilterType;
    /** For categorical: selected values (OR logic within) */
    selectedValues?: string[];
    /** For operator-based: the comparison operator */
    operator?: FilterOperator;
    /** For operator-based: the comparison value */
    value?: string | number;
}

type ColumnFilterType = "categorical" | "numeric" | "date" | "text";
```

**Validation Rules**:
- `selectedValues` required when `filterType === "categorical"`
- `operator` and `value` required when `filterType` is "numeric", "date", or "text"
- `value` must be valid number when `filterType === "numeric"`
- `value` must be valid date string when `filterType === "date"`
- `value` length must not exceed 1000 characters when `filterType === "text"`

### ProfilerColumnDef (Extended)

Extended column definition with filter metadata.

```typescript
interface ProfilerColumnDef {
    /** Field name from event data */
    field: string;
    /** Display header */
    header: string;
    /** Data type for the column (defaults to string) */
    type?: ColumnType;
    /** Column width in pixels */
    width?: number;
    /** Whether the column is sortable */
    sortable?: boolean;
    /** Whether the column is filterable (defaults to true) */
    filterable?: boolean;
    /** For string columns: "categorical" for checkbox list, "text" for operator input */
    filterMode?: "categorical" | "text";
}

type ColumnType = "string" | "number" | "datetime";
```

**State Transitions**:
- Column filter type is determined by `type` and `filterMode`:
  - `type === "number"` → numeric filter
  - `type === "datetime"` → date filter  
  - `type === "string" && filterMode === "categorical"` → categorical filter
  - `type === "string" && filterMode === "text"` (or unspecified) → text filter

### DistinctValuesCache

Internal cache structure for categorical filter values.

```typescript
interface DistinctValuesCache {
    /** Map of field name to Set of distinct values */
    values: Map<string, Set<string>>;
    /** Generation counter to invalidate on buffer changes */
    generation: number;
}
```

**Relationships**: Internal to FilteredBuffer, not exposed via API.

## State Flow

```
User Input → ColumnFilterCriteria → FilterState → FilteredBuffer → Filtered Rows → SlickGrid
                                         ↑
                              QuickFilter term
```

### Filter Application Logic

1. **Quick Filter**: Converts to `Contains` clause on all columns (OR across columns)
2. **Column Filters**: Each `ColumnFilterCriteria` converts to one or more `FilterClause`
3. **Combination**: Quick filter AND all column filters AND'ed together
4. **Evaluation**: FilteredBuffer evaluates each row against combined clauses

### Conversion Rules

| Filter Type | Conversion to FilterClause |
|-------------|---------------------------|
| Categorical | Multiple clauses with OR logic (handled specially) |
| Numeric | Single clause: `{ field, operator, value, typeHint: "number" }` |
| Date | Single clause: `{ field, operator, value, typeHint: "datetime" }` |
| Text | Single clause: `{ field, operator, value, typeHint: "string" }` |
| Quick Filter | For each column: `{ field: col, operator: Contains, value: term }` with OR |

## UI State

### PopoverState

Tracks which column's filter popover is currently open.

```typescript
interface PopoverState {
    /** Field name of column with open popover (null if none) */
    openColumn: string | null;
    /** Pending filter criteria being edited (not yet applied) */
    pendingCriteria: ColumnFilterCriteria | null;
}
```

**Behavior**:
- Only one popover can be open at a time
- Opening a new popover closes any existing one
- Pending criteria is discarded on close without Apply
- Apply commits pending criteria to FilterState
- Clear removes the column's filter and closes popover

### ActiveFilterIndicators

For UI display of active filter state.

```typescript
interface ActiveFilterIndicators {
    /** Set of column fields with active filters */
    activeColumns: Set<string>;
    /** Whether quick filter has a value */
    quickFilterActive: boolean;
    /** Total number of active column filters */
    columnFilterCount: number;
}
```

Computed from FilterState for efficient UI rendering.
