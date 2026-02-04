# Feature Specification: Profiler Column-Level Filtering and Quick Filter

**Feature Branch**: `dev/allancascante/001-profiler-column-filter`  
**Created**: February 4, 2026  
**Status**: Draft  
**Input**: User description: "Profiler — Column-Level Filtering and Quick Filter"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Filter by Categorical Column Values (Priority: P1)

A database administrator is analyzing a profiler trace that contains thousands of events. They want to focus only on specific event types (e.g., "RPC:Completed" and "SQL:BatchCompleted") to troubleshoot a performance issue. They click the funnel icon on the "EventClass" column header, see a searchable checkbox list of all distinct event types, select the two events they need, and apply the filter. The grid instantly shows only rows matching those event types.

**Why this priority**: Filtering by categorical values (event class, application name, login name) is the most common filtering operation in profiler. It provides immediate value by reducing noise and focusing on relevant events.

**Independent Test**: Can be fully tested by opening a profiler session, clicking a categorical column's funnel icon, selecting values from the checkbox list, and verifying only matching rows appear.

**Acceptance Scenarios**:

1. **Given** a profiler grid with multiple event types, **When** the user clicks the funnel icon on the EventClass column, **Then** a popover appears with a searchable checkbox list showing all distinct event class values.
2. **Given** the categorical filter popover is open, **When** the user selects "RPC:Completed" and "SQL:BatchCompleted" checkboxes, **Then** the grid displays only rows where EventClass matches either selected value (OR logic).
3. **Given** a categorical filter popover with many values, **When** the user types "RPC" in the search field, **Then** only checkbox items containing "RPC" are shown in the list.
4. **Given** a categorical filter is active, **When** the user views the column header, **Then** the funnel icon visually indicates that a filter is active on that column.

---

### User Story 2 - Filter by Numeric Comparison (Priority: P1)

A performance engineer wants to find all queries that took longer than 1000 milliseconds. They click the funnel icon on the "Duration" column, select "greater than" from the operator dropdown, enter "1000" in the input field, and apply the filter. The grid shows only rows where Duration exceeds 1000ms.

**Why this priority**: Numeric filtering (Duration, CPU, Reads, Writes) is essential for performance analysis. Finding slow queries or high-resource operations is a core profiler use case.

**Independent Test**: Can be fully tested by opening a profiler session, clicking the Duration column funnel, selecting an operator, entering a value, and verifying only matching rows appear.

**Acceptance Scenarios**:

1. **Given** a profiler grid with Duration data, **When** the user clicks the funnel icon on the Duration column, **Then** a popover appears with an operator dropdown (equals, not equals, greater than, greater or equal, less than, less or equal) and a numeric input field.
2. **Given** the numeric filter popover is open, **When** the user selects "greater than" and enters "1000", **Then** the grid displays only rows where Duration > 1000.
3. **Given** the numeric input field, **When** the user enters non-numeric text "abc", **Then** the input shows a validation error and the filter cannot be applied until corrected.
4. **Given** a numeric filter is active on Duration, **When** the user also applies a filter on another column, **Then** both filters are combined using AND logic.

---

### User Story 3 - Quick Filter Across All Columns (Priority: P1)

A developer received an error message containing "deadlock" and wants to find all related profiler events. They type "deadlock" in the "Quick filter all columns…" input at the top of the toolbar. The grid instantly filters to show only rows where any column contains the word "deadlock" (case-insensitive).

**Why this priority**: Cross-column text search is the fastest way to find relevant events when the user doesn't know which specific column contains the information. It's the most common entry point for filtering.

**Independent Test**: Can be fully tested by typing a search term in the quick filter input and verifying that rows containing that term in any column are displayed.

**Acceptance Scenarios**:

1. **Given** a profiler grid with various data, **When** the user types "deadlock" in the Quick filter input, **Then** the grid shows only rows where at least one column contains "deadlock" (case-insensitive).
2. **Given** the quick filter is active with "deadlock", **When** the user also applies a column-specific filter, **Then** both the quick filter and column filter are combined using AND logic.
3. **Given** the quick filter input, **When** the user types rapidly, **Then** the filter is applied with debouncing (approximately 200ms delay) to avoid excessive re-filtering.

---

### User Story 4 - Filter TextData by String Operators (Priority: P2)

A developer wants to find all queries that start with "SELECT * FROM Users". They click the funnel icon on the "TextData" column, select "starts with" from the operator dropdown, enter the search text, and apply the filter. The grid shows only matching queries.

**Why this priority**: TextData filtering with operators (contains, starts with, ends with) allows precise query analysis beyond simple substring matching. Slightly lower priority as the quick filter covers basic use cases.

**Independent Test**: Can be fully tested by clicking the TextData column funnel, selecting a string operator, entering text, and verifying only matching rows appear.

**Acceptance Scenarios**:

1. **Given** a profiler grid with TextData, **When** the user clicks the funnel icon on the TextData column, **Then** a popover appears with an operator dropdown (contains, equals, not equals, starts with, ends with) and a text input field.
2. **Given** the text filter popover is open, **When** the user selects "starts with" and enters "SELECT * FROM Users", **Then** the grid displays only rows where TextData starts with that string.
3. **Given** a text filter is active, **When** the user changes the operator to "contains", **Then** the filter logic updates accordingly.

---

### User Story 5 - Clear All Filters (Priority: P2)

A user has applied multiple column filters and a quick filter. They want to reset the view to see all data. They click the "Clear All Filters" button in the toolbar. All filters are removed and the grid shows all rows.

**Why this priority**: Essential for usability - users need a quick way to reset their view after investigating specific data.

**Independent Test**: Can be fully tested by applying multiple filters, clicking "Clear All Filters", and verifying the grid shows all rows.

**Acceptance Scenarios**:

1. **Given** active filters on multiple columns and the quick filter, **When** the user clicks "Clear All Filters", **Then** all column filters and the quick filter are cleared, and the grid shows all rows.
2. **Given** filters have been cleared, **When** the user views all column headers, **Then** no funnel icons show an active filter state.

---

### User Story 6 - Filter by Date/Time Values (Priority: P3)

A database administrator wants to see all events that occurred after a specific time. They click the funnel icon on the "StartTime" column, select "greater than" from the operator dropdown, enter a datetime value, and apply the filter.

**Why this priority**: Date filtering is useful for time-based analysis but less frequently used than categorical or numeric filters.

**Independent Test**: Can be fully tested by clicking a datetime column funnel, entering a valid date, and verifying only matching rows appear.

**Acceptance Scenarios**:

1. **Given** a profiler grid with StartTime data, **When** the user clicks the funnel icon on the StartTime column, **Then** a popover appears with an operator dropdown and a date input field.
2. **Given** the date filter popover is open, **When** the user enters an invalid date format, **Then** a validation error is shown and the filter cannot be applied until corrected.
3. **Given** a valid date is entered, **When** the user applies the filter, **Then** the grid displays only rows matching the date comparison.

---

### User Story 7 - Keyboard-Accessible Filtering (Priority: P2)

A user who relies on keyboard navigation wants to filter data without using a mouse. They can tab to the funnel icon, press Enter to open the popover, tab through the filter controls, and press Escape to close the popover.

**Why this priority**: Accessibility is essential for inclusive design and compliance requirements.

**Independent Test**: Can be fully tested by navigating the entire filter workflow using only keyboard (Tab, Enter, Escape, Arrow keys).

**Acceptance Scenarios**:

1. **Given** keyboard focus on a column header, **When** the user activates the funnel icon, **Then** the popover opens and focus moves to the first actionable element.
2. **Given** the filter popover is open, **When** the user presses Tab, **Then** focus moves through all interactive elements in a logical order.
3. **Given** the filter popover is open, **When** the user presses Escape, **Then** the popover closes and focus returns to the funnel icon.
4. **Given** any filter control, **When** accessed by a screen reader, **Then** appropriate labels and roles are announced.

---

### Edge Cases

- What happens when a categorical column has more than 100 distinct values? The checkbox list must remain performant and scrollable.
- What happens when no rows match the applied filters? The grid displays an empty state with a message indicating no results match the current filters.
- What happens when the user applies a filter and then the underlying data updates? The filter reapplies automatically to the new data.
- What happens when the grid scrolls horizontally while a popover is open? The popover closes to prevent visual misalignment.
- What happens when the user clicks outside the popover? The popover closes without applying changes unless auto-apply is enabled.
- What happens when a numeric field contains NULL values? NULL values do not match any numeric comparison except "not equals" to a specific value.
- What happens when the user enters text exceeding 1000 characters? Input is truncated or blocked at 1000 characters; the filter applies to the truncated value.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a funnel icon in every column header of the profiler grid.
- **FR-002**: System MUST open a filter popover when the user clicks a column's funnel icon.
- **FR-003**: System MUST display categorical columns (enum or low-cardinality string) with a searchable checkbox list of distinct values.
- **FR-004**: System MUST apply OR logic when multiple values are selected within a single categorical column filter.
- **FR-005**: System MUST display numeric columns (Duration, Reads, Writes, CPU) with an operator dropdown (equals, not equals, greater than, greater or equal, less than, less or equal) and a numeric input field.
- **FR-006**: System MUST validate that numeric filter inputs contain only valid numbers before allowing filter application.
- **FR-007**: System MUST display date/datetime columns with the same operator dropdown as numeric columns and a date input field.
- **FR-008**: System MUST validate that date filter inputs contain recognizable date values before allowing filter application.
- **FR-009**: System MUST display long text columns (e.g., TextData) with a text operator dropdown (contains, equals, not equals, starts with, ends with) and a text input field.
- **FR-010**: System MUST apply AND logic when combining filters across different columns.
- **FR-011**: System MUST provide a "Quick filter all columns…" input in the toolbar that performs case-insensitive contains search across all column values.
- **FR-012**: System MUST debounce the quick filter input with approximately 200ms delay.
- **FR-013**: System MUST preserve the "Clear All Filters" button that clears both the quick filter and all column filters.
- **FR-014**: System MUST visually indicate on the funnel icon when a filter is active for that column.
- **FR-015**: System MUST execute all filtering logic within FilteredBuffer, not within SlickGrid.
- **FR-016**: System MUST close the filter popover when the user clicks outside, presses Escape, or when the grid scrolls horizontally.
- **FR-017**: System MUST display each filter popover with: a header "Filter: {ColumnName}", a divider, the filter input controls, Apply and Clear buttons, another divider, and an example hint line.
- **FR-018**: System MUST display an example hint at the bottom of numeric filter popovers (e.g., "Example: Find queries with Duration > 100").
- **FR-019**: System MUST cache distinct categorical values and recompute only when the underlying buffer changes.
- **FR-020**: System MUST support keyboard navigation within the filter popover (Tab, Enter, Escape).
- **FR-021**: System MUST provide appropriate ARIA labels and roles for assistive technology support.
- **FR-022**: Each column's metadata MUST specify its filter type (categorical, numeric, date, text).
- **FR-023**: String columns MUST have a stringMode setting that explicitly declares whether to use checkbox list (categorical) or text operator input (long text); no automatic cardinality-based detection.
- **FR-024**: System MUST require an explicit Apply button click to apply filter changes; filters are not auto-applied as selections change.
- **FR-025**: System MUST discard all pending filter changes when the popover closes without the user clicking Apply (via click outside, Escape, or scroll).
- **FR-026**: Each filter popover MUST display Apply and Clear buttons after the filter input controls, matching the query results UI pattern. Clear removes only that column's filter.
- **FR-027**: All text-based column filters (contains, equals, not equals, starts with, ends with) MUST perform case-insensitive matching, consistent with the quick filter.
- **FR-028**: Text filter inputs (both column-level and quick filter) MUST be limited to 1000 characters maximum.

### Key Entities

- **FilterState**: Represents the complete filter configuration including the quick filter term and a map of column-level filters. Used by FilteredBuffer to determine row visibility.
- **ColumnFilter**: Represents a filter applied to a single column, containing the column identifier, filter type, and filter criteria (selected values, operator, or search term).
- **ColumnMetadata**: Extended metadata for each column that includes the filter type (categorical, numeric, date, text) and additional settings like stringMode for string columns.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can apply a column filter within 3 clicks (click funnel, select/enter value, click apply or press Enter).
- **SC-002**: Filter operations complete and the grid updates within 500ms for datasets up to 100,000 rows.
- **SC-003**: Quick filter results appear within 300ms of the user stopping typing (including 200ms debounce).
- **SC-004**: 100% of filter interactions are achievable using keyboard-only navigation.
- **SC-005**: The "Clear All Filters" action resets the view within 200ms.
- **SC-006**: Users can identify which columns have active filters at a glance via visual indicators.
- **SC-007**: Filter popovers render correctly and are fully visible regardless of column position.
- **SC-008**: Zero filter operations are performed by SlickGrid; all filtering is handled by FilteredBuffer.

## Assumptions

- The profiler grid already uses SlickGrid for rendering and FilteredBuffer for data management.
- Column metadata structure can be extended to include filter type information.
- The existing toolbar layout can accommodate the "Quick filter all columns…" input replacement.
- Standard date parsing behavior matches the locale settings of the application.
- Categorical columns are identified by explicit declaration in column metadata (stringMode setting); no automatic cardinality-based detection is performed.

## Clarifications

### Session 2026-02-04

- Q: Should filter changes auto-apply or require an explicit Apply button? → A: Explicit Apply button required to apply filter changes.
- Q: How should string columns determine filter mode (checkbox list vs. text operator)? → A: Column metadata must explicitly declare filter mode; no automatic cardinality detection.
- Q: What happens to pending changes when popover closes without Apply? → A: Discard; closing the popover without Apply discards all pending changes.
- Q: Should each popover have a Clear button for that column's filter? → A: Yes; each popover includes both Apply and Clear buttons after the filter inputs, matching the query results UI pattern.
- Q: Should column-level text filters be case-sensitive or case-insensitive? → A: Case-insensitive; all text-based column filters ignore case, consistent with quick filter behavior.
