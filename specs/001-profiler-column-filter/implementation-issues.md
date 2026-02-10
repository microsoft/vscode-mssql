# Implementation Issues: Profiler Column-Level Filtering

**Feature**: 001-profiler-column-filter
**Date**: February 5, 2026
**Status**: ✅ RESOLVED - Critical architecture issue fixed

## Critical Architecture Issue: Field Name Mismatch ✅ RESOLVED

### The Problem

The profiler has **three different naming conventions** for the same data:

1. **View Config fields** (PascalCase): `TextData`, `DatabaseName`, `ApplicationName`, `EventClass`
2. **EventRow properties** (camelCase): `textData`, `databaseName`, `eventClass`, `spid`
3. **additionalData keys** (xevent raw): `client_app_name`, `database_name`, `sql_text`, `session_id`

The `eventsMapped` property in ViewColumn connects these:
```typescript
{
    field: "ApplicationName",      // View field name
    header: "ApplicationName",
    eventsMapped: ["client_app_name"],  // Raw xevent key in additionalData
}
```

### Impact on Filtering

- **FilteredBuffer operates on EventRow** with camelCase properties and raw additionalData
- **Grid displays ProfilerGridRow** converted via `convertEventToViewRow()` using eventsMapped
- **Column filters use View field names** (PascalCase) which don't match EventRow
- **getDistinctValues** was looking for wrong field names

### Solution ✅ IMPLEMENTED

1. ✅ Added `setFieldNameMap(map: Map<string, string[]>)` method to FilteredBuffer
2. ✅ FilteredBuffer now stores a field name map from View field names to raw field paths
3. ✅ `evaluateColumnFilter()` uses the field name map to resolve View names to raw field names
4. ✅ `ProfilerWebviewController.setCurrentSession()` builds and passes the field name map
5. ✅ `ProfilerWebviewController.setView()` updates the field name map when view changes
6. ✅ 10 new unit tests added for field name mapping functionality

**Files Changed**:
- `src/profiler/filteredBuffer.ts` - Added `_fieldNameMap`, `setFieldNameMap()`, `getMappedFields()`, `evaluateClauseWithValue()`, `evaluateComparisonWithValue()`
- `src/profiler/profilerWebviewController.ts` - Added `updateFieldNameMap()`, called from `setCurrentSession()` and `setView()`
- `test/unit/profiler/filteredBuffer.test.ts` - Added "Field Name Mapping for Column Filters" test suite (10 tests)

---

## Issues Found During Testing

### Issue 1: Wrong Filter Icon Type
**Symptom**: Filter icon was wrong icon type, not a funnel
**Root Cause**: Wrong icon import or CSS class
**Fix**: Use `.slick-header-filterbutton` CSS class from table.css which has correct SVG background-image

### Issue 2: Filter Icon Misalignment
**Symptom**: Filter icons not aligned with column headers
**Root Cause**: Using overlay positioning instead of flexbox layout
**Fix**: Use `onHeaderCellRendered` SlickGrid event (same pattern as QueryResult) to append filter button to header cell with proper flexbox styling via `.slick-header-with-filter` class

### Issue 3: Icons Not Showing on Narrow Columns
**Symptom**: ApplicationName and other columns with long names didn't show filter icon
**Root Cause**: Column width too narrow for header text + filter button
**Fix**: Calculate minimum column width based on header text length + button width:
```typescript
const headerMinWidth = Math.max(80, (col.header?.length ?? 0) * 7 + 28);
const effectiveWidth = Math.max(col.width ?? headerMinWidth, headerMinWidth);
```

### Issue 4: Filter Icon Disappears After Applying Filter
**Symptom**: After applying a filter, the funnel icon would disappear; reappears on clear
**Root Cause**: Multiple potential causes:
  - Stale element references in `columnFilterButtonMapping`
  - Grid re-rendering destroying header elements
  - SVG fill attribute missing for "filtered" state icons
**Fix**: 
  - Added `fill="#000"` to filterFilled.svg for light theme
  - Look up anchor element fresh from DOM when opening popover

### Issue 5: Text/Categorical Filters Not Showing for String Columns
**Symptom**: Only date and numeric filters appeared; string columns showed nothing
**Root Cause**: ColumnFilterPopover conditional rendering logic was wrong - defaulted to nothing for string columns without explicit `filterMode`
**Fix**: String columns should default to **categorical** filter (not text). Only columns with explicit `filterMode: "text"` show text filter.

### Issue 6: filterMode Not Passed Through toViewConfig
**Symptom**: Even when filterMode was set in config, popover didn't respect it
**Root Cause**: `toViewConfig()` in profilerWebviewController wasn't including `filterMode` in the mapped column definitions
**Fix**: Add `filterMode: col.filterMode` to the column mapping in toViewConfig

### Issue 7: Categorical Filter Showing Wrong Values / Wrong Filtering
**Symptom**: Could select values in categorical filter but:
  - Filtering showed wrong data
  - Selected "master" but got empty rows
**Root Cause**: `getDistinctValues()` was looking for field `DatabaseName` in EventRow but the property is `databaseName` or `database_name` in additionalData
**Fix**: Pass `eventsMapped` array to getDistinctValues so it searches the correct raw field names

### Issue 8: Text Filter "Contains" Not Working
**Symptom**: Entering text that exists in a row shows 0 results
**Root Cause**: Same field name mismatch - filter looking for `TextData` but EventRow has `textData` and additionalData has `sql_text`, `batch_text`, etc.
**Fix**: The filter evaluation must happen on ProfilerGridRow (after conversion), not on EventRow

### Issue 9: Popover Repositioning on Selection
**Symptom**: When clicking an option in categorical filter, popover jumps from under column to start of grid
**Root Cause**: Anchor element becoming stale/null, causing popover to fall back to default positioning
**Fix**: Look up filter button element fresh from DOM using column ID selector instead of relying on stored reference

### Issue 10: Status Bar Showing total/total Instead of filtered/total
**Symptom**: After applying filter, status bar showed same number for filtered and total
**Root Cause**: `filteredCount` was being computed from `filteredBuffer.filteredCount` which uses the wrong field names on EventRow
**Fix**: Compute filtered count using the same ProfilerGridRow conversion + matchesFilter logic used for actual filtering

### Issue 11: Numeric Filter Not Working
**Symptom**: Numeric comparison filters don't return correct results
**Root Cause**: Same field name mismatch issue - numeric fields in config (SPID, CPU, Reads) map to different names in EventRow
**Fix**: Addressed by the ProfilerGridRow conversion approach

---

## Design Decisions to Document

### 1. Filter Type Defaults
- **Numeric columns** (`type: "number"`): Show NumericFilter with operator dropdown
- **DateTime columns** (`type: "datetime"`): Show DateFilter with operator dropdown
- **String columns with `filterMode: "text"`**: Show TextFilter (only TextData)
- **String columns without filterMode (default)**: Show CategoricalFilter with checkbox list

### 2. Field Name Resolution
When looking up field values:
1. First try the `eventsMapped` array to find raw xevent keys
2. Fall back to case-insensitive lookup on EventRow properties
3. Check both direct properties and additionalData

### 3. Performance Considerations
The current approach converts ALL EventRows to ProfilerGridRows before filtering. This is O(n) on every filter operation. 

**Future optimization**: Build a field mapping table at view initialization that maps View field names → EventRow property/additionalData paths. Then filtering can operate directly on EventRow without full conversion.

---

## Test Cases to Add

1. **Field name mapping tests**: Verify filtering works with PascalCase field names against camelCase EventRow
2. **Categorical filter multi-select**: Verify OR logic within selected values
3. **Text filter contains**: Verify case-insensitive substring matching
4. **Mixed filter types**: Verify AND logic between different column filters
5. **Quick filter + column filter**: Verify combined filtering works
6. **Empty/null value handling**: Verify categorical filter handles missing values correctly
7. **Status bar count accuracy**: Verify filtered count matches actual filtered rows
8. **Large dataset performance**: Test with 100k rows, verify < 500ms filter time
