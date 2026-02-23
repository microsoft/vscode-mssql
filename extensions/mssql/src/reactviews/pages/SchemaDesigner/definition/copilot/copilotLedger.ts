/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../../../sharedInterfaces/schemaDesigner";

export enum CopilotOperation {
    AddTable = "AddTable",
    DropTable = "DropTable",
    SetTable = "SetTable",
    AddColumn = "AddColumn",
    DropColumn = "DropColumn",
    SetColumn = "SetColumn",
    AddForeignKey = "AddForeignKey",
    DropForeignKey = "DropForeignKey",
    SetForeignKey = "SetForeignKey",
}

export interface CopilotChange {
    operation: CopilotOperation;
    description: string;
    groupId?: string;
    /**
     * Parent table context for column/foreign key operations.
     * For table operations this should match the table id.
     */
    tableId?: string;
    before: SchemaDesigner.Table | SchemaDesigner.Column | SchemaDesigner.ForeignKey | undefined;
    after: SchemaDesigner.Table | SchemaDesigner.Column | SchemaDesigner.ForeignKey | undefined;
}

type CopilotEntityCategory = "table" | "column" | "foreignKey";
type CopilotAction = "add" | "set" | "drop";

interface OperationMeta {
    category: CopilotEntityCategory;
    action: CopilotAction;
}

function getOperationMeta(operation: CopilotOperation): OperationMeta {
    switch (operation) {
        case CopilotOperation.AddTable:
            return { category: "table", action: "add" };
        case CopilotOperation.DropTable:
            return { category: "table", action: "drop" };
        case CopilotOperation.SetTable:
            return { category: "table", action: "set" };
        case CopilotOperation.AddColumn:
            return { category: "column", action: "add" };
        case CopilotOperation.DropColumn:
            return { category: "column", action: "drop" };
        case CopilotOperation.SetColumn:
            return { category: "column", action: "set" };
        case CopilotOperation.AddForeignKey:
            return { category: "foreignKey", action: "add" };
        case CopilotOperation.DropForeignKey:
            return { category: "foreignKey", action: "drop" };
        case CopilotOperation.SetForeignKey:
            return { category: "foreignKey", action: "set" };
    }
}

function createOperation(category: CopilotEntityCategory, action: CopilotAction): CopilotOperation {
    switch (category) {
        case "table":
            return action === "add"
                ? CopilotOperation.AddTable
                : action === "drop"
                  ? CopilotOperation.DropTable
                  : CopilotOperation.SetTable;
        case "column":
            return action === "add"
                ? CopilotOperation.AddColumn
                : action === "drop"
                  ? CopilotOperation.DropColumn
                  : CopilotOperation.SetColumn;
        case "foreignKey":
            return action === "add"
                ? CopilotOperation.AddForeignKey
                : action === "drop"
                  ? CopilotOperation.DropForeignKey
                  : CopilotOperation.SetForeignKey;
    }
}

function getEntityId(change: CopilotChange): string | undefined {
    const value = change.after ?? change.before;
    return (value as { id?: string } | undefined)?.id;
}

function findOwningTableId(
    entityId: string,
    category: Extract<CopilotEntityCategory, "column" | "foreignKey">,
    schema: SchemaDesigner.Schema,
): string | undefined {
    for (const table of schema.tables ?? []) {
        if (
            category === "column" &&
            (table.columns ?? []).some((column) => column.id === entityId)
        ) {
            return table.id;
        }
        if (
            category === "foreignKey" &&
            (table.foreignKeys ?? []).some((foreignKey) => foreignKey.id === entityId)
        ) {
            return table.id;
        }
    }
    return undefined;
}

function resolveTableId(change: CopilotChange, schema: SchemaDesigner.Schema): string | undefined {
    if (change.tableId) {
        return change.tableId;
    }

    const { category } = getOperationMeta(change.operation);
    if (category === "table") {
        return getEntityId(change);
    }

    const entityId = getEntityId(change);
    if (!entityId) {
        return undefined;
    }

    if (category === "column") {
        return findOwningTableId(entityId, "column", schema);
    }

    return findOwningTableId(entityId, "foreignKey", schema);
}

function getChangeKey(change: CopilotChange, schema: SchemaDesigner.Schema): string | undefined {
    const { category } = getOperationMeta(change.operation);
    const entityId = getEntityId(change);
    if (!entityId) {
        return undefined;
    }

    if (category === "table") {
        return `table:${entityId}`;
    }

    const tableId = resolveTableId(change, schema);
    if (!tableId) {
        return `${category}:unknown:${entityId}`;
    }

    return `${category}:${tableId}:${entityId}`;
}

function normalizeChange(change: CopilotChange, schema: SchemaDesigner.Schema): CopilotChange {
    const tableId = resolveTableId(change, schema);
    return {
        ...change,
        tableId,
    };
}

function mergeChanges(existing: CopilotChange, incoming: CopilotChange): CopilotChange | undefined {
    const existingMeta = getOperationMeta(existing.operation);
    const incomingMeta = getOperationMeta(incoming.operation);
    const category = existingMeta.category;
    const tableId = incoming.tableId ?? existing.tableId;

    if (existingMeta.category !== incomingMeta.category) {
        return {
            ...incoming,
            groupId: incoming.groupId ?? existing.groupId,
            tableId,
        };
    }

    // Existing net state is "add": keep folding until delete cancels it out.
    if (existingMeta.action === "add") {
        if (incomingMeta.action === "drop") {
            return undefined;
        }
        return {
            operation: createOperation(category, "add"),
            description: incoming.description,
            groupId: incoming.groupId ?? existing.groupId,
            tableId,
            before: existing.before,
            after: incoming.after ?? existing.after,
        };
    }

    // Existing net state is "set": preserve earliest before and latest after.
    if (existingMeta.action === "set") {
        if (incomingMeta.action === "drop") {
            return {
                operation: createOperation(category, "drop"),
                description: incoming.description,
                groupId: incoming.groupId ?? existing.groupId,
                tableId,
                before: existing.before,
                after: incoming.after,
            };
        }
        return {
            operation: createOperation(category, "set"),
            description: incoming.description,
            groupId: incoming.groupId ?? existing.groupId,
            tableId,
            before: existing.before,
            after: incoming.after ?? existing.after,
        };
    }

    // Existing net state is "drop": if it appears again, it becomes a replace/modify.
    if (incomingMeta.action === "drop") {
        return {
            operation: createOperation(category, "drop"),
            description: incoming.description,
            groupId: incoming.groupId ?? existing.groupId,
            tableId,
            before: existing.before ?? incoming.before,
            after: incoming.after,
        };
    }

    return {
        operation: createOperation(category, "set"),
        description: incoming.description,
        groupId: incoming.groupId ?? existing.groupId,
        tableId,
        before: existing.before,
        after: incoming.after ?? existing.after,
    };
}

function findTableById(
    schema: SchemaDesigner.Schema,
    tableId: string | undefined,
): SchemaDesigner.Table | undefined {
    if (!tableId) {
        return undefined;
    }
    return (schema.tables ?? []).find((table) => table.id === tableId);
}

function findEntityInSchema(
    schema: SchemaDesigner.Schema,
    category: CopilotEntityCategory,
    entityId: string | undefined,
    tableIdHint: string | undefined,
): SchemaDesigner.Table | SchemaDesigner.Column | SchemaDesigner.ForeignKey | undefined {
    if (!entityId) {
        return undefined;
    }

    if (category === "table") {
        return findTableById(schema, entityId);
    }

    const tableHint = findTableById(schema, tableIdHint);
    if (tableHint) {
        if (category === "column") {
            const column = (tableHint.columns ?? []).find((value) => value.id === entityId);
            if (column) {
                return column;
            }
        } else {
            const foreignKey = (tableHint.foreignKeys ?? []).find((value) => value.id === entityId);
            if (foreignKey) {
                return foreignKey;
            }
        }
    }

    for (const table of schema.tables ?? []) {
        if (category === "column") {
            const column = (table.columns ?? []).find((value) => value.id === entityId);
            if (column) {
                return column;
            }
            continue;
        }

        const foreignKey = (table.foreignKeys ?? []).find((value) => value.id === entityId);
        if (foreignKey) {
            return foreignKey;
        }
    }

    return undefined;
}

function isSameEntityShape(
    left: SchemaDesigner.Table | SchemaDesigner.Column | SchemaDesigner.ForeignKey | undefined,
    right: SchemaDesigner.Table | SchemaDesigner.Column | SchemaDesigner.ForeignKey | undefined,
): boolean {
    if (!left || !right) {
        return false;
    }
    return JSON.stringify(left) === JSON.stringify(right);
}

export function reconcileTrackedChangesWithSchema(
    trackedChanges: CopilotChange[],
    currentSchema: SchemaDesigner.Schema,
): CopilotChange[] {
    return trackedChanges.filter((change) => {
        const meta = getOperationMeta(change.operation);
        const tableId = resolveTableId(change, currentSchema);
        const beforeId = (change.before as { id?: string } | undefined)?.id;
        const afterId = (change.after as { id?: string } | undefined)?.id;
        const beforeCurrent = findEntityInSchema(currentSchema, meta.category, beforeId, tableId);
        const afterCurrent = findEntityInSchema(currentSchema, meta.category, afterId, tableId);

        if (meta.action === "add") {
            return Boolean(afterCurrent);
        }

        if (meta.action === "drop") {
            if (!beforeId) {
                return false;
            }
            return !beforeCurrent;
        }

        if (afterCurrent) {
            return true;
        }

        if (beforeCurrent && isSameEntityShape(beforeCurrent, change.before)) {
            return false;
        }

        return false;
    });
}

export function processCopilotChanges(
    currentBatch: CopilotChange[],
    trackedChanges: CopilotChange[],
    currentSchema: SchemaDesigner.Schema,
): CopilotChange[] {
    const changesByKey = new Map<string, CopilotChange>();
    let unresolvedCounter = 0;

    const apply = (rawChange: CopilotChange) => {
        const incoming = normalizeChange(rawChange, currentSchema);
        const key =
            getChangeKey(incoming, currentSchema) ??
            `unresolved:${incoming.operation}:${unresolvedCounter++}`;
        const existing = changesByKey.get(key);
        if (!existing) {
            changesByKey.set(key, incoming);
            return;
        }

        const merged = mergeChanges(existing, incoming);
        if (!merged) {
            changesByKey.delete(key);
            return;
        }
        changesByKey.set(key, merged);
    };

    for (const change of trackedChanges) {
        apply(change);
    }
    for (const change of currentBatch) {
        apply(change);
    }

    return reconcileTrackedChangesWithSchema([...changesByKey.values()], currentSchema);
}
