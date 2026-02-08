# 09 — React Views: DAB Integration

> **Files covered:**
> - [dabPage.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/dab/dabPage.tsx)
> - [dabDefinitionsPanel.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/dab/dabDefinitionsPanel.tsx)
> - [dabEntitySettingsDialog.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/dab/dabEntitySettingsDialog.tsx)
> - [dabEntityTile.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/dab/dabEntityTile.tsx)
> - [dabToolbar.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/dab/dabToolbar.tsx)

**DAB** stands for **Data API Builder** — a Microsoft tool that auto-generates REST and GraphQL APIs from database tables. The Schema Designer integrates with DAB to let users visually configure which tables are exposed as API entities.

---

## Overview

The DAB view replaces the standard Schema Designer when the user is working with a DAB configuration file. Instead of showing a graph of tables, it shows:
- A **grid of entity tiles** (one per table)
- A **toolbar** for DAB-specific actions
- A **settings dialog** for configuring each entity's API exposure

---

## `dabPage.tsx` — DAB Main Page

This is the top-level component for the DAB view.

### Layout

```
┌─────────────────────────────────────────────────┐
│  [DAB Toolbar]                                  │
├─────────────────────────────────────────────────┤
│                                                 │
│  Schema: dbo                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Users    │ │ Orders   │ │ Products │       │
│  │ ☑ Read  │ │ ☑ Read  │ │ ☑ Read  │       │
│  │ ☑ Write │ │ ☐ Write │ │ ☑ Write │       │
│  │ [⚙]     │ │ [⚙]     │ │ [⚙]     │       │
│  └──────────┘ └──────────┘ └──────────┘       │
│                                                 │
│  Schema: hr                                     │
│  ┌──────────┐ ┌──────────┐                     │
│  │ Employees│ │ Benefits │                     │
│  │ ☑ Read  │ │ ☐ Read  │                     │
│  │ ☐ Write │ │ ☐ Write │                     │
│  │ [⚙]     │ │ [⚙]     │                     │
│  └──────────┘ └──────────┘                     │
│                                                 │
├─────────────────────────────────────────────────┤
│  [DAB Definitions Panel - JSON config]          │
└─────────────────────────────────────────────────┘
```

### Grouping by Schema

```tsx
const schemaGroups = useMemo(() => {
    const groups = new Map<string, DabEntity[]>();
    for (const entity of entities) {
        const schema = entity.sourceSchema || "dbo";
        if (!groups.has(schema)) groups.set(schema, []);
        groups.get(schema).push(entity);
    }
    return groups;
}, [entities]);
```

Tables are grouped by their SQL schema (`dbo`, `hr`, etc.) with headers for each group.

### Entity Data Model

Each table in the DAB context is represented as a `DabEntity`:

```typescript
interface DabEntity {
    name: string;           // API entity name (e.g., "User")
    sourceTable: string;    // SQL table name (e.g., "Users")
    sourceSchema: string;   // SQL schema (e.g., "dbo")
    restEnabled: boolean;   // Expose via REST API
    graphqlEnabled: boolean; // Expose via GraphQL API
    restPath?: string;      // Custom REST route (e.g., "/api/users")
    graphqlType?: string;   // Custom GraphQL type name
    permissions: DabPermission[]; // CRUD permissions
}
```

---

## `dabEntityTile.tsx` — Entity Card

Each table is shown as a compact tile with CRUD checkboxes.

### Tile Layout

```
┌─────────────────────────┐
│  📋 Users          [⚙]  │  ← Table name + settings button
│                         │
│  ☑ Create    ☑ Read     │  ← CRUD checkboxes
│  ☑ Update    ☑ Delete   │
└─────────────────────────┘
```

### CRUD Checkboxes

```tsx
const crudOperations = ["create", "read", "update", "delete"];

{crudOperations.map(op => (
    <Checkbox
        key={op}
        label={capitalize(op)}
        checked={entity.permissions.includes(op)}
        onChange={(_, data) => {
            if (data.checked) {
                onPermissionAdd(entity, op);
            } else {
                onPermissionRemove(entity, op);
            }
        }}
    />
))}
```

Toggling a checkbox adds/removes that operation from the entity's permissions list. This controls which CRUD operations the auto-generated API endpoint will support.

### Settings Button

Opens the `DabEntitySettingsDialog` for advanced configuration.

---

## `dabEntitySettingsDialog.tsx` — Entity Configuration

A dialog for configuring how a table is exposed through the API.

### Fields

| Field | Description | Example |
|-------|-------------|---------|
| **Entity Name** | The API entity name | `User` (maps to table `dbo.Users`) |
| **REST Enabled** | Toggle REST API exposure | `true` / `false` |
| **REST Path** | Custom REST route | `/api/users` |
| **GraphQL Enabled** | Toggle GraphQL exposure | `true` / `false` |
| **GraphQL Type** | Custom GraphQL type name | `User` |
| **Authentication** | Auth requirements | `anonymous`, `authenticated` |

### REST Configuration

```tsx
<Field label="REST Enabled">
    <Switch checked={entity.restEnabled} onChange={toggleRest} />
</Field>

{entity.restEnabled && (
    <Field label="REST Path">
        <Input value={entity.restPath} onChange={updateRestPath} />
    </Field>
)}
```

When REST is enabled, an additional field appears for the custom route path. When disabled, the field disappears.

### GraphQL Configuration

Same pattern — toggle enables/disables the type name field.

### Authentication

```tsx
<Field label="Permissions">
    <Dropdown value={entity.authRole}>
        <Option value="anonymous">Anonymous</Option>
        <Option value="authenticated">Authenticated</Option>
    </Dropdown>
</Field>
```

Controls whether the API endpoint requires authentication.

### Save

```tsx
const handleSave = () => {
    onEntityUpdate(entity);
    setDialogOpen(false);
};
```

Saves the entity configuration back to the DAB state. Changes are reflected immediately in the tile.

---

## `dabToolbar.tsx` — DAB-Specific Toolbar

A toolbar with actions specific to the DAB workflow.

### Buttons

| Button | Description |
|--------|-------------|
| **API Types** | Toggle between REST, GraphQL, or both |
| **Generate Config** | Generate the `dab-config.json` file |

### API Type Toggle

```tsx
<ToggleButton checked={showRest} onClick={toggleRest}>
    REST
</ToggleButton>
<ToggleButton checked={showGraphql} onClick={toggleGraphql}>
    GraphQL
</ToggleButton>
```

Controls which API types are included in the generated configuration.

### Generate Config

```tsx
const handleGenerateConfig = () => {
    // Collect all entity configurations
    const config = buildDabConfig(entities, apiTypes);
    
    // Send to extension host to write the file
    context.generateDabConfig(config);
};
```

Builds a DAB configuration JSON object and sends it to the extension host, which writes it as a `dab-config.json` file.

---

## `dabDefinitionsPanel.tsx` — Config Preview

Shows a read-only preview of the generated DAB configuration JSON.

```tsx
<pre className={classes.jsonPreview}>
    {JSON.stringify(dabConfig, null, 2)}
</pre>
```

This panel sits at the bottom of the DAB page and updates in real-time as the user modifies entity settings. It's the equivalent of the SQL script panel in the main Schema Designer view.

### What the Config Looks Like

```json
{
    "$schema": "https://dataapibuilder.azurewebsites.net/schemas/dab.draft.schema.json",
    "data-source": {
        "database-type": "mssql",
        "connection-string": "@env('DATABASE_CONNECTION_STRING')"
    },
    "entities": {
        "User": {
            "source": "dbo.Users",
            "rest": { "path": "/users" },
            "graphql": { "type": "User" },
            "permissions": [
                { "role": "anonymous", "actions": ["read"] },
                { "role": "authenticated", "actions": ["create", "read", "update", "delete"] }
            ]
        }
    }
}
```

---

## DAB ↔ Schema Designer Relationship

The DAB view is an **alternative presentation** of the same schema data. It shares:
- The same `SchemaDesignerContext` state provider
- The same underlying table/column data model
- The same RPC communication with the extension host

The difference is purely in the UI:
- **Standard view**: Graph diagram for designing table structure
- **DAB view**: Tile grid for configuring API exposure

The controller decides which view to show based on whether the user opened a DAB configuration file or a database connection.
