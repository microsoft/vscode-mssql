# DAB Designer UX Gaps

This note compares the current vscode-mssql DAB designer UX with the DAB config surface in the upstream [Data API builder repo](https://github.com/Azure/data-api-builder).

## Summary

The current designer intentionally covers the common path:

- Global API type selection for REST, GraphQL, and MCP.
- Entity inclusion/exclusion.
- Table and view CRUD action selection.
- Column exposure.
- Basic advanced entity settings: entity name, authorization role, REST path, GraphQL type.
- Stored procedure MCP custom-tool setting.

DAB supports a broader configuration surface. The items below are gaps where the extension either does not expose a setting, emits an opinionated default, or only partially maps DAB behavior.

## Broad DAB UX Gaps

| #   | DAB option or behavior                       | Applies to                                           | Current extension behavior                                                                                               | Suggested UI direction                                                                                                                                                                                                |
| --- | -------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `relationships`                              | Tables, views, and other entities with relationships | The database schema designer understands foreign keys, but the DAB config builder does not emit DAB relationship config. | Add a Relationships section in advanced entity config. Start with read-only inferred relationships from FKs, then allow rename/expose controls. Leave complex linking-object relationships for an advanced JSON mode. |
| 2   | `mappings`                                   | Tables and views                                     | The designer supports field aliases through `fields`, but not the full DAB `mappings` object.                            | Add a column mapping grid with `database column` -> `exposed field name`. Prefer this over separate alias-only controls if DAB mapping support becomes important.                                                     |
| 3   | Permission action policies                   | Tables, views, stored procedures                     | The designer supports role plus action selection, but not request/database policy expressions.                           | Add an Advanced permissions section per role/action with collapsible policy text fields. Keep hidden by default and validate expressions lightly.                                                                     |
| 4   | Multiple permission entries                  | All entity types                                     | The designer models one role per entity: anonymous or authenticated.                                                     | Replace the single role selector with a roles table. Default to one row, allow adding roles, and show action checkboxes per role.                                                                                     |
| 5   | Entity-level REST enablement                 | All entity types                                     | REST is controlled globally through API Type. Per-entity REST can only be indirectly customized with REST path.          | Add an entity-level REST toggle in advanced entity config. Disable it when global REST is off, with helper text.                                                                                                      |
| 6   | Entity-level GraphQL enablement              | All entity types                                     | GraphQL is controlled globally through API Type. Per-entity GraphQL can only be indirectly customized with GraphQL type. | Add an entity-level GraphQL toggle in advanced entity config. Disable it when global GraphQL is off, with helper text.                                                                                                |
| 7   | Entity-level `cache`                         | Tables/views read paths and supported entities       | No per-entity cache controls are exposed in the DAB designer output.                                                     | Add a Performance or Cache section with enabled, TTL seconds, and level controls. Hide unless REST/GraphQL read paths are relevant.                                                                                   |
| 8   | Entity-level `health`                        | All entity types                                     | No entity health-check controls are exposed.                                                                             | Add an Advanced health section with enabled, threshold, and first-row settings only after runtime health is exposed.                                                                                                  |
| 9   | Runtime REST path                            | Runtime REST endpoint                                | Builder hardcodes `/api`.                                                                                                | Add API Settings popover/dialog from the toolbar where REST path can be edited when REST is selected.                                                                                                                 |
| 10  | Runtime GraphQL path                         | Runtime GraphQL endpoint                             | Builder hardcodes `/graphql`.                                                                                            | Add GraphQL path next to REST path in the same API Settings dialog.                                                                                                                                                   |
| 11  | Runtime MCP path, description, and DML tools | Runtime MCP endpoint                                 | Toolbar only exposes MCP as an API type checkbox.                                                                        | Add an MCP Settings panel with path, description, and individual DML tool toggles. Keep basic toolbar checkbox as the quick enable/disable control.                                                                   |
| 12  | Runtime cache                                | Global runtime cache                                 | Not exposed.                                                                                                             | Add a global Cache section in API Settings. Entity cache controls should inherit from this and show effective value.                                                                                                  |
| 13  | Runtime health                               | Global health endpoint                               | Not exposed.                                                                                                             | Add a Health section in API Settings for endpoint enabled state, roles, cache TTL, and thresholds.                                                                                                                    |
| 14  | Host/auth/CORS/runtime mode                  | Runtime host and auth settings                       | Builder hardcodes development mode and `cors.origins: ["*"]`; auth is not configurable in this designer flow.            | Keep out of the primary DAB designer unless deployment scenarios require it. If needed, expose under Advanced Runtime Settings with clear defaults and warnings for permissive CORS.                                  |

## Stored Procedure Findings

These are stored-procedure-specific gaps and decisions called out during the review. Some overlap with the broader table above, but they are listed separately because stored procedures are the biggest area where DAB-specific behavior differs from table/view behavior.

| #   | DAB option or behavior                                                                                             | Current extension behavior                                                                                                                                          | Suggested UI direction                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SP1 | Stored procedure REST methods: `rest.methods` with `get`, `post`, `put`, `patch`, `delete`; DAB default is `post`. | The extension exposes custom REST path only. It cannot choose which HTTP methods execute the procedure.                                                             | Add a Stored Procedure REST section with method checkboxes. Default to `post`. Disable when global REST or entity REST is off.                                           |
| SP2 | Stored procedure GraphQL operation: `graphql.operation` with `query` or `mutation`; DAB default is `mutation`.     | The extension exposes custom GraphQL type only. It cannot mark a read-only stored procedure as a GraphQL query.                                                     | Add a segmented control in stored procedure advanced config: `Mutation` default, `Query` optional. Disable when global GraphQL or entity GraphQL is off.                 |
| SP3 | Entity MCP DML tools and custom tool flags are independent: `mcp.dml-tools` and `mcp.custom-tool`.                 | The extension currently maps the checkbox to custom-tool behavior. Checked emits `{ "custom-tool": true, "dml-tools": false }`; unchecked omits entity-level `mcp`. | Keep the simple checkbox for now, but consider an advanced MCP section with separate toggles: custom tool, generic MCP DML/execute tools, and fully hidden from MCP.     |
| SP4 | Runtime MCP settings affect whether MCP tools are available at all.                                                | The stored procedure custom-tool checkbox is shown only for stored procedures and disabled when MCP API type is off.                                                | Current UX is reasonable. Keep helper text: "Enable MCP in API Type to use this custom tool setting."                                                                    |
| SP5 | Stored procedure parameters can carry `required`, `default`, and `description`.                                    | Builder can emit parameter metadata when present, but stored procedure rows are not expandable and the UX does not really let users inspect/edit parameters.        | Allow stored procedure expansion, showing a parameter table. Add advanced editing for required/default/description where metadata is incomplete or user wants overrides. |

## Recommended UI Shape

### Toolbar API Settings

Add a compact settings button near the REST/GraphQL/MCP API Type controls. This should open an API Settings dialog with tabs or sections:

- REST: enabled, path.
- GraphQL: enabled, path.
- MCP: enabled, path, description, DML tool toggles.
- Cache: global cache controls.
- Health: global health controls.
- Advanced: host mode, CORS, auth-related settings if the product wants this designer to own them.

The toolbar checkboxes should remain the quick controls for common users.

### Advanced Entity Config

Keep the current dialog, but split it into grouped sections:

- Identity: entity name.
- Exposure: entity-level REST and GraphQL toggles, custom REST path, custom GraphQL type.
- Authorization: roles and actions.
- Columns/fields: exposure, aliases/mappings.
- Relationships: inferred relationships and customization.
- Cache and health: only when runtime settings are enabled or relevant.
- Stored procedure: REST methods, GraphQL operation, MCP custom-tool behavior, parameters.

### Copilot Tool Support

For every new UI setting, update the DAB Copilot tool schema and `patch_entity_settings` or add a more structured change type. Copilot should be able to edit the same settings that users can edit in the UI.

Recommended new change types:

- `patch_runtime_settings`
- `patch_entity_exposure`
- `patch_entity_permissions`
- `patch_entity_relationships`
- `patch_entity_cache`
- `patch_entity_health`
- `patch_stored_procedure_settings`

## Suggested Priorities

| Priority | Work item                                           | Reason                                                                             |
| -------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| P0       | Stored procedure REST methods and GraphQL operation | These are first-class DAB stored procedure options and affect endpoint shape.      |
| P1       | Entity-level REST/GraphQL enablement                | Users commonly need to expose an entity in one API but not another.                |
| P1       | Multiple roles and permission policies              | Important for realistic auth configurations.                                       |
| P1       | Runtime MCP settings                                | Needed to align MCP custom-tool UX with global MCP behavior.                       |
| P2       | Relationships and mappings                          | Important for richer APIs, but more complex and should be designed carefully.      |
| P2       | Stored procedure parameter editing                  | Useful, especially when metadata is incomplete.                                    |
| P3       | Cache, health, host/auth/CORS                       | Valuable advanced coverage, but less central to the initial DAB designer workflow. |
