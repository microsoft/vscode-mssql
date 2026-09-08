/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * State and reducers shared between the table editor webview and its controller.
 *
 * The webview holds one page of rows and the edits staged against them. It never builds SQL and
 * never addresses a row by position: every row carries the key values that identify it, which is
 * what lets the same row be saved correctly after the page beneath it has changed.
 */

export type EditorKind =
    | "scalar"
    | "multiline"
    | "json"
    | "xml"
    | "binary"
    | "spatial"
    | "vector"
    | "boolean"
    | "date"
    | "readOnly";

export interface TableEditorColumn {
    name: string;
    typeName: string;
    declaredTypeName?: string;
    declaredTypeSchema?: string;
    maxLength?: number;
    precision?: number;
    scale?: number;
    isNullable: boolean;
    hasDefault: boolean;
    isWritable: boolean;
    isIdentity: boolean;
    isComputed: boolean;
    editorKind: EditorKind;
    /** True when the value can exceed the wire cell bound and so may arrive clipped. */
    isLargeValue: boolean;
    readOnlyReason?: string;
}

/** Key values identifying one row, as the engine's cursor. */
export type RowKey = Record<string, string | null>;

export interface TableEditorRow {
    /** Stable within this panel, so an edit can name the row a user is looking at. */
    id: number;
    values: Record<string, string | null>;
    key: RowKey;
    /** True when at least one cell arrived clipped and must be fetched before editing. */
    hasTruncatedCells: boolean;
    /** Column names whose displayed value is only a prefix of the stored value. */
    incompleteColumns: string[];
    /** Set for rows added in this session and not yet saved. */
    isNew?: boolean;
}

export type StagedKind = "insert" | "update" | "delete";

export interface StagedRowEdit {
    rowId: number;
    kind: StagedKind;
    /** Changed columns only, for an update. */
    values: Record<string, string | null>;
    /** Columns explicitly assigned DEFAULT instead of a client value. */
    defaultColumns?: string[];
}

export interface TableEditorPasteCell {
    rowId: number;
    column: string;
    value: string | null;
}

export function parseTableEditorPasteValue(
    rawValue: string,
    column: Pick<TableEditorColumn, "editorKind" | "isNullable">,
): string | null | undefined {
    if (rawValue === "NULL" && column.isNullable) {
        return null;
    }
    if (column.editorKind !== "boolean") {
        return rawValue;
    }
    const booleanValue = rawValue.trim().toLowerCase();
    return booleanValue === "true" || booleanValue === "false" ? booleanValue : undefined;
}

export type SubmittedTableValue = string | null | { readonly $t: "default" };

export interface SubmittedTableEdit {
    rowId: number;
    kind: StagedKind;
    original?: Record<string, SubmittedTableValue>;
    values: Record<string, SubmittedTableValue>;
}

export interface SubmittedTableEditSnapshot {
    operationId: string;
    revision: number;
    edits: SubmittedTableEdit[];
}

export type TableEditorReconciliationStatus =
    | "notProven"
    | "observedMatching"
    | "observedDifferent"
    | "notFound"
    | "unavailable";

export interface TableEditorReconciliation {
    rowId: number;
    kind: StagedKind;
    status: TableEditorReconciliationStatus;
    detail: string;
    serverKey?: RowKey;
    serverValues?: Record<string, string | null>;
    incompleteColumns?: string[];
}

export interface TableEditorConflict {
    rowId: number;
    kind: "update" | "delete";
    serverState: "available" | "missing" | "unavailable";
    message: string;
    original: Record<string, SubmittedTableValue>;
    proposed: Record<string, SubmittedTableValue>;
    serverValues?: Record<string, string | null>;
    serverIncompleteColumns?: string[];
}

export type FilterOperator =
    | "equals"
    | "notEquals"
    | "greaterThan"
    | "greaterThanOrEqual"
    | "lessThan"
    | "lessThanOrEqual"
    | "contains"
    | "notContains"
    | "startsWith"
    | "endsWith"
    | "isNull"
    | "isNotNull";

export interface ColumnFilter {
    column: string;
    operator: FilterOperator;
    value?: string;
}

export interface SortColumn {
    column: string;
    descending?: boolean;
}

/** How rows are identified, shown before anyone types rather than discovered on save. */
export interface KeyStrategySummary {
    kind: "primaryKey" | "uniqueIndex" | "allColumns" | "none";
    columns: string[];
    isAmbiguous: boolean;
    canEdit: boolean;
    explanation: string;
}

export type SaveState =
    | "clean"
    | "pending"
    | "invalid"
    | "saving"
    | "saved"
    | "failed"
    | "conflict"
    | "unknown"
    | "savedReloadFailed"
    | "savedReconciliationFailed";

export interface TableEditorIssue {
    rowId?: number;
    column?: string;
    message: string;
}

export interface TableEditorState {
    serverName: string;
    databaseName: string;
    schemaName: string;
    tableName: string;

    isLoading: boolean;
    /** Set when the table could not be opened at all. */
    loadError?: string;

    columns: TableEditorColumn[];
    rows: TableEditorRow[];
    key?: KeyStrategySummary;

    /** Rows with unsaved changes, by row id. */
    staged: Record<number, StagedRowEdit>;
    /** Cloned draft rows, including rows currently outside the visible page. */
    draftRows: TableEditorRow[];
    canUndo: boolean;
    canRedo: boolean;
    saveState: SaveState;
    /** Monotonic client revision for the current draft set. */
    draftRevision: number;
    /** The immutable revision submitted by the most recent save operation. */
    submittedRevision?: number;
    /** Stable identifier for the most recent save attempt. */
    saveOperationId?: string;
    /** Immutable payload retained while a save is being reconciled or explained. */
    submittedSnapshot?: SubmittedTableEditSnapshot;
    /** Per-row evidence collected after an outcome-unknown save. */
    reconciliation?: TableEditorReconciliation[];
    /** Original/server/proposed values for a known optimistic-concurrency conflict. */
    conflicts?: TableEditorConflict[];
    /** All locally known validation or execution issues for the current drafts. */
    issues: TableEditorIssue[];
    /** Set when a save failed; names the row so the grid can point at it. */
    saveError?: string;
    failedRowId?: number;

    filters: ColumnFilter[];
    sort: SortColumn[];
    pageSize: number;
    /** True when another page follows this one. */
    hasNextPage: boolean;
    /** How many pages back the user can go. */
    pageIndex: number;
    /** Total matching rows, when it has been counted. */
    totalRows?: number;

    /** The script that would run for the staged edits, identical to what saving executes. */
    script?: string;
    showScript: boolean;

    /** The cell open in the document editor, if any. */
    openCell?: {
        rowId: number;
        column: string;
        value: string | null;
        status: "loading" | "ready" | "error";
        error?: string;
    };
}

export interface TableEditorReducers {
    refresh: Record<string, never>;
    nextPage: Record<string, never>;
    previousPage: Record<string, never>;
    setPageSize: { pageSize: number };
    setFilters: { filters: ColumnFilter[] };
    setSort: { sort: SortColumn[] };

    /** Stages a cell change without touching the server. */
    editCell: { rowId: number; column: string; value: string | null };
    setCellDefault: { rowId: number; column: string };
    revertCell: { rowId: number; column: string };
    addRow: Record<string, never>;
    /** Explicitly stages an untouched new row as an INSERT DEFAULT VALUES operation. */
    insertUsingDefaults: { rowId: number };
    deleteRow: { rowId: number };
    revertRow: { rowId: number };
    discardAll: Record<string, never>;
    undo: Record<string, never>;
    redo: Record<string, never>;
    applyPaste: { cells: TableEditorPasteCell[] };

    save: Record<string, never>;
    toggleScript: Record<string, never>;

    /** Fetches a large value in full so it can be edited without truncation. */
    openCell: { rowId: number; column: string };
    closeCell: Record<string, never>;
    countRows: Record<string, never>;
    /** Re-reads the server after a save whose outcome was not acknowledged. */
    reconcile: Record<string, never>;
    /** Explicitly accepts an acknowledged save whose follow-up verification remains incomplete. */
    acceptReconciliation: Record<string, never>;
    /** Drops the local proposal and keeps the server row or deletion. */
    keepServer: { rowId: number };
    /** Rebuilds the proposal against the freshly read server baseline. */
    reapplyConflict: { rowId: number };
}

/** True when the row has staged changes of any kind. */
export function isRowDirty(state: TableEditorState, rowId: number): boolean {
    return state.staged[rowId] !== undefined;
}

export function stagedCount(state: TableEditorState): number {
    return Object.keys(state.staged).length;
}

/** The value to display for a cell, preferring a staged edit over what the server sent. */
export function displayValue(
    state: TableEditorState,
    row: TableEditorRow,
    column: string,
): string | null {
    const staged = state.staged[row.id];
    if (staged && column in staged.values) {
        return staged.values[column];
    }
    return row.values[column] ?? null;
}

export function isCellDirty(state: TableEditorState, rowId: number, column: string): boolean {
    const staged = state.staged[rowId];
    return staged !== undefined && staged.kind !== "delete" && column in staged.values;
}

/** Operators that take no value, so the UI can hide the value box. */
export function operatorTakesValue(operator: FilterOperator): boolean {
    return operator !== "isNull" && operator !== "isNotNull";
}

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
    equals: "equals",
    notEquals: "does not equal",
    greaterThan: "is greater than",
    greaterThanOrEqual: "is at least",
    lessThan: "is less than",
    lessThanOrEqual: "is at most",
    contains: "contains",
    notContains: "does not contain",
    startsWith: "starts with",
    endsWith: "ends with",
    isNull: "is empty",
    isNotNull: "is not empty",
};

/** Editors that need more room than a grid cell. */
export function needsDocumentEditor(kind: EditorKind): boolean {
    return kind === "xml" || kind === "json" || kind === "vector" || kind === "multiline";
}
