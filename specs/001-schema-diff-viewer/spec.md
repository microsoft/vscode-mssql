# Feature Specification: Real-Time Schema Diff Viewer

**Feature Branch**: `001-schema-diff-viewer`  
**Created**: 2026-01-21  
**Status**: Draft  
**Input**: User description: "Real time diff viewer for schema designer with visual diffs and a list of changes on the right drawer"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Real-Time Schema Changes (Priority: P1)

As a database developer using the Schema Designer, I want to see my schema changes in real-time so that I can understand what modifications will be applied to the database before publishing.

**Why this priority**: This is the core value proposition. Without real-time diff visibility, users cannot confidently make schema changes. This directly addresses the need for change awareness and reduces deployment errors.

**Independent Test**: Can be fully tested by opening Schema Designer, modifying a table (add column, rename, change type), and verifying the diff panel shows the pending change immediately. Delivers immediate visibility into schema modifications.

**Acceptance Scenarios**:

1. **Given** a user has opened Schema Designer with an existing database schema, **When** they add a new column to a table, **Then** the diff viewer updates immediately to show the column addition as a pending change.

2. **Given** a user has made multiple changes to a table (added column, modified data type, renamed column, deleted column), **When** they view the diff panel, **Then** all changes are displayed with clear visual indicators distinguishing additions, modifications, and deletions.

3. **Given** a user modifies a foreign key relationship, **When** they view the diff viewer, **Then** the old foreign key definition will be shown as deleted (red) and the new definition as added (green) if the source or target table/column changes. If no change occurs, it is shown as yellow (modified). Indicating name changes only.

4. **Given** a user deletes a table, **When** they view the diff panel, **Then** the entire table structure is shown as deleted with appropriate red styling.

5. **Given** a user adds a new table, **When** they view the diff panel, **Then** the entire table structure is shown as added with appropriate green styling.

6. **Given** a user made changes to table name or schema name, **When** they view the diff panel, **Then** the table rename is shown as a modification with yellow styling indicating old and new names.

7. **Given** a user has made changes and the diff viewer is visible, **When** they undo a change in the canvas, **Then** the diff viewer updates to remove that change from the pending changes list.

---

### User Story 2 - Access Changes List in Right Drawer (Priority: P1)

As a database developer, I want to see a summary list of all my schema changes in a right-side drawer panel so that I can quickly review what will be modified without searching through the entire schema.

**Why this priority**: Users need a centralized location to see all changes at a glance. The right drawer follows VS Code's established UI patterns (e.g., Source Control panel) and enables efficient review workflows.

**Independent Test**: Can be fully tested by making changes across multiple tables, opening the right drawer, and verifying all changes appear in a consolidated list. Delivers efficient change review capability.

**Acceptance Scenarios**:

1. **Given** a user has made changes to multiple tables, **When** they open the changes drawer, **Then** they see a grouped list showing all modified tables with their individual changes nested underneath.

2. **Given** a user is viewing the changes list in the drawer, **When** they click on a specific change item, **Then** the Schema Designer canvas navigates to and highlights the affected table (when it is a table or column) or foreign key.

3. **Given** no changes have been made to the schema, **When** the user opens the changes drawer, **Then** an empty state message indicates "No pending changes" with guidance on how to make modifications.

4. **Given** a user has made changes, **When** they view the changes drawer, **Then** an undo button is available on each change item to revert that specific change to its original schema state:
   - For additions: the added item is deleted
   - For deletions: the deleted item is restored
   - For modifications: the item is restored to its original value

5. **Given** a user has made changes, **When** they view the changes drawer, **Then** the list is scrollable and changes are grouped by table with color-coded change type indicators (green/yellow/red) on each item.

---

### User Story 3 - Visual Diff Display (Priority: P2)

As a database developer, I want to see visual diffs with color-coded indicators and clear formatting so that I can immediately distinguish between additions, modifications, and deletions.

**Why this priority**: Visual clarity improves comprehension speed and reduces errors. While the feature works without visual polish, color coding and formatting significantly enhance usability.

**Independent Test**: Can be fully tested by creating each type of change (add, modify, delete) and verifying appropriate visual styling is applied. Delivers improved change comprehension.

**Acceptance Scenarios**:

1. **Given** a user adds a new table or column, **When** they view the diff, **Then** additions are displayed with green highlighting/indicator following VS Code diff conventions.

2. **Given** a user modifies an existing column (e.g., changes data type), **When** they view the diff, **Then** modifications show both old and new values with yellow/blue modification styling.

3. **Given** a user deletes a table or column, **When** they view the diff, **Then** deletions are displayed with red highlighting/strikethrough following VS Code diff conventions.

4. **Given** a user is viewing the diff panel, **When** they are using a high-contrast VS Code theme, **Then** the diff colors remain accessible and distinguishable.

---

### User Story 4 - Toggle and Resize Diff Panel (Priority: P3)

As a database developer, I want to show/hide the diff viewer and resize it so that I can optimize my screen real estate based on my current task.

**Why this priority**: Flexibility in panel management is a standard VS Code expectation but is not critical for the core diff viewing functionality. Users can still use the feature effectively with a fixed panel.

**Independent Test**: Can be fully tested by toggling the panel visibility via toolbar button and dragging the resize handle. Delivers customizable workspace layout.

**Acceptance Scenarios**:

1. **Given** the user opens Schema Designer for the first time, **When** the page loads, **Then** the diff drawer is closed by default to maximize canvas space.

2. **Given** changes have been made to the schema, **When** the user views the toolbar, **Then** the "Show Changes" button displays the current count of changes (e.g., "Show Changes (5)").

3. **Given** the diff drawer is currently hidden, **When** the user clicks the "Show Changes (N)" button in the toolbar, **Then** the drawer slides open from the right side AND visual diff indicators appear on affected elements in the canvas.

4. **Given** the diff drawer is open, **When** the user drags the left edge of the drawer, **Then** the drawer resizes accordingly while maintaining minimum and maximum width constraints.

5. **Given** the user has resized the drawer to a custom width, **When** they close and reopen Schema Designer, **Then** the drawer remembers and restores their preferred width.

---

### Edge Cases

- What happens when a user makes changes that result in a very long diff (100+ changes)?
  - The changes list should be scrollable with virtualization for performance
  - Summary counts should appear at the top (e.g., "47 additions, 12 modifications, 3 deletions")

- How does the system handle conflicting changes (e.g., renaming a column that's referenced in a foreign key)?
  - Related/cascading changes should be grouped together with visual connection
  - Warning indicators should highlight potential issues

- What happens if the database connection is lost while viewing diffs?
  - The local diff state should be preserved
  - A non-blocking notification should indicate connection loss
  - Users should still be able to review pending changes

- How does the diff viewer behave with very long table/column names?
  - Text should truncate with ellipsis and show full name on hover
  - The drawer should have a minimum width to ensure readability

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display schema changes when user opens the changes drawer, comparing current state against the original schema loaded at session start
- **FR-002**: System MUST provide a right-side drawer panel accessible from the Schema Designer toolbar to display the consolidated changes list
- **FR-003**: System MUST categorize changes as additions (new tables, columns, foreign keys), modifications (renamed, type changed), or deletions
- **FR-004**: System MUST visually distinguish change types using color coding consistent with VS Code diff conventions (green for additions, red for deletions, yellow/blue for modifications)
- **FR-005**: System MUST group changes by table, showing the table name as a collapsible header with nested change items
- **FR-006**: System MUST enable navigation from a change item to the corresponding element in the Schema Designer canvas
- **FR-007**: System MUST update the diff view immediately when changes are undone or redone in the canvas
- **FR-008**: System MUST support drawer toggle via toolbar button that displays "Show Changes (N)" with live change count; opening the drawer MUST also display visual diff indicators on affected canvas elements
- **FR-009**: System MUST support drawer resizing with persistence of user preference
- **FR-010**: System MUST display change counts summary (additions, modifications, deletions) in the drawer header
- **FR-011**: System MUST show an appropriate empty state when no changes exist
- **FR-012**: System MUST maintain accessibility compliance (keyboard navigation, screen reader support, high-contrast themes)
- **FR-013**: System MUST localize all user-visible strings via the existing l10n infrastructure

### Key Entities

- **SchemaChange**: Represents a single change to the schema
  - Change type (addition, modification, deletion)
  - Target entity type (table, column, foreign key, index)
  - Entity identifier (table ID, column ID, etc.)
  - Previous value (for modifications/deletions)
  - New value (for additions/modifications)
  - Timestamp of change
  - Related changes (for cascading effects)

- **ChangeGroup**: Represents a collection of changes to a single table
  - Table identifier
  - Table name (display)
  - Schema name
  - List of SchemaChange items
  - Aggregate change state (new, modified, deleted)

- **DiffViewerState**: Represents the current state of the diff viewer panel
  - Is drawer open
  - Drawer width
  - Selected change (for navigation)
  - Filter/sort preferences

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can identify all pending schema changes within 5 seconds of opening the changes drawer
- **SC-002**: Diff calculation completes within 500ms of opening the changes drawer
- **SC-003**: Users can navigate from a change item to its canvas location with a single click
- **SC-004**: 95% of users can successfully complete a review-and-publish workflow without confusion about what changes will be applied
- **SC-005**: Zero accessibility violations when tested with screen readers and keyboard-only navigation
- **SC-006**: Diff panel renders smoothly (no visible lag) with up to 500 pending changes
- **SC-007**: Users report improved confidence in schema modifications (measurable via feedback or reduced support requests related to "unexpected changes")

## Clarifications

### Session 2026-01-21

- Q: When should diff calculation occur relative to user actions? → A: On-demand when user opens the changes drawer (not real-time on every change)
- Q: How should changes be organized in the drawer? → A: Group by table first, with change type indicators (color-coded) on each item
- Q: What does the undo button on a change item do? → A: Reverts only that specific change to original schema (additions are deleted, deletions are restored, modifications are reverted)
- Q: What is the default drawer state and toolbar behavior? → A: Drawer closed by default; toolbar button shows "Show Changes (N)" with live count; clicking opens drawer AND shows visual diffs in canvas
- Q: How should the toolbar change count be tracked? → A: Incrementally in real-time as changes happen (lightweight counter, separate from full diff calculation)

## Assumptions
- Diff calculation is performed on-demand when the user opens the changes drawer, comparing current schema state against the original state loaded when the Schema Designer session was created via SQL Tools Service.
- Change count for the toolbar button is tracked incrementally in real-time as users make modifications (lightweight counter updates), while full diff details are computed on-demand when the drawer opens.
- The right drawer pattern follows the existing `SchemaDesignerEditorDrawer` component architecture. However, it won't be modal and will allow interaction with the main canvas while open
- VS Code theming variables are available for consistent color styling for diff indicators
- The Schema Designer already tracks undo/redo state that can trigger diff updates. However, this is different from the undo/redo stack as it just track changes made since the schema designer session started.
- Users have sufficient screen resolution to accommodate a side drawer (minimum 1280px width assumed)
