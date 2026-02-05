/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Edge } from "@xyflow/react";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";

/**
 * Source of an edit action - helps distinguish user edits from AI/Copilot edits.
 */
export type EditSource = "user" | "copilot" | "import";

/**
 * All supported undo/redo action types.
 */
export type UndoRedoActionType =
    // Table operations
    | "addTable"
    | "deleteTable"
    | "updateTable"
    // Column operations
    | "addColumn"
    | "deleteColumn"
    | "updateColumn"
    // Foreign key operations
    | "addForeignKey"
    | "deleteForeignKey"
    | "updateForeignKey"
    // Batch operations (for AI edits)
    | "batchEdit";

/**
 * Base interface for all undo/redo actions.
 */
export interface TypedUndoRedoActionBase {
    /** The type of action */
    type: UndoRedoActionType;
    /** When this action was performed */
    timestamp: number;
    /** Source of the edit (user, copilot, import) */
    source: EditSource;
    /** Optional session ID for grouping related edits (e.g., same Copilot request) */
    sessionId?: string;
}

// ============================================================================
// Table Actions
// ============================================================================

export interface AddTableAction extends TypedUndoRedoActionBase {
    type: "addTable";
    redoData: {
        table: SchemaDesigner.Table;
    };
    undoData: {
        tableId: string;
    };
}

export interface DeleteTableAction extends TypedUndoRedoActionBase {
    type: "deleteTable";
    redoData: {
        tableId: string;
    };
    undoData: {
        table: SchemaDesigner.Table;
        /** Edges that were connected to this table (for restoration) */
        edges: Edge<SchemaDesigner.ForeignKey>[];
    };
}

export interface UpdateTableAction extends TypedUndoRedoActionBase {
    type: "updateTable";
    redoData: {
        tableId: string;
        changes: Partial<SchemaDesigner.Table>;
    };
    undoData: {
        tableId: string;
        previousState: Partial<SchemaDesigner.Table>;
    };
}

// ============================================================================
// Column Actions
// ============================================================================

export interface AddColumnAction extends TypedUndoRedoActionBase {
    type: "addColumn";
    redoData: {
        tableId: string;
        column: SchemaDesigner.Column;
        /** Index where to insert the column */
        index?: number;
    };
    undoData: {
        tableId: string;
        columnId: string;
    };
}

export interface DeleteColumnAction extends TypedUndoRedoActionBase {
    type: "deleteColumn";
    redoData: {
        tableId: string;
        columnId: string;
    };
    undoData: {
        tableId: string;
        column: SchemaDesigner.Column;
        /** Original index of the column for restoration */
        index: number;
    };
}

export interface UpdateColumnAction extends TypedUndoRedoActionBase {
    type: "updateColumn";
    redoData: {
        tableId: string;
        columnId: string;
        changes: Partial<SchemaDesigner.Column>;
    };
    undoData: {
        tableId: string;
        columnId: string;
        previousState: Partial<SchemaDesigner.Column>;
    };
}

// ============================================================================
// Foreign Key Actions
// ============================================================================

export interface AddForeignKeyAction extends TypedUndoRedoActionBase {
    type: "addForeignKey";
    redoData: {
        tableId: string;
        foreignKey: SchemaDesigner.ForeignKey;
    };
    undoData: {
        tableId: string;
        foreignKeyId: string;
    };
}

export interface DeleteForeignKeyAction extends TypedUndoRedoActionBase {
    type: "deleteForeignKey";
    redoData: {
        tableId: string;
        foreignKeyId: string;
    };
    undoData: {
        tableId: string;
        foreignKey: SchemaDesigner.ForeignKey;
        /** Edges that represented this FK (for restoration) */
        edges: Edge<SchemaDesigner.ForeignKey>[];
    };
}

export interface UpdateForeignKeyAction extends TypedUndoRedoActionBase {
    type: "updateForeignKey";
    redoData: {
        tableId: string;
        foreignKeyId: string;
        changes: Partial<SchemaDesigner.ForeignKey>;
    };
    undoData: {
        tableId: string;
        foreignKeyId: string;
        previousState: Partial<SchemaDesigner.ForeignKey>;
    };
}

// ============================================================================
// Batch Action (for AI/Copilot edits)
// ============================================================================

/**
 * A batch action groups multiple actions into a single undoable unit.
 * Used for Copilot/AI edits where multiple changes should be undone together.
 */
export interface BatchEditAction extends TypedUndoRedoActionBase {
    type: "batchEdit";
    redoData: {
        /** Actions to execute in order for redo */
        actions: SchemaDesignerAction[];
    };
    undoData: {
        /** Actions to execute in reverse order for undo */
        actions: SchemaDesignerAction[];
    };
    /** Human-readable description of the batch (e.g., "Copilot: Add users table with columns") */
    description?: string;
}

// ============================================================================
// Union Type
// ============================================================================

/**
 * Union of all possible schema designer actions.
 */
export type SchemaDesignerAction =
    | AddTableAction
    | DeleteTableAction
    | UpdateTableAction
    | AddColumnAction
    | DeleteColumnAction
    | UpdateColumnAction
    | AddForeignKeyAction
    | DeleteForeignKeyAction
    | UpdateForeignKeyAction
    | BatchEditAction;

// ============================================================================
// Action Factories
// ============================================================================

/**
 * Creates a timestamp for actions.
 */
function now(): number {
    return Date.now();
}

/**
 * Factory functions for creating typed actions.
 */
export const ActionFactory = {
    addTable(
        table: SchemaDesigner.Table,
        source: EditSource = "user",
        sessionId?: string,
    ): AddTableAction {
        return {
            type: "addTable",
            timestamp: now(),
            source,
            sessionId,
            redoData: { table },
            undoData: { tableId: table.id },
        };
    },

    deleteTable(
        table: SchemaDesigner.Table,
        edges: Edge<SchemaDesigner.ForeignKey>[],
        source: EditSource = "user",
        sessionId?: string,
    ): DeleteTableAction {
        return {
            type: "deleteTable",
            timestamp: now(),
            source,
            sessionId,
            redoData: { tableId: table.id },
            undoData: { table, edges },
        };
    },

    updateTable(
        tableId: string,
        changes: Partial<SchemaDesigner.Table>,
        previousState: Partial<SchemaDesigner.Table>,
        source: EditSource = "user",
        sessionId?: string,
    ): UpdateTableAction {
        return {
            type: "updateTable",
            timestamp: now(),
            source,
            sessionId,
            redoData: { tableId, changes },
            undoData: { tableId, previousState },
        };
    },

    addColumn(
        tableId: string,
        column: SchemaDesigner.Column,
        index?: number,
        source: EditSource = "user",
        sessionId?: string,
    ): AddColumnAction {
        return {
            type: "addColumn",
            timestamp: now(),
            source,
            sessionId,
            redoData: { tableId, column, index },
            undoData: { tableId, columnId: column.id },
        };
    },

    deleteColumn(
        tableId: string,
        column: SchemaDesigner.Column,
        index: number,
        source: EditSource = "user",
        sessionId?: string,
    ): DeleteColumnAction {
        return {
            type: "deleteColumn",
            timestamp: now(),
            source,
            sessionId,
            redoData: { tableId, columnId: column.id },
            undoData: { tableId, column, index },
        };
    },

    updateColumn(
        tableId: string,
        columnId: string,
        changes: Partial<SchemaDesigner.Column>,
        previousState: Partial<SchemaDesigner.Column>,
        source: EditSource = "user",
        sessionId?: string,
    ): UpdateColumnAction {
        return {
            type: "updateColumn",
            timestamp: now(),
            source,
            sessionId,
            redoData: { tableId, columnId, changes },
            undoData: { tableId, columnId, previousState },
        };
    },

    addForeignKey(
        tableId: string,
        foreignKey: SchemaDesigner.ForeignKey,
        source: EditSource = "user",
        sessionId?: string,
    ): AddForeignKeyAction {
        return {
            type: "addForeignKey",
            timestamp: now(),
            source,
            sessionId,
            redoData: { tableId, foreignKey },
            undoData: { tableId, foreignKeyId: foreignKey.id },
        };
    },

    deleteForeignKey(
        tableId: string,
        foreignKey: SchemaDesigner.ForeignKey,
        edges: Edge<SchemaDesigner.ForeignKey>[],
        source: EditSource = "user",
        sessionId?: string,
    ): DeleteForeignKeyAction {
        return {
            type: "deleteForeignKey",
            timestamp: now(),
            source,
            sessionId,
            redoData: { tableId, foreignKeyId: foreignKey.id },
            undoData: { tableId, foreignKey, edges },
        };
    },

    updateForeignKey(
        tableId: string,
        foreignKeyId: string,
        changes: Partial<SchemaDesigner.ForeignKey>,
        previousState: Partial<SchemaDesigner.ForeignKey>,
        source: EditSource = "user",
        sessionId?: string,
    ): UpdateForeignKeyAction {
        return {
            type: "updateForeignKey",
            timestamp: now(),
            source,
            sessionId,
            redoData: { tableId, foreignKeyId, changes },
            undoData: { tableId, foreignKeyId, previousState },
        };
    },

    batchEdit(
        actions: SchemaDesignerAction[],
        source: EditSource = "copilot",
        sessionId?: string,
        description?: string,
    ): BatchEditAction {
        // For undo, we need to reverse the actions
        const reversedActions = [...actions].reverse();
        return {
            type: "batchEdit",
            timestamp: now(),
            source,
            sessionId,
            redoData: { actions },
            undoData: { actions: reversedActions },
            description,
        };
    },
};
