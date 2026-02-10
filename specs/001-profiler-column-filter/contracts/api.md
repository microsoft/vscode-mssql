# API Contracts: Profiler Column-Level Filtering

**Feature**: 001-profiler-column-filter
**Date**: February 4, 2026

## Webview ↔ Extension Communication

### Reducers (Webview → Extension)

These are added to `ProfilerReducers` interface.

#### applyColumnFilter

Apply a filter to a specific column.

```typescript
applyColumnFilter: {
    /** Column field name */
    field: string;
    /** Filter criteria */
    criteria: ColumnFilterCriteria;
}
```

**Response**: Updates `ProfilerWebviewState.filterState.columnFilters`

#### clearColumnFilter

Clear the filter for a specific column.

```typescript
clearColumnFilter: {
    /** Column field name */
    field: string;
}
```

**Response**: Removes column from `ProfilerWebviewState.filterState.columnFilters`

#### setQuickFilter

Set the quick filter value.

```typescript
setQuickFilter: {
    /** Search term (empty string clears) */
    term: string;
}
```

**Response**: Updates `ProfilerWebviewState.filterState.quickFilter`

#### clearAllFilters

Clear all filters (quick filter and all column filters).

```typescript
clearAllFilters: Record<string, never>;
```

**Response**: Resets `ProfilerWebviewState.filterState` to empty state

#### getDistinctValues

Request distinct values for a categorical column.

```typescript
getDistinctValues: {
    /** Column field name */
    field: string;
}
```

**Response**: Extension sends `distinctValuesResponse` notification

### Notifications (Extension → Webview)

#### distinctValuesResponse

Response to `getDistinctValues` request.

```typescript
interface DistinctValuesResponse {
    /** Column field name */
    field: string;
    /** Distinct values sorted alphabetically */
    values: string[];
}
```

## Component Props Contracts

### ColumnFilterPopoverProps

```typescript
interface ColumnFilterPopoverProps {
    /** Column definition */
    column: ProfilerColumnDef;
    /** Current filter criteria for this column (if any) */
    currentCriteria?: ColumnFilterCriteria;
    /** Distinct values for categorical columns */
    distinctValues?: string[];
    /** Whether popover is open */
    isOpen: boolean;
    /** Callback when popover open state changes */
    onOpenChange: (open: boolean) => void;
    /** Callback when Apply is clicked */
    onApply: (criteria: ColumnFilterCriteria) => void;
    /** Callback when Clear is clicked */
    onClear: () => void;
    /** Anchor element for positioning */
    anchorRef: React.RefObject<HTMLElement>;
}
```

### CategoricalFilterProps

```typescript
interface CategoricalFilterProps {
    /** Column field name */
    field: string;
    /** Available values to select from */
    values: string[];
    /** Currently selected values */
    selectedValues: string[];
    /** Placeholder text for search input (default: "Search values...") */
    searchPlaceholder?: string;
    /** Callback when selection changes */
    onSelectionChange: (selected: string[]) => void;
}
```

### NumericFilterProps

```typescript
interface NumericFilterProps {
    /** Column field name */
    field: string;
    /** Current operator */
    operator: FilterOperator;
    /** Current value (as string for input) */
    value: string;
    /** Validation error message (if any) */
    error?: string;
    /** Callback when operator changes */
    onOperatorChange: (op: FilterOperator) => void;
    /** Callback when value changes */
    onValueChange: (val: string) => void;
}
```

### DateFilterProps

```typescript
interface DateFilterProps {
    /** Column field name */
    field: string;
    /** Current operator */
    operator: FilterOperator;
    /** Current value (as string for input) */
    value: string;
    /** Validation error message (if any) */
    error?: string;
    /** Callback when operator changes */
    onOperatorChange: (op: FilterOperator) => void;
    /** Callback when value changes */
    onValueChange: (val: string) => void;
}
```

### TextFilterProps

```typescript
interface TextFilterProps {
    /** Column field name */
    field: string;
    /** Column display name for placeholder */
    columnName: string;
    /** Current operator */
    operator: FilterOperator;
    /** Current value */
    value: string;
    /** Callback when operator changes */
    onOperatorChange: (op: FilterOperator) => void;
    /** Callback when value changes */
    onValueChange: (val: string) => void;
}
```

### QuickFilterInputProps

```typescript
interface QuickFilterInputProps {
    /** Current filter value */
    value: string;
    /** Callback when value changes (debounced) */
    onChange: (value: string) => void;
    /** Placeholder text */
    placeholder?: string;
}
```

## Validation Contracts

### NumericValidation

```typescript
function validateNumericInput(value: string): { valid: boolean; error?: string } {
    if (value.trim() === "") {
        return { valid: false, error: "Value is required" };
    }
    const num = parseFloat(value);
    if (isNaN(num)) {
        return { valid: false, error: "Must be a valid number" };
    }
    return { valid: true };
}
```

### DateValidation

```typescript
function validateDateInput(value: string): { valid: boolean; error?: string } {
    if (value.trim() === "") {
        return { valid: false, error: "Value is required" };
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
        return { valid: false, error: "Must be a valid date" };
    }
    return { valid: true };
}
```

## Localization Keys

New keys to add to `bundle.l10n.json`:

```json
{
    "profiler.quickFilterPlaceholder": "Quick filter all columns...",
    "profiler.filterColumnHeader": "Filter: {0}",
    "profiler.filterApply": "Apply",
    "profiler.filterClear": "Clear",
    "profiler.filterSearchValues": "Search values...",
    "profiler.filterSelectAll": "Select All",
    "profiler.filterClearSelection": "Clear Selection",
    "profiler.filterNoMatchingValues": "No matching values",
    "profiler.filterExample.numeric": "Example: Find queries with {0} > 100",
    "profiler.filterExample.text": "Example: Find queries containing 'SELECT'",
    "profiler.filterValidation.numberRequired": "Must be a valid number",
    "profiler.filterValidation.dateRequired": "Must be a valid date",
    "profiler.filterNoResults": "No results match the current filters"
}
```
