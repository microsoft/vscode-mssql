# Feature Specification: Searchable Database Combobox

**Feature Branch**: `aasim-khan/feat/001-database-combobox`  
**Created**: 2026-01-29  
**Status**: Draft  
**Input**: User description: "Create a searchable database combobox in the connection dialog. The database combobox loads options once sufficient connection profile fields are populated based on the selected authentication type: for SQL Authentication, server plus username and password; for Entra Authentication, server plus a selected Entra account; and for Windows Authentication, server only. After the options are loaded, the combobox allows the user to search and select a database from the available options for the provided connection details. If the desired database is not listed, or if loading the options fails, the user can manually type the database name directly into the combobox and proceed with creating a connection to that database."

## Clarifications

### Session 2026-01-29

- Q: When should database options load after required fields are populated? → A: Load only when the combobox has focus (open/typing).
- Q: What should happen to the database value when server or authentication changes? → A: Keep the value and allow proceeding without warning.
- Q: How should the UI behave if no databases are returned? → A: Always include a <default> option; if no databases load, allow manual entry or selecting <default>.
- Q: How should the default database option be labeled? → A: Use the literal option `<default>` in all cases.
- Q: How should database list load errors be surfaced? → A: Do not show an error; show an empty list while allowing manual entry.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select from loaded databases (Priority: P1)

As a user configuring a connection, I want the database field to load options when I have provided the required connection details for my authentication type, so I can quickly select the correct database.

**Why this priority**: This is the core workflow that enables fast and accurate connection setup for most users.

**Independent Test**: Can be fully tested by populating required fields for each authentication type and verifying a list appears and a database can be selected.

**Acceptance Scenarios**:

1. **Given** SQL Authentication is selected and server, username, and password are populated, **When** the database field is opened, **Then** a list of available databases is shown for those details.
2. **Given** Entra Authentication is selected and server and an Entra account are selected, **When** the database field is opened, **Then** a list of available databases is shown for those details.
3. **Given** Windows Authentication is selected and server is populated, **When** the database field is opened, **Then** a list of available databases is shown for those details.
4. **Given** database options are loading, **When** the database field has focus, **Then** a loading spinner is shown next to the database label.

---

### User Story 2 - Manually enter a database (Priority: P2)

As a user, I want to type a database name directly if the list is missing my database or fails to load, so I can still complete the connection.

**Why this priority**: Users must be able to proceed even when listing is unavailable or incomplete.

**Independent Test**: Can be fully tested by simulating a list load failure or missing database and verifying manual entry allows connection creation.

**Acceptance Scenarios**:

1. **Given** database options fail to load, **When** I type a database name into the field, **Then** I can proceed to create a connection using that name.
2. **Given** the list loads but does not contain my database, **When** I type a database name into the field, **Then** I can proceed to create a connection using that name.

---

### User Story 3 - Search within the database list (Priority: P3)

As a user, I want to search within the database list, so I can quickly find a database without scrolling a long list.

**Why this priority**: Search improves efficiency for users with many databases.

**Independent Test**: Can be fully tested by loading a list with multiple entries and verifying that typing filters the options and allows selection.

**Acceptance Scenarios**:

1. **Given** a list of databases is loaded, **When** I type in the database field, **Then** the list filters to matching databases and I can select one.

---

### Edge Cases

- What happens when required fields are cleared after a list loads?
- How does the system handle switching authentication types after a list loads?
- What happens when the list request returns no databases (only <default> available)?
- How does the system handle invalid credentials or expired sessions while loading the list (silent, manual entry allowed)?
- What happens when the user changes the server after a database is selected?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The database field in the connection dialog MUST be a searchable combobox that supports both selection and free-text entry.
- **FR-002**: The system MUST only attempt to load database options when the required fields for the selected authentication type are populated: SQL Authentication (server, username, password), Entra Authentication (server, selected Entra account), Windows Authentication (server only).
- **FR-003**: When the required fields are populated and the database combobox receives focus (opened or user starts typing), the system MUST attempt to retrieve database options for the provided connection details.
- **FR-004**: After options load, users MUST be able to search the list and select a database.
- **FR-005**: The database list MUST always include a `<default>` option in addition to any loaded databases.
- **FR-006**: Users MUST be able to manually enter a database name even when the list is missing their database or fails to load, and MUST be able to select `<default>` when no databases are returned.
- **FR-007**: If any required field is cleared or the authentication type changes, the system MUST treat any previously loaded options and selections as stale, but MUST keep any existing database value and allow proceeding without warning.
- **FR-008**: The system MUST allow connection creation when a database name is manually entered, regardless of list load success.
- **FR-009**: If loading database options fails, the system MUST show an empty list without surfacing an error and MUST still allow manual entry.
- **FR-010**: While database options are loading, the connection dialog MUST show a loading spinner next to the database field label.
- **FR-011**: Database option loading MUST use the current connection dialog form values at the moment the combobox is focused.

### Key Entities *(include if feature involves data)*

- **Connection Profile Fields**: Server, authentication type, username, password, Entra account selection, database name.
- **Database Option List**: The set of database names available for the provided connection details.
- **Database Selection**: The chosen database name, either from the list or manual entry.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 90% of users can select a database from the list within 30 seconds when valid connection details are provided.
- **SC-002**: 100% of tested scenarios allow connection creation with a manually entered database when list loading fails or returns no match.
- **SC-003**: At least 80% of users can find and select a database by typing 3 or fewer characters into the combobox.
- **SC-004**: Support tickets related to “unable to choose a database during connection setup” decrease by 25% within 8 weeks of release.

## Assumptions

- The connection dialog already exposes authentication type selection and the required fields listed above.
- Listing available databases is an expected capability for the connection types supported.
- Manual database entry is acceptable even if it does not appear in the loaded list.
