# Schema Designer — Architecture Overview

## What Is the Schema Designer?

The Schema Designer is a **visual database schema editor** built into the vscode-mssql extension. It lets users open a SQL Server database, see all its tables as a **node-graph diagram** (powered by React Flow), edit tables/columns/foreign keys through UI panels, preview the SQL changes, and publish those changes back to the database.

---

## High-Level Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│  VS Code Extension Host (Node.js)                                      │
│                                                                        │
│  ┌──────────────────────┐    ┌───────────────────────────────┐         │
│  │ SchemaDesignerService│◄──►│ SQL Tools Service (STS)       │         │
│  │  (RPC to backend)    │    │  (Language Server Protocol)   │         │
│  └─────────┬────────────┘    └───────────────────────────────┘         │
│            │                                                           │
│  ┌─────────▼────────────────────────┐                                  │
│  │ SchemaDesignerWebviewController  │  ← handles RPC from webview      │
│  │  (per database instance)         │  ← manages session lifecycle     │
│  └─────────┬────────────────────────┘                                  │
│            │                                                           │
│  ┌─────────▼────────────────────────┐                                  │
│  │ SchemaDesignerWebviewManager     │  ← singleton, manages all        │
│  │  (lifecycle + cache)             │     open schema designer tabs    │
│  └─────────────────────────────────┬┘                                  │
│                                    │                                   │
│  ┌─────────────────────────────────▼┐                                  │
│  │ SchemaDesignerTool (Copilot LM)  │  ← VS Code LM tool for AI       │
│  └──────────────────────────────────┘    edits via GitHub Copilot      │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
          ▲  JSON-RPC over webview messaging
          │
          ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Webview (React, rendered in VS Code panel)                            │
│                                                                        │
│  ┌─────────────────────────────────────────┐                           │
│  │ SchemaDesignerStateProvider (Context)    │  ← central React state   │
│  │  + RPC handlers + diff engine            │                          │
│  └─────────┬───────────────┬───────────────┘                           │
│            │               │                                           │
│  ┌─────────▼───┐  ┌───────▼─────────┐  ┌──────────────────┐          │
│  │ Graph Layer  │  │ Editor Drawer   │  │ Changes Panel    │          │
│  │ (React Flow) │  │ (Table/FK edit) │  │ (Diff tree view) │          │
│  └──────────────┘  └─────────────────┘  └──────────────────┘          │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────┐         │
│  │ Toolbar (Add Table, Undo/Redo, Export, Publish, etc.)    │         │
│  └──────────────────────────────────────────────────────────┘         │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────┐         │
│  │ Definitions Panel (SQL script preview)                    │         │
│  └──────────────────────────────────────────────────────────┘         │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────┐         │
│  │ DAB (Data API Builder) sub-page                           │         │
│  └──────────────────────────────────────────────────────────┘         │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

| Concept | Explanation |
|---------|-------------|
| **Session** | A server-side session (in SQL Tools Service) tied to one database. Created on first open, cached so reopening the same DB is instant. Has a `sessionId`. |
| **Schema** | The data model: an array of `Table` objects, each with `Column[]` and `ForeignKey[]`. This is the single source of truth. |
| **Baseline Schema** | A snapshot of the schema at "last publish" time. Used to compute diffs against the current state.  |
| **Nodes & Edges** | React Flow's graph representation. Each `Node` contains a `Table` in its `data` field. Each `Edge` contains a `ForeignKey` in its `data` field. |
| **Undo/Redo** | A stack of React Flow state snapshots. Push on every mutation, pop on undo. |
| **SchemaDesignerEdit** | A semantic edit operation (e.g., `add_table`, `set_column`). Used by the Copilot LM tool to make bulk changes programmatically. |
| **Version hash** | SHA-256 of normalized schema. Used by the Copilot tool for optimistic concurrency — edits must send the `expectedVersion` to ensure they are operating on the latest state. |

---

## Data Flow for a Typical User Action

### Example: User edits a column name

1. User clicks "Edit" on a table node → `eventBus` emits `editTable`
2. `SchemaDesignerEditorDrawer` opens with the table data
3. User types new column name in the `SchemaDesignerEditorTablePanel`
4. User clicks "Save" → `context.updateTable(updatedTable)` is called
5. `updateTable` updates the React Flow node data and edges
6. `eventBus` emits `pushState` → undo stack saves current state  
7. `eventBus` emits `getScript` → triggers diff recalculation + SQL definition fetch
8. `SchemaDesignerStateProvider` sends `getDefinition` RPC to extension host
9. Extension host forwards to SQL Tools Service via `SchemaDesignerService`
10. SQL script comes back and is displayed in the Definitions Panel

---

## File Index

| Layer | File | Purpose |
|-------|------|---------|
| **Types** | [sharedInterfaces/schemaDesigner.ts](../extensions/mssql/src/sharedInterfaces/schemaDesigner.ts) | All TypeScript interfaces and RPC message types |
| **Contracts** | [models/contracts/schemaDesigner.ts](../extensions/mssql/src/models/contracts/schemaDesigner.ts) | LSP request types for the backend service |
| **Service** | [services/schemaDesignerService.ts](../extensions/mssql/src/services/schemaDesignerService.ts) | Talks to SQL Tools Service over LSP |
| **Controller** | [schemaDesigner/schemaDesignerWebviewController.ts](../extensions/mssql/src/schemaDesigner/schemaDesignerWebviewController.ts) | Per-instance webview controller |
| **Manager** | [schemaDesigner/schemaDesignerWebviewManager.ts](../extensions/mssql/src/schemaDesigner/schemaDesignerWebviewManager.ts) | Singleton lifecycle manager |
| **Copilot Tool** | [copilot/tools/schemaDesignerTool.ts](../extensions/mssql/src/copilot/tools/schemaDesignerTool.ts) | LM tool for AI-driven schema edits |
| **React Entry** | [reactviews/pages/SchemaDesigner/index.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/index.tsx) | Webview entry point |
| **State** | [reactviews/pages/SchemaDesigner/schemaDesignerStateProvider.tsx](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerStateProvider.tsx) | Central React context + all state logic |
| **RPC Handlers** | [reactviews/pages/SchemaDesigner/schemaDesignerRpcHandlers.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerRpcHandlers.ts) | Webview-side handlers for bulk edits & schema state queries |
| **Utilities** | [reactviews/pages/SchemaDesigner/schemaDesignerUtils.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerUtils.ts) | Table/column/FK creation, validation, layout |
| **Edge Utils** | [reactviews/pages/SchemaDesigner/schemaDesignerEdgeUtils.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerEdgeUtils.ts) | FK edge identity and rename helpers |
| **Events** | [reactviews/pages/SchemaDesigner/schemaDesignerEvents.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerEvents.ts) | Typed event bus for component communication |
| **Undo State** | [reactviews/pages/SchemaDesigner/schemaDesignerUndoState.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerUndoState.ts) | Undo/redo stack singleton + React hook |
| **Batch Utils** | [reactviews/pages/SchemaDesigner/schemaDesignerToolBatchUtils.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerToolBatchUtils.ts) | Normalization and validation for LM tool batches |
| **Batch Hooks** | [reactviews/pages/SchemaDesigner/schemaDesignerToolBatchHooks.ts](../extensions/mssql/src/reactviews/pages/SchemaDesigner/schemaDesignerToolBatchHooks.ts) | React hooks for tool batch auto-arrange |
| **Diff Engine** | [reactviews/pages/SchemaDesigner/diff/](../extensions/mssql/src/reactviews/pages/SchemaDesigner/diff/) | Schema comparison algorithms |
| **Graph** | [reactviews/pages/SchemaDesigner/graph/](../extensions/mssql/src/reactviews/pages/SchemaDesigner/graph/) | React Flow diagram components |
| **Editor** | [reactviews/pages/SchemaDesigner/editor/](../extensions/mssql/src/reactviews/pages/SchemaDesigner/editor/) | Table/FK editing drawer |
| **Toolbar** | [reactviews/pages/SchemaDesigner/toolbar/](../extensions/mssql/src/reactviews/pages/SchemaDesigner/toolbar/) | Top toolbar buttons |
| **Changes** | [reactviews/pages/SchemaDesigner/changes/](../extensions/mssql/src/reactviews/pages/SchemaDesigner/changes/) | Changes panel (diff viewer) |
| **DAB** | [reactviews/pages/SchemaDesigner/dab/](../extensions/mssql/src/reactviews/pages/SchemaDesigner/dab/) | Data API Builder integration |

---

## Navigation

- [01 — Shared Interfaces & Types](01-TYPES.md)
- [02 — Service Layer](02-SERVICE.md)
- [03 — Controller & Manager](03-CONTROLLER.md)
- [04 — React Views — State & Core](04-REACT-STATE.md)
- [05 — React Views — Graph Layer](05-REACT-GRAPH.md)
- [06 — React Views — Editor Drawer](06-REACT-EDITOR.md)
- [07 — React Views — Toolbar](07-REACT-TOOLBAR.md)
- [08 — React Views — Diff & Changes](08-REACT-DIFF.md)
- [09 — React Views — DAB Integration](09-REACT-DAB.md)
- [10 — Copilot LM Tool](10-COPILOT-TOOL.md)
