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
    createSchemaDesignerIndex,
    getColumnById,
    getTableById,
    normalizeColumn,
    normalizeTable,
    validateTable,
    waitForNextFrame,
} from "../../model";
import {
    CopilotChange,
    CopilotOperation,
    processCopilotChanges,
    reconcileTrackedChangesWithSchema,
    removeTrackedChangesForEditedEntities,
} from "./copilotLedger";
import type { HighlightOverride } from "../changes/useSchemaDesignerChangeState";
import type { ModifiedColumnHighlight, ModifiedTableHighlight } from "../../diff/diffHighlights";
import type { SchemaChange } from "../../diff/diffUtils";
import { locConstants } from "../../../../common/locConstants";
import {
    SchemaDesignerDefinitionPanelTab,
    useSchemaDesignerDefinitionPanelContext,
} from "../schemaDesignerDefinitionPanelContext";

export interface CopilotChangesContextProps {
    trackedChanges: CopilotChange[];
    dismissTrackedChange: (index: number) => void;
    acceptTrackedChange: (index: number) => void;
    undoTrackedChange: (index: number) => Promise<boolean>;
    canUndoTrackedChange: (index: number) => boolean;
    revealTrackedChange: (index: number) => void;
    clearTrackedChanges: () => void;
    /** Accept all tracked changes (removes them from the list without undoing) */
    acceptAllTrackedChanges: () => void;
    /** Undo all tracked changes that can be undone, then clear the rest */
    undoAllTrackedChanges: () => Promise<void>;
    /** Whether an undo-all operation is currently in progress */
    isUndoingAll: boolean;
    /** Highlight override containing copilot-specific highlight sets for the graph */
    copilotHighlightOverride: HighlightOverride;
    /** Current review index (maps to the reversed/ordered list, most recent first) */
    reviewIndex: number;
    /** Set the current review index */
    setReviewIndex: (index: number) => void;
    /** Navigate to the next change in the review */
    reviewNext: () => void;
    /** Navigate to the previous change in the review */
    reviewPrev: () => void;
    /** Get the summary text for a tracked change at the given source index */
    getChangeSummaryText: (sourceIndex: number) => string;
}

const CopilotChangesContext = createContext<CopilotChangesContextProps | undefined>(undefined);

type CopilotAction = "add" | "delete" | "modify";
type CopilotEntity = "table" | "column" | "foreignKey";

/** Map a CopilotOperation to its action + entity kind. */
const getOperationMeta = (
    operation: CopilotOperation,
): { action: CopilotAction; entity: CopilotEntity } => {
    switch (operation) {
        case CopilotOperation.AddTable:
            return { action: "add", entity: "table" };
        case CopilotOperation.DropTable:
            return { action: "delete", entity: "table" };
        case CopilotOperation.SetTable:
            return { action: "modify", entity: "table" };
        case CopilotOperation.AddColumn:
            return { action: "add", entity: "column" };
        case CopilotOperation.DropColumn:
            return { action: "delete", entity: "column" };
        case CopilotOperation.SetColumn:
            return { action: "modify", entity: "column" };
        case CopilotOperation.AddForeignKey:
            return { action: "add", entity: "foreignKey" };
        case CopilotOperation.DropForeignKey:
            return { action: "delete", entity: "foreignKey" };
        case CopilotOperation.SetForeignKey:
            return { action: "modify", entity: "foreignKey" };
    }
};

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
    sourceTableId: string,
    schemaIndex: ReturnType<typeof createSchemaDesignerIndex>,
): SchemaDesigner.ForeignKeyMapping[] =>
    foreignKey.columnsIds
        .map((columnId, index) => {
            const referencedColumnId = foreignKey.referencedColumnsIds[index];
            if (!referencedColumnId) {
                return undefined;
            }

            const sourceColumn = getColumnById(schemaIndex, sourceTableId, columnId);
            const referencedColumn = getColumnById(
                schemaIndex,
                foreignKey.referencedTableId,
                referencedColumnId,
            );

            if (!sourceColumn || !referencedColumn) {
                return undefined;
            }

            return {
                column: sourceColumn.name,
                referencedColumn: referencedColumn.name,
            };
        })
        .filter((mapping): mapping is SchemaDesigner.ForeignKeyMapping => mapping !== undefined);

const toForeignKeyCreate = (
    foreignKey: SchemaDesigner.ForeignKey,
    sourceTableId: string,
    schemaIndex: ReturnType<typeof createSchemaDesignerIndex>,
): SchemaDesigner.ForeignKeyCreate | undefined => {
    const mappings = toForeignKeyMappings(foreignKey, sourceTableId, schemaIndex);
    if (mappings.length === 0) {
        return undefined;
    }

    const referencedTable = getTableById(schemaIndex, foreignKey.referencedTableId);
    if (!referencedTable) {
        return undefined;
    }

    return {
        name: foreignKey.name,
        referencedTable: buildTableRef(referencedTable),
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
    const currentSchemaIndex = createSchemaDesignerIndex(currentSchema);
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

            const foreignKeyCreate = toForeignKeyCreate(
                beforeForeignKey,
                table.id,
                currentSchemaIndex,
            );
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

            const mappings = toForeignKeyMappings(beforeForeignKey, table.id, currentSchemaIndex);
            if (mappings.length === 0) {
                return undefined;
            }

            const referencedTable = getTableById(
                currentSchemaIndex,
                beforeForeignKey.referencedTableId,
            );
            if (!referencedTable) {
                return undefined;
            }

            return [
                {
                    op: "set_foreign_key",
                    table: buildTableRef(table),
                    foreignKey: buildForeignKeyRef(currentForeignKey),
                    set: {
                        name: beforeForeignKey.name,
                        onDeleteAction: beforeForeignKey.onDeleteAction,
                        onUpdateAction: beforeForeignKey.onUpdateAction,
                        referencedTable: buildTableRef(referencedTable),
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
    const { toggleDefinitionPanel, definitionPaneRef, setActiveTab } =
        useSchemaDesignerDefinitionPanelContext();
    const [trackedChanges, setTrackedChanges] = useState<CopilotChange[]>([]);
    const copilotBatchCounterRef = useRef(0);

    // Review toolbar state — declared early so applyEdits can focus new batches
    const [reviewIndex, setReviewIndex] = useState(0);

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
                    setTrackedChanges((currentTrackedChanges) => {
                        const merged = processCopilotChanges(
                            groupedBatch,
                            currentTrackedChanges,
                            postSchema,
                        );

                        // Focus on the first item of the new batch
                        const firstNewIndex = merged.findIndex((c) => c.groupId === groupId);
                        if (firstNewIndex >= 0) {
                            setReviewIndex(firstNewIndex);
                        }

                        return merged;
                    });

                    // Open the Copilot Changes panel so the user sees the new batch
                    const panel = definitionPaneRef.current;
                    if (panel?.isCollapsed()) {
                        toggleDefinitionPanel(SchemaDesignerDefinitionPanelTab.CopilotChanges);
                    } else {
                        setActiveTab(SchemaDesignerDefinitionPanelTab.CopilotChanges);
                    }
                }
            }

            return response;
        },
        [
            buildApplyEditsHandler,
            schemaDesignerContext.extractSchema,
            definitionPaneRef,
            toggleDefinitionPanel,
            setActiveTab,
        ],
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

    // Auto-remove copilot-tracked changes when the user edits the same entities
    // through the editor drawer. The drawer emits "userEditedEntities" with the
    // set of entity IDs that were modified by the user.
    useEffect(() => {
        const handleUserEditedEntities = (editedEntityIds: Set<string>) => {
            setTrackedChanges((currentTrackedChanges) => {
                const updated = removeTrackedChangesForEditedEntities(
                    currentTrackedChanges,
                    editedEntityIds,
                );
                if (updated.length === currentTrackedChanges.length) {
                    return currentTrackedChanges; // No changes removed
                }
                return updated;
            });
        };

        eventBus.on("userEditedEntities", handleUserEditedEntities);
        return () => {
            eventBus.off("userEditedEntities", handleUserEditedEntities);
        };
    }, []);

    const dismissTrackedChange = useCallback((index: number) => {
        setTrackedChanges((currentTrackedChanges) =>
            removeChangesByIndexGroup(currentTrackedChanges, index),
        );
    }, []);

    const acceptTrackedChange = useCallback((index: number) => {
        setTrackedChanges((currentTrackedChanges) => {
            if (index < 0 || index >= currentTrackedChanges.length) {
                return currentTrackedChanges;
            }
            return currentTrackedChanges.filter((_, i) => i !== index);
        });
    }, []);

    const canUndoTrackedChange = useCallback(
        (index: number): boolean => {
            if (index < 0 || index >= trackedChanges.length) {
                return false;
            }

            const currentSchema = schemaDesignerContext.extractSchema();
            const undoRequest = getUndoRequestForIndexes(trackedChanges, [index], currentSchema);
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
            const undoRequest = getUndoRequestForIndexes(trackedChanges, [index], currentSchema);
            if (!undoRequest) {
                return false;
            }

            const response = await applyEdits(undoRequest, false);
            const appliedEdits =
                response.appliedEdits ?? (response.success ? undoRequest.edits.length : 0);
            const undoSucceeded = response.success && appliedEdits >= undoRequest.edits.length;
            if (!undoSucceeded) {
                return false;
            }

            setTrackedChanges((currentTrackedChanges) =>
                currentTrackedChanges.filter((_, i) => i !== index),
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

    /** Accept all tracked changes — removes them from the list without undoing. */
    const acceptAllTrackedChanges = useCallback(() => {
        setTrackedChanges([]);
    }, []);

    const [isUndoingAll, setIsUndoingAll] = useState(false);

    /**
     * Undo all tracked changes smartly:
     * 1. Process changes in reverse chronological order (newest first) so
     *    dependent entities (e.g. FKs referencing a newly-added table) are
     *    removed before the entities they depend on.
     * 2. Collect undo edits for every change that CAN be undone, skipping
     *    non-undoable ones (e.g. DropTable).
     * 3. Apply all collected edits in a single batch.
     * 4. Clear all tracked changes (including non-undoable ones).
     */
    const undoAllTrackedChanges = useCallback(async () => {
        if (trackedChanges.length === 0) {
            return;
        }

        setIsUndoingAll(true);
        try {
            const currentSchema = schemaDesignerContext.extractSchema();
            const edits: SchemaDesigner.SchemaDesignerEdit[] = [];

            // Walk changes newest → oldest so dependent entities are undone first
            for (let i = trackedChanges.length - 1; i >= 0; i--) {
                const change = trackedChanges[i];
                const undoEdits = buildUndoEditsForChange(change, currentSchema);
                if (undoEdits && undoEdits.length > 0) {
                    edits.push(...undoEdits);
                }
                // Non-undoable changes (e.g. DropTable) are silently skipped
            }

            if (edits.length === 0) {
                // If nothing in the current list can be undone, keep existing behavior
                // and clear non-undoable tracked entries.
                setTrackedChanges([]);
                return;
            }

            const response = await applyEdits({ edits }, false);
            const appliedEdits = response.appliedEdits ?? (response.success ? edits.length : 0);
            const undoSucceeded = response.success && appliedEdits >= edits.length;
            if (undoSucceeded) {
                setTrackedChanges([]);
            }
        } finally {
            setIsUndoingAll(false);
        }
    }, [applyEdits, schemaDesignerContext, trackedChanges]);

    /**
     * Compute copilot-specific highlight sets from trackedChanges.
     * Builds the same data structures consumed by graph components for
     * highlighting added/modified tables, columns, and foreign keys.
     * Also builds a lookup map from entity IDs → change indices for
     * accept/undo actions on the graph.
     */
    const copilotHighlightOverride = useMemo((): HighlightOverride => {
        const copilotNewTableIds = new Set<string>();
        const copilotNewColumnIds = new Set<string>();
        const copilotNewForeignKeyIds = new Set<string>();
        const copilotModifiedForeignKeyIds = new Set<string>();
        const copilotModifiedColumnHighlights = new Map<string, ModifiedColumnHighlight>();
        const copilotModifiedTableHighlights = new Map<string, ModifiedTableHighlight>();
        // Lookup: entity ID → change index (for accept/undo from graph)
        const entityToChangeIndex = new Map<string, number>();

        for (let i = 0; i < trackedChanges.length; i++) {
            const change = trackedChanges[i];
            const entityId = getChangeEntityId(change);
            if (!entityId) {
                continue;
            }

            entityToChangeIndex.set(entityId, i);
            const tableId = getTableIdFromChange(change);
            if (tableId) {
                entityToChangeIndex.set(`table:${tableId}`, i);
            }

            switch (change.operation) {
                case CopilotOperation.AddTable:
                    copilotNewTableIds.add(entityId);
                    break;
                case CopilotOperation.SetTable: {
                    const before = change.before as SchemaDesigner.Table | undefined;
                    const after = change.after as SchemaDesigner.Table | undefined;
                    if (before && after) {
                        const highlight: ModifiedTableHighlight = {};
                        if (before.name !== after.name) {
                            highlight.nameChange = {
                                oldValue: before.name,
                                newValue: after.name,
                            };
                        }
                        if (before.schema !== after.schema) {
                            highlight.schemaChange = {
                                oldValue: before.schema,
                                newValue: after.schema,
                            };
                        }
                        // Always highlight the table as modified, even when
                        // only non-name/schema properties changed.
                        copilotModifiedTableHighlights.set(entityId, highlight);
                    }
                    break;
                }
                case CopilotOperation.AddColumn:
                    copilotNewColumnIds.add(entityId);
                    break;
                case CopilotOperation.SetColumn: {
                    const before = change.before as SchemaDesigner.Column | undefined;
                    const after = change.after as SchemaDesigner.Column | undefined;
                    if (before && after) {
                        const highlight: ModifiedColumnHighlight = { hasOtherChanges: false };
                        if (before.name !== after.name) {
                            highlight.nameChange = {
                                oldValue: before.name,
                                newValue: after.name,
                            };
                        }
                        if (before.dataType !== after.dataType) {
                            highlight.dataTypeChange = {
                                oldValue: before.dataType,
                                newValue: after.dataType,
                            };
                        }
                        // Check for other property changes
                        const beforeRecord = before as unknown as Record<string, unknown>;
                        const afterRecord = after as unknown as Record<string, unknown>;
                        const checkProps = [
                            "isPrimaryKey",
                            "allowNull",
                            "defaultValue",
                            "length",
                            "precision",
                            "scale",
                            "isIdentity",
                        ];
                        for (const prop of checkProps) {
                            if (
                                JSON.stringify(beforeRecord[prop]) !==
                                JSON.stringify(afterRecord[prop])
                            ) {
                                highlight.hasOtherChanges = true;
                                break;
                            }
                        }
                        copilotModifiedColumnHighlights.set(entityId, highlight);
                    }
                    break;
                }
                case CopilotOperation.AddForeignKey:
                    copilotNewForeignKeyIds.add(entityId);
                    break;
                case CopilotOperation.SetForeignKey:
                    copilotModifiedForeignKeyIds.add(entityId);
                    break;
                default:
                    break;
            }
        }

        // Build accept/undo action handlers that map SchemaChange → copilot index
        const findChangeIndex = (change: SchemaChange): number | undefined => {
            // Try objectId first (column/FK), then tableId (table-level)
            if (change.objectId) {
                return entityToChangeIndex.get(change.objectId);
            }
            return entityToChangeIndex.get(`table:${change.tableId}`);
        };

        const overrideAcceptChange = (change: SchemaChange): void => {
            const idx = findChangeIndex(change);
            if (idx !== undefined) {
                acceptTrackedChange(idx);
            }
        };

        const overrideRevertChange = (change: SchemaChange): void => {
            const idx = findChangeIndex(change);
            if (idx !== undefined) {
                void undoTrackedChange(idx);
            }
        };

        const overrideCanRevertChange = (
            change: SchemaChange,
        ): { canRevert: boolean; reason?: string } => {
            const idx = findChangeIndex(change);
            if (idx === undefined) {
                return { canRevert: false, reason: "Change not found" };
            }
            return { canRevert: canUndoTrackedChange(idx) };
        };

        return {
            newTableIds: copilotNewTableIds,
            newColumnIds: copilotNewColumnIds,
            newForeignKeyIds: copilotNewForeignKeyIds,
            modifiedForeignKeyIds: copilotModifiedForeignKeyIds,
            modifiedColumnHighlights: copilotModifiedColumnHighlights,
            modifiedTableHighlights: copilotModifiedTableHighlights,
            deletedColumnsByTable: new Map(),
            deletedForeignKeyEdges: [],
            baselineColumnOrderByTable: new Map(),
            deletedTableNodes: [],
            acceptChange: overrideAcceptChange,
            revertChange: overrideRevertChange,
            canRevertChange: overrideCanRevertChange,
        };
    }, [trackedChanges, acceptTrackedChange, undoTrackedChange, canUndoTrackedChange]);

    // ── Review toolbar navigation ─────────────────────────────────────

    // Clamp reviewIndex when trackedChanges length changes
    useEffect(() => {
        setReviewIndex((current) =>
            trackedChanges.length === 0 ? 0 : Math.min(current, trackedChanges.length - 1),
        );
    }, [trackedChanges.length]);

    const reviewNext = useCallback(() => {
        if (trackedChanges.length === 0) {
            return;
        }
        setReviewIndex((current) => Math.min(current + 1, trackedChanges.length - 1));
    }, [trackedChanges.length]);

    const reviewPrev = useCallback(() => {
        setReviewIndex((current) => Math.max(current - 1, 0));
    }, []);

    /** Build a human-readable summary for a tracked change at the given source index. */
    const getChangeSummaryText = useCallback(
        (sourceIndex: number): string => {
            const change = trackedChanges[sourceIndex];
            if (!change) {
                return "";
            }

            const opMeta = getOperationMeta(change.operation);
            const actionText =
                opMeta.action === "add"
                    ? locConstants.schemaDesigner.changesPanel.added
                    : opMeta.action === "delete"
                      ? locConstants.schemaDesigner.changesPanel.deleted
                      : locConstants.schemaDesigner.changesPanel.modified;
            const entityText =
                opMeta.entity === "foreignKey"
                    ? locConstants.schemaDesigner.changesPanel.foreignKeyCategory
                    : opMeta.entity === "column"
                      ? locConstants.schemaDesigner.changesPanel.columnCategory
                      : locConstants.schemaDesigner.changesPanel.tableCategory;

            const obj = (change.after ?? change.before) as
                | SchemaDesigner.Table
                | SchemaDesigner.Column
                | SchemaDesigner.ForeignKey
                | undefined;

            let name = "Unknown";
            if (obj) {
                if (opMeta.entity === "table") {
                    const t = obj as SchemaDesigner.Table;
                    name = `[${t.schema}].[${t.name}]`;
                } else {
                    name = (obj as { name?: string }).name ?? "Unknown";
                }
            }

            return `${actionText} ${entityText}: ${name}`;
        },
        [trackedChanges],
    );

    const value = useMemo(
        () => ({
            trackedChanges,
            dismissTrackedChange,
            acceptTrackedChange,
            undoTrackedChange,
            canUndoTrackedChange,
            revealTrackedChange,
            clearTrackedChanges,
            acceptAllTrackedChanges,
            undoAllTrackedChanges,
            isUndoingAll,
            copilotHighlightOverride,
            reviewIndex,
            setReviewIndex,
            reviewNext,
            reviewPrev,
            getChangeSummaryText,
        }),
        [
            acceptAllTrackedChanges,
            acceptTrackedChange,
            canUndoTrackedChange,
            clearTrackedChanges,
            copilotHighlightOverride,
            dismissTrackedChange,
            getChangeSummaryText,
            isUndoingAll,
            revealTrackedChange,
            reviewIndex,
            reviewNext,
            reviewPrev,
            trackedChanges,
            undoAllTrackedChanges,
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
