# Data Model: Searchable Database Combobox

## Entities

### ConnectionProfile
Represents user-provided connection details used to fetch database options.

- **server**: string (required)
- **authenticationType**: enum (SqlLogin | Integrated | AzureMFA | AzureMFAAndUser | others)
- **user**: string (required for SqlLogin)
- **password**: string (required for SqlLogin)
- **accountId**: string (required for Entra auth types)
- **database**: string (selected or freeform entry; may be `<default>` or empty)

### DatabaseOptions
Represents the available database list for a specific connection profile.

- **options**: string[] (always includes `<default>`)
- **lastLoadedKey**: string (derived from server + auth type + user/account selection)
- **loadStatus**: enum (NotLoaded | Loading | Loaded)

### DatabaseSelection
Represents the current database value in the form.

- **value**: string (freeform or selected option)
- **source**: enum (listSelection | manualEntry)

## Relationships

- ConnectionProfile (1) → DatabaseOptions (0..1) keyed by the lastLoadedKey.
- ConnectionProfile (1) → DatabaseSelection (0..1).

## Validation Rules

- SqlLogin requires server + user + password before database list fetch is attempted.
- Integrated requires server before database list fetch is attempted.
- Entra auth requires server + accountId before database list fetch is attempted.
- DatabaseSelection.value may be any string; `<default>` is always valid.

## State Transitions

- When required fields change, DatabaseOptions become stale (lastLoadedKey mismatch).
- On combobox focus with sufficient fields, DatabaseOptions load and update options.
