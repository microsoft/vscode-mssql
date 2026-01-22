# Feature Specification: Fix Diff Viewer Visual Issues

**Feature Branch**: `003-fix-diff-visual-issues`  
**Created**: 2026-01-21  
**Status**: Draft  
**Input**: User description: "Fix visual issues and gaps in schema designer diff editor."

## Clarifications

### Session 2026-01-21

- Q: How should deleted columns be displayed in table nodes? → A: Show inline with strikethrough and dimmed text styling (same position they occupied)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Column-Level Change Indicators (Priority: P1)

Users need to see which specific columns within a table have been added, modified, or deleted when viewing the schema diff. Currently, only the table-level indicator (border) shows change status, but users cannot identify which columns changed without expanding the drawer.

**Why this priority**: This is critical for usability - users making schema changes need immediate visual feedback at the column level to understand the scope of their changes without additional clicks.

**Independent Test**: Add a column to an existing table, modify another column's data type, delete a third column. Open the diff drawer and verify that individual columns in the table node on canvas show colored indicators (green dot for added, yellow for modified, red for deleted).

**Acceptance Scenarios**:

1. **Given** a table with an added column, **When** viewing the canvas with drawer open, **Then** the added column row shows a green indicator dot
2. **Given** a table with a modified column, **When** viewing the canvas with drawer open, **Then** the modified column row shows a yellow/amber indicator dot
3. **Given** a table with a deleted column, **When** viewing the canvas with drawer open, **Then** the deleted column row shows a red indicator dot with strikethrough or dimmed styling
4. **Given** a table with multiple column changes, **When** viewing the canvas, **Then** each changed column shows its respective indicator independently

---

### User Story 2 - Reveal Highlight Animation (Priority: P2)

When users click the "reveal" button on a change item in the drawer, the canvas navigates to the element but there may not be sufficient visual confirmation of which element was revealed. Users need a brief highlight animation to draw attention to the target element.

**Why this priority**: Navigation without visual confirmation can be disorienting, especially in complex schemas with many tables.

**Independent Test**: Click the reveal button on a change item in the drawer, verify the target element on canvas receives a brief pulsing highlight animation (2-3 pulses over ~1 second) before returning to normal state.

**Acceptance Scenarios**:

1. **Given** a change item in the drawer, **When** user clicks reveal button, **Then** canvas scrolls to element AND element receives pulsing border highlight
2. **Given** a foreign key change item, **When** user clicks reveal button, **Then** the edge line pulses with color highlight
3. **Given** multiple rapid reveal clicks, **When** clicking different items quickly, **Then** previous highlight stops and new element highlights without animation queue buildup
4. **Given** an already visible element, **When** user clicks reveal, **Then** element still highlights to confirm which item was targeted

---

### User Story 3 - Drawer Resize Handle Visibility (Priority: P2)

Users may not notice that the drawer is resizable because the resize handle lacks visual affordance. The resize handle should have a visible grip indicator or change cursor on hover.

**Why this priority**: Discoverability of resize functionality improves user experience for those who want to see more change details.

**Independent Test**: Hover over the left edge of the drawer, verify cursor changes to resize cursor and a visible grip indicator appears.

**Acceptance Scenarios**:

1. **Given** the drawer is open, **When** user hovers over the left edge, **Then** cursor changes to `col-resize` cursor
2. **Given** the drawer is open, **When** user hovers over resize area, **Then** a subtle vertical grip line or dots appear
3. **Given** the drawer is being resized, **When** user drags the edge, **Then** drawer width updates smoothly in real-time
4. **Given** the drawer is resized, **When** user releases mouse, **Then** new width is persisted for next session

---

### User Story 4 - Empty State Illustration (Priority: P3)

When there are no schema changes, the empty state in the drawer shows only text. An illustration or icon would make the empty state more visually engaging and professional.

**Why this priority**: Polish improvement that enhances perceived quality but doesn't affect functionality.

**Independent Test**: Open the diff drawer when there are no schema changes, verify an appropriate icon/illustration is displayed above the "No pending changes" text.

**Acceptance Scenarios**:

1. **Given** a schema with no changes, **When** opening the diff drawer, **Then** empty state shows a checkmark or document icon above the message
2. **Given** the empty state is displayed, **When** viewing in different themes, **Then** the icon uses appropriate theme-aware colors
3. **Given** the empty state is displayed, **When** user makes a change, **Then** empty state transitions smoothly to showing the change

---

### Edge Cases

- What happens when column-level indicators are shown on a very wide table with many columns? Indicators should not overflow or cause layout issues.
- How does the highlight animation behave when user has reduced motion preferences enabled? Should skip animation and show static highlight.
- What happens if user rapidly resizes drawer? Should debounce resize persistence.
- How does empty state display in high-contrast theme? Must meet accessibility requirements.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Column-level change indicators MUST display colored dots next to changed columns and background highlights in table nodes when diff drawer is open:
  - Added columns: Green dot using `var(--vscode-gitDecoration-addedResourceForeground, #73c991)`
  - Modified columns: Yellow/amber dot using `var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)`
  - Deleted columns: Red dot using `var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)` with strikethrough text

- **FR-002**: Deleted tables must be shown on canvas with red border when diff drawer is open.

- **FR-003**: Deleted foreign key edges must be shown on canvas with red line color when diff drawer is open.

- **FR-004**: Deleted columns MUST be shown inline in table nodes at their original position with red indicator dot, strikethrough text styling, and dimmed opacity when diff drawer is open.

- **FR-005**: For newly added tables, foreign keys should have separate entries in the diff drawer. So the users can just undo or reveal them individually.

- **FR-007**: Column indicators MUST update dynamically when changes occur while drawer is open

- **FR-008**: Reveal button on change items MUST trigger canvas navigation to target element AND apply a pulsing border highlight animation lasting ~1 second

- **FR-009**: Table names in the drawer MUST use correct font color for better readability (fix existing issue)

### Key Entities

- **ColumnChangeIndicator**: Visual marker showing change type for individual columns
- **RevealHighlight**: Temporary animation state applied to revealed elements
- **ResizeHandle**: Interactive area for drawer width adjustment
- **EmptyStateIllustration**: SVG icon displayed when no changes exist

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Column-level indicators display correctly for added, modified, and deleted columns (verified by visual inspection)
- **SC-002**: Reveal highlight animation plays within 100ms of button click and completes within 1 second (verified by timing test)
- **SC-003**: Drawer resize handle shows visual affordance on hover (verified by visual inspection)
- **SC-004**: Empty state displays icon that meets accessibility contrast requirements (verified by contrast checker)
- **SC-005**: All animations respect `prefers-reduced-motion` setting (verified by accessibility audit)
- **SC-006**: No layout shifts or overflow when column indicators are displayed (verified by visual inspection on various table sizes)

## Assumptions

- The diff viewer context already tracks column-level changes via `SchemaChange` entities with `entityType: Column`
- CSS animations can be applied via class toggling with React state management
- FluentUI icons or SVG can be used for empty state illustration
- Drawer already supports width persistence (from spec 002)

## Out of Scope

- New diff calculation logic (already handled in spec 001/002)
- Changes to change detection algorithm
- Animation performance optimization for >100 columns
- Custom illustration design beyond existing icon libraries
