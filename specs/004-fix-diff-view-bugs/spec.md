# Feature Specification: Fix Diff View Bugs

**Feature Branch**: `004-fix-diff-view-bugs`  
**Created**: 2026-01-22  
**Status**: Draft  
**Input**: User description: "Fix diff view bugs and issues that I found while using it."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deleted Elements Canvas Visualization (Priority: P1)

Users need to see deleted tables and foreign keys visualized on the canvas when the diff drawer is open. Currently, deleted elements may not be visible or properly styled, making it difficult to understand what will be removed when changes are applied.

**Why this priority**: Seeing deleted elements is critical for users to understand the impact of their changes before committing. Without this, users might accidentally delete important schema elements.

**Independent Test**: Delete a table and a foreign key, open the diff drawer, verify both appear on canvas with red borders. Close drawer, verify they disappear. Reopen drawer, verify they reappear.

**Acceptance Scenarios**:

1. **Given** a deleted table in the schema, **When** diff drawer is opened, **Then** the deleted table appears on canvas with a red border
2. **Given** a deleted foreign key in the schema, **When** diff drawer is opened, **Then** the deleted foreign key edge appears on canvas with a red color
3. **Given** deleted elements visible on canvas, **When** diff drawer is closed, **Then** deleted elements are hidden from canvas
4. **Given** a deleted table with foreign keys, **When** viewing the diff drawer, **Then** both the table and its foreign keys show as deleted

---

### User Story 2 - Undo Action Synchronization (Priority: P1)

When users undo a change from the diff drawer, all visual indicators must update immediately and consistently. The drawer list, toolbar count, and canvas indicators should all reflect the undone state without requiring manual refresh.

**Why this priority**: Inconsistent state after undo operations causes confusion and could lead users to believe their action didn't work, potentially causing them to make additional unwanted changes.

**Independent Test**: Delete a table, open drawer, click undo on the deletion. Verify: drawer item disappears, toolbar count decreases, canvas removes the red border from the restored table.

**Acceptance Scenarios**:

1. **Given** a deleted table shown in the drawer, **When** user clicks undo, **Then** the table is restored and red border is removed from canvas immediately
2. **Given** a deleted foreign key shown in the drawer, **When** user clicks undo, **Then** the foreign key is restored and red edge color is removed immediately
3. **Given** multiple changes in the drawer, **When** user undoes one change, **Then** toolbar count updates immediately to reflect remaining changes
4. **Given** an undone change, **When** viewing the drawer, **Then** the undone item is no longer listed

---

### User Story 3 - Foreign Key Reveal and Focus (Priority: P2)

Users need to be able to navigate to and focus on foreign key edges from the diff drawer, similar to how they can reveal tables. When revealed, foreign keys should have a visible glowing border effect to draw attention.

**Why this priority**: Foreign key changes are important schema modifications that users need to verify. Without reveal functionality, users must manually search for edges in complex schemas.

**Independent Test**: Add or modify a foreign key, open drawer, click reveal button on the foreign key item. Verify canvas pans to the edge and the edge receives a glowing highlight animation.

**Acceptance Scenarios**:

1. **Given** a foreign key change in the drawer, **When** user clicks reveal button, **Then** canvas pans to center the foreign key edge
2. **Given** a revealed foreign key, **When** edge is centered, **Then** edge displays a glowing border effect for visual emphasis
3. **Given** a foreign key connecting distant tables, **When** revealed, **Then** the entire edge path is visible and highlighted

---

### User Story 4 - Table Rename Visualization (Priority: P2)

When a table's name or schema is modified, users need to see both the old and new values clearly on the canvas. The old name/schema should appear with strikethrough styling, and the new name/schema should appear next to it.

**Why this priority**: Name changes are significant modifications that users need to clearly understand. Showing both old and new values prevents confusion about what the table was called before.

**Independent Test**: Rename a table (change name or schema), open diff drawer, verify the table node shows old name with strikethrough and new name displayed next to it.

**Acceptance Scenarios**:

1. **Given** a table with modified name, **When** viewing on canvas with drawer open, **Then** old name shows with strikethrough styling
2. **Given** a table with modified name, **When** viewing on canvas with drawer open, **Then** new name appears next to the strikethrough old name
3. **Given** a table with modified schema, **When** viewing on canvas, **Then** old schema shows with strikethrough and new schema displayed
4. **Given** both name and schema modified, **When** viewing on canvas, **Then** both changes are clearly visible with strikethrough styling

---

### User Story 5 - Foreign Key Modification Indicators (Priority: P2)

Users need clear visual distinction between different types of foreign key modifications. Property-only changes (name, actions) should show yellow indicators, while structural changes (source/target columns) should show the old edge as red (deleted) and new edge as green (added).

**Why this priority**: Different types of foreign key changes have different impacts. Structural changes (re-pointing relationships) are more significant than property changes and should be visually distinguished.

**Independent Test**: 
1. Modify a FK's name → verify FK edge turns yellow
2. Modify a FK's source/target columns → verify old edge turns red and new edge appears green

**Acceptance Scenarios**:

1. **Given** a foreign key with modified name, **When** viewing on canvas, **Then** the edge shows yellow/amber color indicating modification
2. **Given** a foreign key with modified delete/update action, **When** viewing on canvas, **Then** the edge shows yellow/amber color
3. **Given** a foreign key with modified source column, **When** viewing on canvas, **Then** old relationship edge shows red and new edge shows green
4. **Given** a foreign key with modified target table/column, **When** viewing on canvas, **Then** old relationship edge shows red and new edge shows green

---

### User Story 6 - Granular Foreign Key Entries in Drawer (Priority: P2)

When a new table is created with foreign keys, users need separate entries in the diff drawer for the table and each foreign key. This allows users to undo or reveal individual items rather than treating the table and its relationships as a single unit.

**Why this priority**: Granular control over changes allows users to selectively undo parts of their work. A user might want to keep a new table but remove one of its foreign keys.

**Independent Test**: Create a new table with two foreign keys. Open drawer and verify: one entry for the table, two separate entries for the foreign keys. Undo one FK, verify only that FK is removed while table and other FK remain.

**Acceptance Scenarios**:

1. **Given** a new table with foreign keys, **When** viewing the drawer, **Then** the table appears as a separate change item
2. **Given** a new table with foreign keys, **When** viewing the drawer, **Then** each foreign key appears as its own change item
3. **Given** multiple FK entries for a new table, **When** user reveals one FK, **Then** only that specific FK is highlighted
4. **Given** multiple FK entries for a new table, **When** user undoes one FK, **Then** only that FK is removed while table remains

---

### Edge Cases

- What happens when a deleted table has foreign keys pointing to it from other tables? The dependent FKs should also show as affected.
- How does the system handle undo when multiple related changes exist (e.g., table + FKs)? Each should be undoable independently.
- What happens when a FK's source and target columns are both modified? Should show as structural change (red old + green new).
- How does strikethrough display on very long table names that already truncate? Should still be readable.
- What happens when rapidly clicking reveal on multiple items? Should cancel previous animation and show latest.
- How does the drawer handle a new table where the user later deletes one of its FKs in the same session? Should show table as added, FK as (not present/undone).

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: Diff viewer must show deleted tables with a red border in the canvas when the drawer is open.
- **FR-002**: Diff viewer must show deleted foreign keys with a red border in the canvas when the drawer is open.
- **FR-003**: Diff viewer must remove deleted tables and foreign keys in the canvas when the drawer is closed.
- **FR-004**: Diff viewer must restore the deleted tables and foreign keys when undo is triggered from the drawer item. While doing that it must also remove any red borders or edge colors from the canvas.
- **FR-005**: On Undo action from the drawer, the drawer list, toolbar count, and canvas indicators must update immediately after action.
- **FR-006**: Foreign keys should also be focusable from the drawer reveal in canvas button. IT should also have a glowing border effect when revealed.
- **FR-007**: Table name and schema modifications should be shown as strikethrough text in table nodes with new name/schema shown next to it.
- **FR-008**: Foreign key name/property modification should make a foreign key yellow.
- **FR-009**: Foreign key source and target should make the old relation edge red and new relation edge green.
- **FR-010**: New tables with foreign keys should have separate entries in the diff drawer for the table and each foreign key. So that users can just undo or reveal them individually.


### Key Entities *(include if feature involves data)*

- **DeletedTable**: A table that existed in the original schema but has been removed. Rendered on canvas with red border when drawer is open.
- **DeletedForeignKey**: A foreign key relationship that existed in the original schema but has been removed. Rendered as red edge on canvas when drawer is open.
- **ModifiedForeignKey**: A foreign key with changed properties. Can be property-only (yellow) or structural (old red + new green).
- **RenamedTable**: A table whose name or schema has changed. Shows old name with strikethrough and new name displayed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All deleted tables and foreign keys are visible on canvas with appropriate red styling when drawer is open (verified by visual inspection)
- **SC-002**: Undo action updates drawer list, toolbar count, and canvas indicators within 200ms of user action
- **SC-003**: Foreign key reveal button navigates to and highlights the edge within 500ms
- **SC-004**: Table rename shows both old (strikethrough) and new names clearly readable in the node header
- **SC-005**: Foreign key property changes show yellow, structural changes show red/green split (verified by visual inspection)
- **SC-006**: New tables with N foreign keys produce exactly N+1 entries in the drawer (1 table + N FKs)
- **SC-007**: All existing unit tests continue to pass after implementation
- **SC-008**: Build and lint complete without errors
