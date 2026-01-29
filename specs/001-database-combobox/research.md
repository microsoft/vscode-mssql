# Research: Searchable Database Combobox

## Decision 1: Use Fluent UI Combobox with freeform input for database field

**Decision**: Use `@fluentui/react-components` `Combobox` in the connection dialog database field,
configured for freeform input and option selection, with `<default>` always present in the list.

**Rationale**: The Combobox supports editable input (manual entry) and keyboard search while
integrating with existing Fluent UI styling already used in the repo.

**Alternatives considered**:
- SearchableDropdown (rejected: does not allow freeform entry)
- Custom combobox implementation (rejected: unnecessary complexity vs built-in control)

## Decision 2: Load databases via temporary connection + listDatabases request

**Decision**: When the combobox receives focus and required fields are populated, create a
temporary connection (GUID ownerUri), call SQL Tools Service `connection/listdatabases`, then
disconnect and return the list.

**Rationale**: Existing listDatabases API requires an ownerUri bound to a connection. Using a
short-lived connection aligns with current connectionManager patterns and avoids new service APIs.

**Alternatives considered**:
- Add a new SQL Tools Service API that lists databases from raw connection info (rejected: larger
  cross-service change)
- Reuse saved connections only (rejected: does not support ad-hoc connection details)

## Decision 3: Keep options in dialog state and suppress load errors

**Decision**: Store database options on the database form component (`formComponents.database.options`)
with a `lastLoadedKey`-style guard (server/auth/user/account) to avoid redundant fetches, and
return an empty list (plus `<default>`) on failure without surfacing an error UI.

**Rationale**: Keeping options in shared state ensures the webview renders consistently and matches
spec requirements to suppress load errors while still allowing manual entry.

**Alternatives considered**:
- Keep options only in local webview component state (rejected: harder to coordinate with
  reducer-driven updates and validation)
