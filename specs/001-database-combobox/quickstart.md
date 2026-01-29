# Quickstart: Searchable Database Combobox

## Prerequisites

- MSSQL extension build environment set up
- Access to a SQL Server instance for test connections

## Manual Test Steps

1. Run the MSSQL extension in VS Code.
2. Open the Connection Dialog (Parameters mode).
3. SQL Authentication:
   - Enter server, username, and password.
   - Focus the Database combobox.
   - Verify the list loads and includes `<default>`.
   - Type to filter and select a database.
   - Type a database name not in the list and verify it remains as the value.
4. Windows Authentication:
   - Enter server only.
   - Focus the Database combobox and verify list loads (with `<default>`).
5. Entra Authentication:
   - Select Entra authentication type and an account.
   - Enter server.
   - Focus the Database combobox and verify list loads (with `<default>`).
6. Error handling:
   - Enter invalid credentials and focus the Database combobox.
   - Verify no error banner is shown; list is empty except `<default>` and manual entry still works.
7. Stale data:
   - Load a list, then change server or authentication type.
   - Ensure the database value remains, and the next focus triggers a fresh load.

## Regression Checks

- Connection creation still works when the database value is manually entered.
- No change in behavior for Azure/Fabric browse workflows.

## Validation Notes

- 2026-01-29: Manual validation steps not run in this environment (requires VS Code + SQL Server instance).
