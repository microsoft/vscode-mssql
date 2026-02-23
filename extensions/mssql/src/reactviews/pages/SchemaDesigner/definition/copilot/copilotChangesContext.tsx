/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { createSchemaDesignerApplyEditsHandler } from "../../schemaDesignerRpcHandlers";
import { SchemaDesignerContext } from "../../schemaDesignerStateProvider";
import eventBus from "../../schemaDesignerEvents";
import { SchemaDesigner } from "../../../../../sharedInterfaces/schemaDesigner";
import {
    normalizeColumn,
    normalizeTable,
    validateTable,
    waitForNextFrame,
} from "../../schemaDesignerToolBatchUtils";
import {
    CopilotChange,
    CopilotOperation,
    processCopilotChanges,
    reconcileTrackedChangesWithSchema,
} from "./copilotLedger";

export interface CopilotChangesContextProps {
    trackedChanges: CopilotChange[];
    dismissTrackedChange: (index: number) => void;
    acceptTrackedChange: (index: number) => void;
    undoTrackedChange: (index: number) => Promise<boolean>;
    canUndoTrackedChange: (index: number) => boolean;
    revealTrackedChange: (index: number) => void;
    clearTrackedChanges: () => void;
}

const CopilotChangesContext = createContext<CopilotChangesContextProps | undefined>(undefined);

type CopilotTrackedEntity =
    | SchemaDesigner.Table
    | SchemaDesigner.Column
    | SchemaDesigner.ForeignKey
    | undefined;

type CopilotEntityCategory = "table" | "column" | "foreignKey";

const cloneValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const normalizeIdentifier = (value: string | undefined): string => (value ?? "").toLowerCase();

const resolveTable = (
    schema: SchemaDesigner.Schema,
    ref: SchemaDesigner.TableRef,
): SchemaDesigner.Table | undefined => {
    if (ref.id) {
        return schema.tables.find((table) => table.id === ref.id);
    }
    return schema.tables.find(
        (table) =>
            normalizeIdentifier(table.schema) === normalizeIdentifier(ref.schema) &&
            normalizeIdentifier(table.name) === normalizeIdentifier(ref.name),
    );
};

const resolveColumn = (
    table: SchemaDesigner.Table | undefined,
    ref: SchemaDesigner.ColumnRef,
): SchemaDesigner.Column | undefined => {
    if (!table) {
        return undefined;
    }
    if (ref.id) {
        return (table.columns ?? []).find((column) => column.id === ref.id);
    }
    return (table.columns ?? []).find(
        (column) => normalizeIdentifier(column.name) === normalizeIdentifier(ref.name),
    );
};

const resolveForeignKey = (
    table: SchemaDesigner.Table | undefined,
    ref: SchemaDesigner.ForeignKeyRef,
): SchemaDesigner.ForeignKey | undefined => {
    if (!table) {
        return undefined;
    }
    if (ref.id) {
        return (table.foreignKeys ?? []).find((foreignKey) => foreignKey.id === ref.id);
    }
    return (table.foreignKeys ?? []).find(
        (foreignKey) => normalizeIdentifier(foreignKey.name) === normalizeIdentifier(ref.name),
    );
};

const formatQualifiedTable = (table: SchemaDesigner.Table | undefined): string => {
    if (!table) {
        return "table";
    }
    return `[${table.schema}].[${table.name}]`;
};

const describeCopilotChange = (
    operation: CopilotOperation,
    before: CopilotTrackedEntity,
    after: CopilotTrackedEntity,
): string => {
    switch (operation) {
        case CopilotOperation.AddTable:
            return `Added table ${formatQualifiedTable(after as SchemaDesigner.Table | undefined)}.`;
        case CopilotOperation.DropTable:
            return `Dropped table ${formatQualifiedTable(before as SchemaDesigner.Table | undefined)}.`;
        case CopilotOperation.SetTable:
            return `Updated table ${formatQualifiedTable(after as SchemaDesigner.Table | undefined)}.`;
        case CopilotOperation.AddColumn:
            return `Added column '${(after as SchemaDesigner.Column | undefined)?.name ?? ""}'.`;
        case CopilotOperation.DropColumn:
            return `Dropped column '${(before as SchemaDesigner.Column | undefined)?.name ?? ""}'.`;
        case CopilotOperation.SetColumn:
            return `Updated column '${(after as SchemaDesigner.Column | undefined)?.name ?? ""}'.`;
        case CopilotOperation.AddForeignKey:
            return `Added foreign key '${(after as SchemaDesigner.ForeignKey | undefined)?.name ?? ""}'.`;
        case CopilotOperation.DropForeignKey:
            return `Dropped foreign key '${(before as SchemaDesigner.ForeignKey | undefined)?.name ?? ""}'.`;
        case CopilotOperation.SetForeignKey:
            return `Updated foreign key '${(after as SchemaDesigner.ForeignKey | undefined)?.name ?? ""}'.`;
    }
};

const createCopilotChange = (params: {
    operation: CopilotOperation;
    tableId?: string;
    before: CopilotTrackedEntity;
    after: CopilotTrackedEntity;
}): CopilotChange => {
    const before = params.before ? cloneValue(params.before) : undefined;
    const after = params.after ? cloneValue(params.after) : undefined;
    return {
        operation: params.operation,
        tableId: params.tableId,
        before,
        after,
        description: describeCopilotChange(params.operation, before, after),
    };
};

const buildCopilotBatchFromAppliedEdits = (
    request: SchemaDesigner.ApplyEditsWebviewParams,
    response: SchemaDesigner.ApplyEditsWebviewResponse,
    preSchema: SchemaDesigner.Schema,
    postSchema: SchemaDesigner.Schema,
): CopilotChange[] => {
    const appliedEdits = response.appliedEdits ?? (response.success ? request.edits.length : 0);
    if (appliedEdits <= 0) {
        return [];
    }

    const applied = request.edits.slice(0, appliedEdits);
    const batch: CopilotChange[] = [];

    for (const edit of applied) {
        switch (edit.op) {
            case "add_table": {
                const after = resolveTable(postSchema, edit.table);
                batch.push(
                    createCopilotChange({
                        operation: CopilotOperation.AddTable,
                        tableId: after?.id,
                        before: undefined,
                        after,
                    }),
                );
                break;
            }
            case "drop_table": {
                const before = resolveTable(preSchema, edit.table);
                batch.push(
                    createCopilotChange({
                        operation: CopilotOperation.DropTable,
                        tableId: before?.id,
                        before,
                        after: undefined,
                    }),
                );
                break;
            }
            case "set_table": {
                const before = resolveTable(preSchema, edit.table);
                const after =
                    (before && resolveTable(postSchema, { ...edit.table, id: before.id })) ??
                    resolveTable(postSchema, {
                        ...edit.table,
                        schema: edit.set?.schema ?? edit.table.schema,
                        name: edit.set?.name ?? edit.table.name,
                    });
                batch.push(
                    createCopilotChange({
                        operation: CopilotOperation.SetTable,
                        tableId: after?.id ?? before?.id,
                        before,
                        after,
                    }),
                );
                break;
            }
            case "add_column": {
                const postTable = resolveTable(postSchema, edit.table);
                const after = (postTable?.columns ?? []).find(
                    (column) =>
                        normalizeIdentifier(column.name) === normalizeIdentifier(edit.column.name),
                );
                batch.push(
                    createCopilotChange({
                        operation: CopilotOperation.AddColumn,
                        tableId: postTable?.id,
                        before: undefined,
                        after,
                    }),
                );
                break;
            }
            case "drop_column": {
                const preTable = resolveTable(preSchema, edit.table);
                const before = resolveColumn(preTable, edit.column);
                batch.push(
                    createCopilotChange({
                        operation: CopilotOperation.DropColumn,
                        tableId: preTable?.id,
                        before,
                        after: undefined,
                    }),
                );
                break;
            }
            case "set_column": {
                const preTable = resolveTable(preSchema, edit.table);
                const before = resolveColumn(preTable, edit.column);
                const postTable =
                    (preTable && resolveTable(postSchema, { ...edit.table, id: preTable.id })) ??
                    resolveTable(postSchema, edit.table);
                const after = before
                    ? resolveColumn(postTable, { ...edit.column, id: before.id })
                    : resolveColumn(postTable, edit.column);
                batch.push(
                    createCopilotChange({
                        operation: CopilotOperation.SetColumn,
                        tableId: postTable?.id ?? preTable?.id,
                        before,
                        after,
                    }),
                );
                break;
            }
            case "add_foreign_key": {
                const postTable = resolveTable(postSchema, edit.table);
                const after = (postTable?.foreignKeys ?? []).find(
                    (foreignKey) =>
                        normalizeIdentifier(foreignKey.name) ===
                        normalizeIdentifier(edit.foreignKey.name),
                );
                batch.push(
                    createCopilotChange({
                        operation: CopilotOperation.AddForeignKey,
                        tableId: postTable?.id,
                        before: undefined,
                        after,
                    }),
                );
                break;
            }
            case "drop_foreign_key": {
                const preTable = resolveTable(preSchema, edit.table);
                const before = resolveForeignKey(preTable, edit.foreignKey);
                batch.push(
                    createCopilotChange({
                        operation: CopilotOperation.DropForeignKey,
                        tableId: preTable?.id,
                        before,
                        after: undefined,
                    }),
                );
                break;
            }
            case "set_foreign_key": {
                const preTable = resolveTable(preSchema, edit.table);
                const before = resolveForeignKey(preTable, edit.foreignKey);
                const postTable =
                    (preTable && resolveTable(postSchema, { ...edit.table, id: preTable.id })) ??
                    resolveTable(postSchema, edit.table);
                const after = before
                    ? resolveForeignKey(postTable, { ...edit.foreignKey, id: before.id })
                    : resolveForeignKey(postTable, edit.foreignKey);
                batch.push(
                    createCopilotChange({
                        operation: CopilotOperation.SetForeignKey,
                        tableId: postTable?.id ?? preTable?.id,
                        before,
                        after,
                    }),
                );
                break;
            }
        }
    }

    return batch;
};

const getOperationCategory = (operation: CopilotOperation): CopilotEntityCategory => {
    switch (operation) {
        case CopilotOperation.AddTable:
        case CopilotOperation.DropTable:
        case CopilotOperation.SetTable:
            return "table";
        case CopilotOperation.AddColumn:
        case CopilotOperation.DropColumn:
        case CopilotOperation.SetColumn:
            return "column";
        case CopilotOperation.AddForeignKey:
        case CopilotOperation.DropForeignKey:
        case CopilotOperation.SetForeignKey:
            return "foreignKey";
    }
};

const getChangeEntityId = (change: CopilotChange): string | undefined =>
    ((change.after ?? change.before) as { id?: string } | undefined)?.id;

const getChangeSignature = (change: CopilotChange): string => {
    const beforeId = (change.before as { id?: string } | undefined)?.id ?? "";
    const afterId = (change.after as { id?: string } | undefined)?.id ?? "";
    return `${change.operation}:${change.tableId ?? ""}:${beforeId}:${afterId}`;
};

const getGroupedIndexes = (changes: CopilotChange[], index: number): number[] => {
    if (index < 0 || index >= changes.length) {
        return [];
    }

    const target = changes[index];
    if (!target.groupId) {
        return [index];
    }

    const grouped: number[] = [];
    for (let i = 0; i < changes.length; i++) {
        if (changes[i].groupId === target.groupId) {
            grouped.push(i);
        }
    }
    return grouped;
};

const findTableById = (
    schema: SchemaDesigner.Schema,
    tableId: string | undefined,
): SchemaDesigner.Table | undefined => {
    if (!tableId) {
        return undefined;
    }
    return schema.tables.find((table) => table.id === tableId);
};

const findTableByName = (
    schema: SchemaDesigner.Schema,
    tableSchema: string,
    tableName: string,
): SchemaDesigner.Table | undefined =>
    schema.tables.find(
        (table) =>
            normalizeIdentifier(table.schema) === normalizeIdentifier(tableSchema) &&
            normalizeIdentifier(table.name) === normalizeIdentifier(tableName),
    );

const buildTableRef = (table: SchemaDesigner.Table): SchemaDesigner.TableRef => ({
    id: table.id,
    schema: table.schema,
    name: table.name,
});

const buildColumnRef = (column: SchemaDesigner.Column): SchemaDesigner.ColumnRef => ({
    id: column.id,
    name: column.name,
});

const buildForeignKeyRef = (
    foreignKey: SchemaDesigner.ForeignKey,
): SchemaDesigner.ForeignKeyRef => ({
    id: foreignKey.id,
    name: foreignKey.name,
});

const toColumnCreate = (column: SchemaDesigner.Column): SchemaDesigner.ColumnCreate => {
    const columnWithoutId = { ...column };
    delete (columnWithoutId as Partial<SchemaDesigner.Column>).id;
    return columnWithoutId;
};

const toForeignKeyMappings = (
    foreignKey: SchemaDesigner.ForeignKey,
): SchemaDesigner.ForeignKeyMapping[] =>
    foreignKey.columns
        .map((column, index) => ({
            column,
            referencedColumn: foreignKey.referencedColumns[index],
        }))
        .filter((mapping) => !!mapping.column && !!mapping.referencedColumn);

const toForeignKeyCreate = (
    foreignKey: SchemaDesigner.ForeignKey,
    currentSchema: SchemaDesigner.Schema,
): SchemaDesigner.ForeignKeyCreate | undefined => {
    const mappings = toForeignKeyMappings(foreignKey);
    if (mappings.length === 0) {
        return undefined;
    }

    const referencedTableInSchema = findTableByName(
        currentSchema,
        foreignKey.referencedSchemaName,
        foreignKey.referencedTableName,
    );
    const referencedTable: SchemaDesigner.TableRef = referencedTableInSchema
        ? buildTableRef(referencedTableInSchema)
        : {
              schema: foreignKey.referencedSchemaName,
              name: foreignKey.referencedTableName,
          };

    return {
        name: foreignKey.name,
        referencedTable,
        mappings,
        onDeleteAction: foreignKey.onDeleteAction,
        onUpdateAction: foreignKey.onUpdateAction,
    };
};

const getTableIdFromChange = (change: CopilotChange): string | undefined => {
    if (change.tableId) {
        return change.tableId;
    }
    if (getOperationCategory(change.operation) === "table") {
        return getChangeEntityId(change);
    }
    return undefined;
};

const buildUndoEditsForChange = (
    change: CopilotChange,
    currentSchema: SchemaDesigner.Schema,
): SchemaDesigner.SchemaDesignerEdit[] | undefined => {
    const tableId = getTableIdFromChange(change);
    const beforeTable = change.before as SchemaDesigner.Table | undefined;
    const afterTable = change.after as SchemaDesigner.Table | undefined;
    const beforeColumn = change.before as SchemaDesigner.Column | undefined;
    const afterColumn = change.after as SchemaDesigner.Column | undefined;
    const beforeForeignKey = change.before as SchemaDesigner.ForeignKey | undefined;
    const afterForeignKey = change.after as SchemaDesigner.ForeignKey | undefined;

    switch (change.operation) {
        case CopilotOperation.AddTable: {
            const table = findTableById(currentSchema, tableId ?? afterTable?.id);
            if (!table) {
                return undefined;
            }
            return [{ op: "drop_table", table: buildTableRef(table) }];
        }
        case CopilotOperation.DropTable:
            return undefined;
        case CopilotOperation.SetTable: {
            const table = findTableById(
                currentSchema,
                tableId ?? afterTable?.id ?? beforeTable?.id,
            );
            if (!table || !beforeTable) {
                return undefined;
            }
            return [
                {
                    op: "set_table",
                    table: buildTableRef(table),
                    set: {
                        name: beforeTable.name,
                        schema: beforeTable.schema,
                    },
                },
            ];
        }
        case CopilotOperation.AddColumn: {
            const table = findTableById(currentSchema, tableId);
            const columnId = afterColumn?.id;
            if (!table || !columnId) {
                return undefined;
            }
            const column = (table.columns ?? []).find((value) => value.id === columnId);
            if (!column) {
                return undefined;
            }
            return [
                {
                    op: "drop_column",
                    table: buildTableRef(table),
                    column: buildColumnRef(column),
                },
            ];
        }
        case CopilotOperation.DropColumn: {
            const table = findTableById(currentSchema, tableId);
            if (!table || !beforeColumn) {
                return undefined;
            }
            return [
                {
                    op: "add_column",
                    table: buildTableRef(table),
                    column: toColumnCreate(beforeColumn),
                },
            ];
        }
        case CopilotOperation.SetColumn: {
            const table = findTableById(currentSchema, tableId);
            const currentColumnId = afterColumn?.id ?? beforeColumn?.id;
            if (!table || !beforeColumn || !currentColumnId) {
                return undefined;
            }
            const currentColumn = (table.columns ?? []).find(
                (value) => value.id === currentColumnId,
            );
            if (!currentColumn) {
                return undefined;
            }
            return [
                {
                    op: "set_column",
                    table: buildTableRef(table),
                    column: buildColumnRef(currentColumn),
                    set: toColumnCreate(beforeColumn),
                },
            ];
        }
        case CopilotOperation.AddForeignKey: {
            const table = findTableById(currentSchema, tableId);
            const foreignKeyId = afterForeignKey?.id;
            if (!table || !foreignKeyId) {
                return undefined;
            }
            const foreignKey = (table.foreignKeys ?? []).find((value) => value.id === foreignKeyId);
            if (!foreignKey) {
                return undefined;
            }
            return [
                {
                    op: "drop_foreign_key",
                    table: buildTableRef(table),
                    foreignKey: buildForeignKeyRef(foreignKey),
                },
            ];
        }
        case CopilotOperation.DropForeignKey: {
            const table = findTableById(currentSchema, tableId);
            if (!table || !beforeForeignKey) {
                return undefined;
            }

            const foreignKeyCreate = toForeignKeyCreate(beforeForeignKey, currentSchema);
            if (!foreignKeyCreate) {
                return undefined;
            }

            return [
                {
                    op: "add_foreign_key",
                    table: buildTableRef(table),
                    foreignKey: foreignKeyCreate,
                },
            ];
        }
        case CopilotOperation.SetForeignKey: {
            const table = findTableById(currentSchema, tableId);
            const currentForeignKeyId = afterForeignKey?.id ?? beforeForeignKey?.id;
            if (!table || !beforeForeignKey || !currentForeignKeyId) {
                return undefined;
            }

            const currentForeignKey = (table.foreignKeys ?? []).find(
                (value) => value.id === currentForeignKeyId,
            );
            if (!currentForeignKey) {
                return undefined;
            }

            const mappings = toForeignKeyMappings(beforeForeignKey);
            if (mappings.length === 0) {
                return undefined;
            }

            const referencedTableInSchema = findTableByName(
                currentSchema,
                beforeForeignKey.referencedSchemaName,
                beforeForeignKey.referencedTableName,
            );
            const referencedTable: SchemaDesigner.TableRef = referencedTableInSchema
                ? buildTableRef(referencedTableInSchema)
                : {
                      schema: beforeForeignKey.referencedSchemaName,
                      name: beforeForeignKey.referencedTableName,
                  };

            return [
                {
                    op: "set_foreign_key",
                    table: buildTableRef(table),
                    foreignKey: buildForeignKeyRef(currentForeignKey),
                    set: {
                        name: beforeForeignKey.name,
                        onDeleteAction: beforeForeignKey.onDeleteAction,
                        onUpdateAction: beforeForeignKey.onUpdateAction,
                        referencedTable,
                        mappings,
                    },
                },
            ];
        }
    }
};

const getUndoRequestForIndexes = (
    trackedChanges: CopilotChange[],
    indexes: number[],
    currentSchema: SchemaDesigner.Schema,
): SchemaDesigner.ApplyEditsWebviewParams | undefined => {
    if (indexes.length === 0) {
        return undefined;
    }

    const edits: SchemaDesigner.SchemaDesignerEdit[] = [];
    const descendingIndexes = [...indexes].sort((a, b) => b - a);
    for (const index of descendingIndexes) {
        const change = trackedChanges[index];
        if (!change) {
            return undefined;
        }
        const undoEdits = buildUndoEditsForChange(change, currentSchema);
        if (!undoEdits || undoEdits.length === 0) {
            return undefined;
        }
        edits.push(...undoEdits);
    }

    if (edits.length === 0) {
        return undefined;
    }

    return { edits };
};

const removeChangesByIndexGroup = (changes: CopilotChange[], index: number): CopilotChange[] => {
    const indexes = getGroupedIndexes(changes, index);
    if (indexes.length === 0) {
        return changes;
    }
    const removeSet = new Set(indexes);
    return changes.filter((_, currentIndex) => !removeSet.has(currentIndex));
};

export const CopilotChangesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const schemaDesignerContext = useContext(SchemaDesignerContext);
    const [trackedChanges, setTrackedChanges] = useState<CopilotChange[]>([]);
    const copilotBatchCounterRef = useRef(0);

    const buildApplyEditsHandler = useCallback(
        () =>
            createSchemaDesignerApplyEditsHandler({
                isInitialized: schemaDesignerContext.isInitialized,
                extensionRpc: schemaDesignerContext.extensionRpc,
                schemaNames: schemaDesignerContext.schemaNames,
                datatypes: schemaDesignerContext.datatypes,
                waitForNextFrame,
                extractSchema: schemaDesignerContext.extractSchema,
                onMaybeAutoArrange: schemaDesignerContext.maybeAutoArrangeForToolBatch,
                addTable: schemaDesignerContext.addTable,
                updateTable: schemaDesignerContext.updateTable,
                deleteTable: schemaDesignerContext.deleteTable,
                normalizeColumn,
                normalizeTable,
                validateTable,
                onPushUndoState: schemaDesignerContext.onPushUndoState,
                onRequestScriptRefresh: schemaDesignerContext.notifySchemaChanged,
            }),
        [
            schemaDesignerContext.addTable,
            schemaDesignerContext.datatypes,
            schemaDesignerContext.deleteTable,
            schemaDesignerContext.extensionRpc,
            schemaDesignerContext.extractSchema,
            schemaDesignerContext.isInitialized,
            schemaDesignerContext.maybeAutoArrangeForToolBatch,
            schemaDesignerContext.notifySchemaChanged,
            schemaDesignerContext.onPushUndoState,
            schemaDesignerContext.schemaNames,
            schemaDesignerContext.updateTable,
        ],
    );

    const applyEdits = useCallback(
        async (
            request: SchemaDesigner.ApplyEditsWebviewParams,
            trackChanges: boolean,
        ): Promise<SchemaDesigner.ApplyEditsWebviewResponse> => {
            const applyEditsHandler = buildApplyEditsHandler();
            const preSchema = cloneValue(schemaDesignerContext.extractSchema());
            const response = await applyEditsHandler(request);
            const postSchema = response.schema ?? schemaDesignerContext.extractSchema();

            if (trackChanges) {
                const currentBatch = buildCopilotBatchFromAppliedEdits(
                    request,
                    response,
                    preSchema,
                    postSchema,
                );

                if (currentBatch.length > 0) {
                    const groupId = `copilot-${++copilotBatchCounterRef.current}`;
                    const groupedBatch = currentBatch.map((change) => ({
                        ...change,
                        groupId,
                    }));
                    setTrackedChanges((currentTrackedChanges) =>
                        processCopilotChanges(groupedBatch, currentTrackedChanges, postSchema),
                    );
                }
            }

            return response;
        },
        [buildApplyEditsHandler, schemaDesignerContext.extractSchema],
    );

    useEffect(() => {
        schemaDesignerContext.extensionRpc.onRequest(
            SchemaDesigner.ApplyEditsWebviewRequest.type,
            async (request: SchemaDesigner.ApplyEditsWebviewParams) => applyEdits(request, true),
        );
    }, [applyEdits, schemaDesignerContext.extensionRpc]);

    useEffect(() => {
        const currentSchema = schemaDesignerContext.extractSchema();
        setTrackedChanges((currentTrackedChanges) => {
            const reconciled = reconcileTrackedChangesWithSchema(
                currentTrackedChanges,
                currentSchema,
            );
            if (
                reconciled.length === currentTrackedChanges.length &&
                reconciled.every((change, index) => change === currentTrackedChanges[index])
            ) {
                return currentTrackedChanges;
            }
            return reconciled;
        });
    }, [schemaDesignerContext.extractSchema, schemaDesignerContext.schemaRevision]);

    const dismissTrackedChange = useCallback((index: number) => {
        setTrackedChanges((currentTrackedChanges) =>
            removeChangesByIndexGroup(currentTrackedChanges, index),
        );
    }, []);

    const acceptTrackedChange = useCallback((index: number) => {
        setTrackedChanges((currentTrackedChanges) =>
            removeChangesByIndexGroup(currentTrackedChanges, index),
        );
    }, []);

    const canUndoTrackedChange = useCallback(
        (index: number): boolean => {
            if (index < 0 || index >= trackedChanges.length) {
                return false;
            }

            const currentSchema = schemaDesignerContext.extractSchema();
            const indexes = getGroupedIndexes(trackedChanges, index);
            const undoRequest = getUndoRequestForIndexes(trackedChanges, indexes, currentSchema);
            return Boolean(undoRequest);
        },
        [schemaDesignerContext, trackedChanges],
    );

    const undoTrackedChange = useCallback(
        async (index: number): Promise<boolean> => {
            if (index < 0 || index >= trackedChanges.length) {
                return false;
            }

            const currentSchema = schemaDesignerContext.extractSchema();
            const indexes = getGroupedIndexes(trackedChanges, index);
            const undoRequest = getUndoRequestForIndexes(trackedChanges, indexes, currentSchema);
            if (!undoRequest) {
                return false;
            }

            const groupSignatures = indexes.map((changeIndex) =>
                getChangeSignature(trackedChanges[changeIndex]),
            );
            const groupId = trackedChanges[index]?.groupId;
            const response = await applyEdits(undoRequest, false);
            const appliedEdits =
                response.appliedEdits ?? (response.success ? undoRequest.edits.length : 0);
            const undoSucceeded = response.success && appliedEdits >= undoRequest.edits.length;
            if (!undoSucceeded) {
                return false;
            }

            if (groupId) {
                setTrackedChanges((currentTrackedChanges) =>
                    currentTrackedChanges.filter((change) => change.groupId !== groupId),
                );
                return true;
            }

            const pending = [...groupSignatures];
            setTrackedChanges((currentTrackedChanges) =>
                currentTrackedChanges.filter((change) => {
                    const signature = getChangeSignature(change);
                    const pendingIndex = pending.indexOf(signature);
                    if (pendingIndex === -1) {
                        return true;
                    }
                    pending.splice(pendingIndex, 1);
                    return false;
                }),
            );

            return true;
        },
        [applyEdits, schemaDesignerContext, trackedChanges],
    );

    const revealTrackedChange = useCallback(
        (index: number) => {
            if (index < 0 || index >= trackedChanges.length) {
                return;
            }

            // Clear existing selections first
            schemaDesignerContext.updateSelectedNodes([]);
            eventBus.emit("clearEdgeSelection");

            const change = trackedChanges[index];
            const category = getOperationCategory(change.operation);

            // For foreign key changes, reveal the FK edge
            if (category === "foreignKey") {
                const entityId = getChangeEntityId(change);
                if (entityId) {
                    eventBus.emit("revealForeignKeyEdges", entityId);
                    return;
                }
            }

            // For table/column changes, highlight and center on the specific table
            const tableId = getTableIdFromChange(change);
            if (tableId) {
                schemaDesignerContext.updateSelectedNodes([tableId]);
                schemaDesignerContext.setCenter(tableId, true);
            }
        },
        [schemaDesignerContext, trackedChanges],
    );

    const clearTrackedChanges = useCallback(() => {
        setTrackedChanges([]);
    }, []);

    const value = useMemo(
        () => ({
            trackedChanges,
            dismissTrackedChange,
            acceptTrackedChange,
            undoTrackedChange,
            canUndoTrackedChange,
            revealTrackedChange,
            clearTrackedChanges,
        }),
        [
            acceptTrackedChange,
            canUndoTrackedChange,
            clearTrackedChanges,
            dismissTrackedChange,
            revealTrackedChange,
            trackedChanges,
            undoTrackedChange,
        ],
    );

    return (
        <CopilotChangesContext.Provider value={value}>{children}</CopilotChangesContext.Provider>
    );
};

export const useCopilotChangesContext = (): CopilotChangesContextProps => {
    const context = useContext(CopilotChangesContext);
    if (!context) {
        throw new Error("useCopilotChangesContext must be used within CopilotChangesProvider");
    }
    return context;
};
