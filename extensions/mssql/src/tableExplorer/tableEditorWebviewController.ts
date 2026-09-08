/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Table Explorer running on the data-plane editing engine.
 *
 * Chosen by the `TableEditor` private preview flag; with the flag off, Table Explorer opens the
 * SQL Tools Service edit session instead. The two are kept as separate controllers rather than
 * one with branches, because their models genuinely differ: the old one addresses a row by its
 * position in a materialised result set, this one by the row's own key.
 *
 * All SQL is built by the `sql-edit` package, which has no VS Code dependency and is unit
 * tested without a server. This file holds only panel state and the reducers behind it.
 */

import * as vscode from "vscode";

import {
    ColumnFilter as EngineFilter,
    SortColumn as EngineSort,
    EditCommitError,
    EditSession,
    DEFAULT_VALUE,
    type DefaultValue,
    PageCursor,
    SqlEditError,
    StagedEdit,
    isDefaultValue,
    type CommitObservation,
} from "sql-feature/edit";
import { SqlExecutionError } from "sql-feature/core";

import {
    ColumnFilter,
    RowKey,
    StagedRowEdit,
    TableEditorConflict,
    TableEditorReconciliation,
    SubmittedTableEdit,
    TableEditorColumn,
    TableEditorReducers,
    TableEditorRow,
    TableEditorState,
    TableEditorPasteCell,
} from "../sharedInterfaces/tableEditor";
import { WebviewPanelController } from "../controllers/webviewPanelController";
import { DataPlaneRunner } from "../sqlDiagnostics/dataPlaneRunner";
import { ISqlSession } from "../services/sqlDataPlane/api";
import { getErrorMessage } from "../utils/utils";
import { SqlFeatures } from "../constants/locConstants";

/** Rows fetched per page. Large enough to fill a screen, small enough to stay responsive. */
const DEFAULT_PAGE_SIZE = 200;

interface DraftHistorySnapshot {
    staged: Record<number, StagedRowEdit>;
    rows: TableEditorRow[];
    draftRows: [number, TableEditorRow][];
}

interface CommittedRowsResult {
    rows: TableEditorRow[];
    reconciliation: TableEditorReconciliation[];
}

export interface TableEditorOptions {
    readonly session: ISqlSession;
    readonly serverName: string;
    readonly databaseName: string;
    readonly schemaName: string;
    readonly tableName: string;
}

export class TableEditorWebviewController extends WebviewPanelController<
    TableEditorState,
    TableEditorReducers
> {
    private _editSession?: EditSession;
    private readonly _runner: DataPlaneRunner;
    /**
     * Key of the first row of each page already visited, so going back is a seek rather than a
     * re-count. Index 0 is the first page, which needs no cursor at all.
     */
    private _pageStarts: (PageCursor | undefined)[] = [undefined];
    private _nextRowId = 1;
    private _loadGeneration = 0;
    private _cellGeneration = 0;
    private _draftRevision = 0;
    private _nextSaveOperationId = 1;
    private readonly _draftRows = new Map<number, TableEditorRow>();
    private _rowIds = new Map<string, number>();
    private readonly _undoStack: DraftHistorySnapshot[] = [];
    private readonly _redoStack: DraftHistorySnapshot[] = [];

    constructor(
        context: vscode.ExtensionContext,
        private readonly _table: TableEditorOptions,
    ) {
        const qualified = `${_table.schemaName}.${_table.tableName}`;
        super(
            context,
            "tableEditor",
            "tableEditor",
            {
                serverName: _table.serverName,
                databaseName: _table.databaseName,
                schemaName: _table.schemaName,
                tableName: _table.tableName,
                isLoading: true,
                columns: [],
                rows: [],
                staged: {},
                draftRows: [],
                canUndo: false,
                canRedo: false,
                saveState: "clean",
                draftRevision: 0,
                issues: [],
                filters: [],
                sort: [],
                pageSize: DEFAULT_PAGE_SIZE,
                hasNextPage: false,
                pageIndex: 0,
                showScript: false,
            },
            {
                title: qualified,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "tableExplorerEditor_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "tableExplorerEditor_light.svg",
                    ),
                },
                showRestorePromptAfterClose: false,
            },
        );

        this._runner = new DataPlaneRunner(_table.session);
        this.registerReducers();
        void this.initialize();
    }

    // -----------------------------------------------------------------------
    // Opening
    // -----------------------------------------------------------------------

    private async initialize(): Promise<void> {
        try {
            const session = await EditSession.open(
                this._runner,
                this._table.schemaName,
                this._table.tableName,
            );
            this._editSession = session;

            const info = session.info;
            this.state.columns = info.columns.map(
                (c): TableEditorColumn => ({
                    name: c.name,
                    typeName: c.typeName,
                    ...(c.declaredTypeName ? { declaredTypeName: c.declaredTypeName } : {}),
                    ...(c.declaredTypeSchema ? { declaredTypeSchema: c.declaredTypeSchema } : {}),
                    ...(c.maxLength !== undefined ? { maxLength: c.maxLength } : {}),
                    ...(c.precision !== undefined ? { precision: c.precision } : {}),
                    ...(c.scale !== undefined ? { scale: c.scale } : {}),
                    isNullable: c.isNullable,
                    hasDefault: c.hasDefault,
                    isWritable: c.isWritable,
                    isIdentity: c.isIdentity,
                    isComputed: c.isComputed,
                    editorKind: c.editorKind,
                    isLargeValue: c.isLargeValue,
                    ...(c.readOnlyReason ? { readOnlyReason: c.readOnlyReason } : {}),
                }),
            );
            this.state.key = {
                kind: session.key.kind,
                columns: [...session.key.columns],
                isAmbiguous: session.key.isAmbiguous,
                canEdit: session.key.canEdit,
                explanation: session.key.explanation,
            };

            await this.loadPage(0);
        } catch (error) {
            this.state.isLoading = false;
            this.state.loadError = describe(error);
            this.updateState();
        }
    }

    // -----------------------------------------------------------------------
    // Reading
    // -----------------------------------------------------------------------

    /**
     * Loads one page.
     *
     * Pages are addressed by the key of their first row rather than by an offset, so a page is
     * the same set of rows whether or not someone inserted ahead of it.
     */
    private async loadPage(pageIndex: number): Promise<boolean> {
        const session = this._editSession;
        if (!session) {
            return false;
        }

        const generation = ++this._loadGeneration;
        this.state.isLoading = true;
        this.state.loadError = undefined;
        this.updateState();

        try {
            const cursor = this._pageStarts[pageIndex];
            const page = await session.readPage({
                pageSize: this.state.pageSize,
                filters: this.state.filters as EngineFilter[],
                sort: this.state.sort as EngineSort[],
                ...(cursor ? { cursor } : {}),
            });

            if (generation !== this._loadGeneration) return false;
            const retainedIds = new Map<string, number>();
            for (const [identity, id] of this._rowIds) {
                if (this._draftRows.has(id)) retainedIds.set(identity, id);
            }
            this.state.rows = page.rows.map((row) => {
                const identity = JSON.stringify(
                    session.key.columns.map((column) => [column, row.values[column]]),
                );
                const stable = session.key.canEdit && !session.key.isAmbiguous;
                const id = (stable ? this._rowIds.get(identity) : undefined) ?? this._nextRowId++;
                if (stable) retainedIds.set(identity, id);
                return (
                    this._draftRows.get(id) ?? {
                        id,
                        values: { ...row.values },
                        key: { ...row.cursor } as RowKey,
                        hasTruncatedCells: row.hasTruncatedCells,
                        incompleteColumns: [...row.incompleteColumns],
                    }
                );
            });
            this._rowIds = retainedIds;
            this.state.rows.push(...[...this._draftRows.values()].filter((row) => row.isNew));
            this.state.hasNextPage = page.nextCursor !== undefined;
            this.state.pageIndex = pageIndex;
            // Remember where the following page starts so paging forward is a seek.
            if (page.nextCursor) {
                this._pageStarts[pageIndex + 1] = page.nextCursor as PageCursor;
            }
            this.state.isLoading = false;
            this.updateState();
            return true;
        } catch (error) {
            if (generation !== this._loadGeneration) return false;
            this.state.isLoading = false;
            this.state.loadError = describe(error);
            this.updateState();
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // Staging
    // -----------------------------------------------------------------------

    /** Records a cell change locally. Nothing reaches the server until the user saves. */
    private stageCell(
        rowId: number,
        column: string,
        value: string | null,
        recordHistory = true,
    ): void {
        if (this.mutationsBlocked()) return;
        const cell = this.state.openCell;
        if (cell?.rowId === rowId && cell.column === column && cell.status !== "ready") return;
        const row = this.state.rows.find((r) => r.id === rowId);
        if (!row) {
            return;
        }
        const columnInfo = this.state.columns.find((c) => c.name === column);
        if (!columnInfo?.isWritable) {
            return;
        }
        if (
            row.incompleteColumns.includes(column) &&
            !(
                this.state.openCell?.rowId === rowId &&
                this.state.openCell.column === column &&
                this.state.openCell.status === "ready"
            )
        ) {
            return;
        }

        const existing = this.state.staged[rowId];
        if (existing?.kind === "delete") return;
        if (
            !row.isNew &&
            value === (row.values[column] ?? null) &&
            !(column in (existing?.values ?? {})) &&
            !existing?.defaultColumns?.includes(column)
        ) {
            return;
        }
        if (recordHistory) {
            this.recordDraftMutation();
        }
        if (!this._draftRows.has(rowId))
            this._draftRows.set(rowId, { ...row, values: { ...row.values }, key: { ...row.key } });
        const kind: StagedRowEdit["kind"] = existing?.kind ?? (row.isNew ? "insert" : "update");
        const values = { ...(existing?.values ?? {}) };
        const defaultColumns = new Set(existing?.defaultColumns ?? []);
        defaultColumns.delete(column);

        if (!row.isNew && value === (row.values[column] ?? null)) {
            // Typing a value back to what it was is not a change, so the row can go clean.
            delete values[column];
        } else {
            values[column] = value;
        }

        if (kind === "update" && Object.keys(values).length === 0 && defaultColumns.size === 0) {
            delete this.state.staged[rowId];
            this._draftRows.delete(rowId);
        } else {
            this.state.staged[rowId] = {
                rowId,
                kind,
                values,
                ...(defaultColumns.size > 0 ? { defaultColumns: [...defaultColumns] } : {}),
            };
        }
        this.markDraftChanged();
        this.refreshScript();
        this.updateState();
    }

    private applyPaste(cells: readonly TableEditorPasteCell[]): void {
        if (this.mutationsBlocked() || cells.length === 0) return;

        const seen = new Set<string>();
        for (const cell of cells) {
            const identity = `${cell.rowId}\u0000${cell.column}`;
            const row = this.state.rows.find((candidate) => candidate.id === cell.rowId);
            const column = this.state.columns.find((candidate) => candidate.name === cell.column);
            if (
                seen.has(identity) ||
                !row ||
                !column?.isWritable ||
                row.incompleteColumns.includes(cell.column) ||
                this.state.staged[cell.rowId]?.kind === "delete"
            ) {
                return;
            }
            seen.add(identity);
        }

        this.recordDraftMutation();
        for (const cell of cells) {
            this.stageCell(cell.rowId, cell.column, cell.value, false);
        }
    }

    private setCellDefault(rowId: number, column: string): void {
        if (this.mutationsBlocked()) return;
        const row = this.state.rows.find((candidate) => candidate.id === rowId);
        const columnInfo = this.state.columns.find((candidate) => candidate.name === column);
        if (
            !row ||
            !columnInfo?.isWritable ||
            !columnInfo.hasDefault ||
            row.incompleteColumns.includes(column)
        )
            return;

        const existing = this.state.staged[rowId];
        if (existing?.kind === "delete") return;
        if (existing?.defaultColumns?.includes(column)) return;
        this.recordDraftMutation();
        if (!this._draftRows.has(rowId)) {
            this._draftRows.set(rowId, {
                ...row,
                values: { ...row.values },
                key: { ...row.key },
            });
        }

        const kind: StagedRowEdit["kind"] = existing?.kind ?? (row.isNew ? "insert" : "update");
        const values = { ...(existing?.values ?? {}) };
        delete values[column];
        const defaultColumns = new Set(existing?.defaultColumns ?? []);
        defaultColumns.add(column);
        this.state.staged[rowId] = {
            rowId,
            kind,
            values,
            defaultColumns: [...defaultColumns],
        };
        this.markDraftChanged();
        this.refreshScript();
        this.updateState();
    }

    private revertCell(rowId: number, column: string): void {
        if (this.mutationsBlocked()) return;
        const row = this.state.rows.find((candidate) => candidate.id === rowId);
        const columnInfo = this.state.columns.find((candidate) => candidate.name === column);
        const existing = this.state.staged[rowId];
        if (
            !row ||
            !columnInfo?.isWritable ||
            row.incompleteColumns.includes(column) ||
            !existing ||
            existing.kind === "delete"
        )
            return;
        if (!(column in existing.values) && !existing.defaultColumns?.includes(column)) return;

        this.recordDraftMutation();

        const values = { ...existing.values };
        delete values[column];
        const defaultColumns = new Set(existing.defaultColumns ?? []);
        defaultColumns.delete(column);
        if (Object.keys(values).length === 0 && defaultColumns.size === 0) {
            delete this.state.staged[rowId];
            if (!row.isNew) {
                this._draftRows.delete(rowId);
            }
        } else {
            this.state.staged[rowId] = {
                rowId,
                kind: existing.kind,
                values,
                ...(defaultColumns.size > 0 ? { defaultColumns: [...defaultColumns] } : {}),
            };
        }
        this.state.failedRowId = undefined;
        this.markDraftChanged();
        this.refreshScript();
        this.updateState();
    }

    private addRow(): void {
        if (this.mutationsBlocked()) return;
        if (this.state.rows.some((row) => row.isNew && this.state.staged[row.id] === undefined)) {
            return;
        }
        this.recordDraftMutation();
        const row: TableEditorRow = {
            id: this._nextRowId++,
            values: Object.fromEntries(this.state.columns.map((c) => [c.name, null])),
            key: {},
            hasTruncatedCells: false,
            incompleteColumns: [],
            isNew: true,
        };
        this._draftRows.set(row.id, row);
        this.state.rows = [...this.state.rows, row];
        this.markDraftChanged();
        this.refreshScript();
        this.updateState();
    }

    private insertUsingDefaults(rowId: number): void {
        if (this.mutationsBlocked()) return;
        const row = this.state.rows.find((candidate) => candidate.id === rowId);
        if (!row?.isNew || this.state.staged[rowId]?.kind === "insert") return;
        this.recordDraftMutation();
        this.state.staged[rowId] = { rowId, kind: "insert", values: {} };
        this.markDraftChanged();
        this.refreshScript();
        this.updateState();
    }

    private deleteRow(rowId: number): void {
        if (this.mutationsBlocked()) return;
        const row = this.state.rows.find((r) => r.id === rowId);
        if (!row) {
            return;
        }
        this.recordDraftMutation();
        if (row.isNew) {
            // An unsaved row is discarded outright: there is nothing on the server to delete.
            this.state.rows = this.state.rows.filter((r) => r.id !== rowId);
            delete this.state.staged[rowId];
            this._draftRows.delete(rowId);
        } else {
            if (!this._draftRows.has(rowId))
                this._draftRows.set(rowId, {
                    ...row,
                    values: { ...row.values },
                    key: { ...row.key },
                });
            this.state.staged[rowId] = { rowId, kind: "delete", values: {} };
        }
        this.markDraftChanged();
        this.refreshScript();
        this.updateState();
    }

    private revertRow(rowId: number): void {
        if (this.mutationsBlocked()) return;
        const row = this.state.rows.find((r) => r.id === rowId);
        if (!row || (!row.isNew && !this.state.staged[rowId])) return;
        this.recordDraftMutation();
        if (row?.isNew) {
            this.state.rows = this.state.rows.filter((r) => r.id !== rowId);
        }
        delete this.state.staged[rowId];
        this._draftRows.delete(rowId);
        this.state.failedRowId = undefined;
        this.markDraftChanged();
        this.refreshScript();
        this.updateState();
    }

    private discardAll(): void {
        if (
            this.mutationsBlocked() ||
            (Object.keys(this.state.staged).length === 0 &&
                !this.state.rows.some((row) => row.isNew))
        )
            return;
        this.recordDraftMutation();
        this.state.rows = this.state.rows.filter((r) => !r.isNew);
        this.state.staged = {};
        this._draftRows.clear();
        this.state.saveError = undefined;
        this.state.failedRowId = undefined;
        this.state.issues = [];
        this.state.saveState = "clean";
        this.markDraftChanged();
        this.refreshScript();
        this.updateState();
    }

    private undo(): void {
        if (this.mutationsBlocked()) return;
        const snapshot = this._undoStack.pop();
        if (!snapshot) return;
        this._redoStack.push(this.captureDraft());
        this.restoreDraft(snapshot);
    }

    private redo(): void {
        if (this.mutationsBlocked()) return;
        const snapshot = this._redoStack.pop();
        if (!snapshot) return;
        this._undoStack.push(this.captureDraft());
        this.restoreDraft(snapshot);
    }

    private captureDraft(): DraftHistorySnapshot {
        return {
            staged: Object.fromEntries(
                Object.entries(this.state.staged).map(([rowId, edit]) => [
                    rowId,
                    {
                        ...edit,
                        values: { ...edit.values },
                        ...(edit.defaultColumns
                            ? { defaultColumns: [...edit.defaultColumns] }
                            : {}),
                    },
                ]),
            ),
            rows: this.state.rows.map(cloneRow),
            draftRows: [...this._draftRows.entries()].map(([rowId, row]) => [rowId, cloneRow(row)]),
        };
    }

    private restoreDraft(snapshot: DraftHistorySnapshot): void {
        this.state.staged = Object.fromEntries(
            Object.entries(snapshot.staged).map(([rowId, edit]) => [
                rowId,
                {
                    ...edit,
                    values: { ...edit.values },
                    ...(edit.defaultColumns ? { defaultColumns: [...edit.defaultColumns] } : {}),
                },
            ]),
        );
        this.state.rows = snapshot.rows.map(cloneRow);
        this._draftRows.clear();
        for (const [rowId, row] of snapshot.draftRows) {
            this._draftRows.set(rowId, cloneRow(row));
        }
        this.state.failedRowId = undefined;
        this.state.conflicts = undefined;
        this.state.reconciliation = undefined;
        this.markDraftChanged();
        this.refreshScript();
        this.updateState();
    }

    private recordDraftMutation(): void {
        this._undoStack.push(this.captureDraft());
        this._redoStack.length = 0;
        this.syncHistoryState();
    }

    private syncHistoryState(): void {
        this.state.canUndo = this._undoStack.length > 0;
        this.state.canRedo = this._redoStack.length > 0;
    }

    // -----------------------------------------------------------------------
    // Saving
    // -----------------------------------------------------------------------

    /**
     * Turns staged edits into what the engine commits.
     *
     * The original values travel with each edit: they address the row and, for a table without a
     * rowversion, they are also what detects a change made by someone else since the page loaded.
     */
    private buildEdits(): StagedEdit[] {
        const rowsById = this._draftRows;
        const edits: StagedEdit[] = [];

        for (const staged of Object.values(this.state.staged)) {
            const row = rowsById.get(staged.rowId);
            if (!row) throw new Error(SqlFeatures.tableDraftMissing);
            const values: Record<string, string | null | DefaultValue> = { ...staged.values };
            for (const column of staged.defaultColumns ?? []) {
                values[column] = DEFAULT_VALUE;
            }
            if (staged.kind === "insert") {
                edits.push({ rowId: staged.rowId, kind: "insert", values });
                continue;
            }
            const original: Record<string, string | null> = { ...row.values };
            edits.push({
                rowId: staged.rowId,
                kind: staged.kind,
                ...(staged.kind === "update" ? { values } : {}),
                original,
            });
        }
        return edits;
    }

    private async save(): Promise<void> {
        const session = this._editSession;
        if (
            !session ||
            this.state.saveState === "saving" ||
            this.state.saveState === "unknown" ||
            this.state.saveState === "conflict" ||
            this.state.saveState === "savedReloadFailed" ||
            this.state.isLoading ||
            Object.keys(this.state.staged).length === 0
        ) {
            return;
        }

        let edits: StagedEdit[];
        try {
            edits = this.buildEdits();
            const issues = this.validateEdits(session, edits);
            if (issues.length > 0) {
                this.state.saveState = "invalid";
                this.state.issues = issues;
                this.state.saveError = issues[0].message;
                this.updateState();
                return;
            }
        } catch (error) {
            this.state.saveState = "invalid";
            this.state.issues = [{ message: describe(error) }];
            this.state.saveError = describe(error);
            this.updateState();
            return;
        }

        const submittedRevision = this._draftRevision;
        const saveOperationId = `table-save-${this._nextSaveOperationId++}`;
        this.state.submittedRevision = submittedRevision;
        this.state.saveOperationId = saveOperationId;
        this.state.reconciliation = undefined;
        this.state.conflicts = undefined;
        this.state.submittedSnapshot = {
            operationId: saveOperationId,
            revision: submittedRevision,
            edits: edits.map(
                (edit): SubmittedTableEdit => ({
                    rowId: edit.rowId,
                    kind: edit.kind,
                    ...(edit.original ? { original: { ...edit.original } } : {}),
                    values: Object.fromEntries(
                        Object.entries(edit.values ?? {}).map(([column, value]) => [
                            column,
                            isDefaultValue(value) ? { $t: "default" as const } : value,
                        ]),
                    ),
                }),
            ),
        };

        this.state.saveState = "saving";
        this.state.saveError = undefined;
        this.state.failedRowId = undefined;
        this.state.issues = [];
        this.updateState();

        try {
            const commitResult = await session.commit(edits);
            if (this._draftRevision !== submittedRevision) {
                this.state.saveState = "pending";
                this.state.saveError = SqlFeatures.tableDraftChangedDuringSave;
                this.updateState();
                return;
            }
            const committed = await this.readCommittedRows(commitResult.observations ?? []);
            this.state.saveState = "saved";
            this.state.saveError = SqlFeatures.tableSaveAcknowledged;
            this.state.staged = {};
            this._draftRows.clear();
            this.state.draftRows = [];
            this._undoStack.length = 0;
            this._redoStack.length = 0;
            this.syncHistoryState();
            this.state.rows = this.state.rows.filter((r) => !r.isNew);
            this.showRestorePromptAfterClose = false;
            this.state.script = undefined;
            // Reload so identity values, computed columns and the new rowversion are current.
            const reloaded = await this.loadPage(this.state.pageIndex);
            if (!reloaded) {
                this.state.saveState = "savedReloadFailed";
                this.state.saveError = SqlFeatures.tableSavedReloadFailed;
            } else {
                this.mergeCommittedRows(committed.rows);
                if (committed.reconciliation.length > 0) {
                    this.state.saveState = "savedReconciliationFailed";
                    this.state.saveError = SqlFeatures.tableSavedReconciliationFailed;
                    this.state.reconciliation = committed.reconciliation;
                    this.state.issues = committed.reconciliation.map((item) => ({
                        rowId: item.rowId,
                        message: item.detail,
                    }));
                    this.showRestorePromptAfterClose = true;
                } else {
                    this.state.submittedSnapshot = undefined;
                    this.state.submittedRevision = undefined;
                }
            }
            this.updateState();
        } catch (error) {
            if (error instanceof SqlExecutionError && error.outcomeCertainty === "unknown") {
                this.state.saveState = "unknown";
            } else if (
                error instanceof EditCommitError &&
                error.failure.reason === "changedOrDeleted"
            ) {
                this.state.saveState = "conflict";
            } else {
                this.state.saveState = "failed";
            }
            this.state.saveError = describe(error);
            if (error instanceof EditCommitError) {
                this.state.failedRowId = error.failure.rowId;
            }
            this.state.issues = [
                {
                    ...(error instanceof EditCommitError ? { rowId: error.failure.rowId } : {}),
                    message: describe(error),
                },
            ];
            if (error instanceof EditCommitError && error.failure.reason === "changedOrDeleted") {
                this.state.conflicts = [await this.inspectConflict(error.failure.rowId)];
            }
            this.updateState();
        }
    }

    private async readCommittedRows(
        observations: readonly CommitObservation[],
    ): Promise<CommittedRowsResult> {
        const session = this._editSession;
        if (!session) return { rows: [], reconciliation: [] };
        const rows: TableEditorRow[] = [];
        const reconciliation: TableEditorReconciliation[] = [];
        const submitted = this.state.submittedSnapshot?.edits ?? [];
        const observationsByRow = new Map(
            observations.map((observation) => [observation.rowId, observation]),
        );
        for (const edit of submitted) {
            const observation = observationsByRow.get(edit.rowId);
            if (!observation || observation.kind !== edit.kind) {
                reconciliation.push({
                    rowId: edit.rowId,
                    kind: edit.kind,
                    status: "notProven",
                    detail: SqlFeatures.tableOutcomeObservationMissing,
                });
                continue;
            }
            const hasCompleteKey = session.key.columns.every((column) =>
                Object.prototype.hasOwnProperty.call(observation.key, column),
            );
            if (!hasCompleteKey) {
                reconciliation.push({
                    rowId: edit.rowId,
                    kind: edit.kind,
                    status: "notProven",
                    detail: SqlFeatures.tableOutcomeObservationMissing,
                    serverKey: { ...observation.key },
                });
                continue;
            }
            if (observation.incompleteColumns?.length) {
                reconciliation.push({
                    rowId: edit.rowId,
                    kind: edit.kind,
                    status: "notProven",
                    detail: SqlFeatures.tableOutcomeObservationIncomplete,
                    serverKey: { ...observation.key },
                });
                continue;
            }
            if (observation.kind === "delete") continue;
            try {
                const current = await session.readCurrentRow(observation.key);
                if (current) {
                    const identity = JSON.stringify(
                        session.key.columns.map((column) => [column, current.values[column]]),
                    );
                    this._rowIds.set(identity, observation.rowId);
                    rows.push({
                        id: observation.rowId,
                        values: { ...current.values },
                        key: { ...current.cursor } as RowKey,
                        hasTruncatedCells: current.hasTruncatedCells,
                        incompleteColumns: [...current.incompleteColumns],
                    });
                    if (current.incompleteColumns.length > 0) {
                        reconciliation.push({
                            rowId: edit.rowId,
                            kind: edit.kind,
                            status: "unavailable",
                            detail: SqlFeatures.tableOutcomeReadIncomplete,
                            serverKey: { ...current.cursor } as RowKey,
                            serverValues: { ...current.values },
                            incompleteColumns: [...current.incompleteColumns],
                        });
                    }
                } else {
                    reconciliation.push({
                        rowId: edit.rowId,
                        kind: edit.kind,
                        status: "notFound",
                        detail: SqlFeatures.tableOutcomeRowNotFound,
                    });
                }
            } catch {
                reconciliation.push({
                    rowId: edit.rowId,
                    kind: edit.kind,
                    status: "unavailable",
                    detail: SqlFeatures.tableOutcomeEvidenceUnavailable,
                    serverKey: { ...observation.key },
                });
            }
        }
        return { rows, reconciliation };
    }

    private mergeCommittedRows(rows: readonly TableEditorRow[]): void {
        const session = this._editSession;
        if (!session) return;
        for (const committed of rows) {
            const index = this.state.rows.findIndex((row) =>
                session.key.columns.every((column) => row.key[column] === committed.key[column]),
            );
            if (index < 0) continue;
            const existing = this.state.rows[index];
            this.state.rows[index] = { ...committed, id: existing.id };
            const identity = JSON.stringify(
                session.key.columns.map((column) => [column, committed.values[column]]),
            );
            this._rowIds.set(identity, existing.id);
        }
    }

    private async inspectConflict(rowId: number): Promise<TableEditorConflict> {
        const submitted = this.state.submittedSnapshot?.edits.find((edit) => edit.rowId === rowId);
        const draft = this._draftRows.get(rowId);
        const fallback: TableEditorConflict = {
            rowId,
            kind: submitted?.kind === "delete" ? "delete" : "update",
            serverState: "unavailable",
            message: SqlFeatures.tableConflictUnavailable,
            original: submitted?.original ?? {},
            proposed: submitted?.values ?? {},
        };
        if (!submitted || !draft || submitted.kind === "insert") {
            return fallback;
        }
        try {
            const current = await this._editSession?.readCurrentRow(draft.key);
            return {
                ...fallback,
                ...(current
                    ? {
                          serverState: "available" as const,
                          serverValues: { ...current.values },
                          ...(current.incompleteColumns.length > 0
                              ? { serverIncompleteColumns: [...current.incompleteColumns] }
                              : {}),
                      }
                    : { serverState: "missing" as const }),
                message: current
                    ? SqlFeatures.tableConflictValuesAvailable
                    : SqlFeatures.tableConflictRowMissing,
            };
        } catch {
            return fallback;
        }
    }

    private keepServer(rowId: number): void {
        if (this.state.saveState !== "conflict") return;
        const conflict = this.state.conflicts?.find((item) => item.rowId === rowId);
        if (!conflict || conflict.serverState === "unavailable") return;

        this.recordDraftMutation();
        const baseline = this._draftRows.get(rowId);
        if (conflict.serverState === "available" && conflict.serverValues && baseline) {
            const key = Object.fromEntries(
                this._editSession?.key.columns.map((column) => [
                    column,
                    conflict.serverValues?.[column] ?? null,
                ]) ?? [],
            );
            const serverRow: TableEditorRow = {
                ...baseline,
                values: { ...conflict.serverValues },
                key,
                hasTruncatedCells: (conflict.serverIncompleteColumns?.length ?? 0) > 0,
                incompleteColumns: [...(conflict.serverIncompleteColumns ?? [])],
            };
            this.state.rows = this.state.rows.map((row) =>
                row.id === rowId ? { ...serverRow, id: row.id } : row,
            );
            this._rowIds.set(
                JSON.stringify(
                    (this._editSession?.key.columns ?? []).map((column) => [
                        column,
                        serverRow.values[column],
                    ]),
                ),
                rowId,
            );
        } else {
            this.state.rows = this.state.rows.filter((row) => row.id !== rowId);
        }
        delete this.state.staged[rowId];
        this._draftRows.delete(rowId);
        this.state.conflicts = undefined;
        this.state.failedRowId = undefined;
        this.markDraftChanged();
        this.refreshScript();
        this.updateState();
    }

    private reapplyConflict(rowId: number): void {
        if (this.state.saveState !== "conflict") return;
        const conflict = this.state.conflicts?.find((item) => item.rowId === rowId);
        const baseline = this._draftRows.get(rowId);
        if (
            !conflict ||
            conflict.serverState !== "available" ||
            !conflict.serverValues ||
            conflict.serverIncompleteColumns?.length ||
            !baseline
        ) {
            return;
        }

        this.recordDraftMutation();
        const key = Object.fromEntries(
            this._editSession?.key.columns.map((column) => [
                column,
                conflict.serverValues?.[column] ?? null,
            ]) ?? [],
        );
        const refreshedBaseline: TableEditorRow = {
            ...baseline,
            values: { ...conflict.serverValues },
            key,
            hasTruncatedCells: false,
            incompleteColumns: [],
        };
        this._draftRows.set(rowId, refreshedBaseline);
        this.state.rows = this.state.rows.map((row) =>
            row.id === rowId ? { ...refreshedBaseline, id: row.id } : row,
        );
        this.state.conflicts = undefined;
        this.state.failedRowId = undefined;
        this.markDraftChanged();
        this.refreshScript();
        this.updateState();
    }

    private validateEdits(session: EditSession, edits: readonly StagedEdit[]) {
        const issues: { rowId: number; column?: string; message: string }[] = [];
        const columns = new Map(session.info.columns.map((column) => [column.name, column]));
        for (const edit of edits) {
            const values = edit.values ?? {};
            if (edit.kind === "insert") {
                for (const column of session.info.columns) {
                    if (
                        column.isWritable &&
                        !(column.name in values) &&
                        !column.hasDefault &&
                        !column.isNullable
                    ) {
                        issues.push({
                            rowId: edit.rowId,
                            column: column.name,
                            message: SqlFeatures.tableRequiredColumn(column.name),
                        });
                    }
                }
            }
            for (const [name, value] of Object.entries(values)) {
                const column = columns.get(name);
                if (!column) {
                    issues.push({
                        rowId: edit.rowId,
                        column: name,
                        message: SqlFeatures.tableUnknownColumn(name),
                    });
                    continue;
                }
                if (isDefaultValue(value)) {
                    if (!column.hasDefault) {
                        issues.push({
                            rowId: edit.rowId,
                            column: name,
                            message: SqlFeatures.tableDefaultColumn(name),
                        });
                    }
                    continue;
                }
                if (value === null && !column.isNullable) {
                    issues.push({
                        rowId: edit.rowId,
                        column: name,
                        message: SqlFeatures.tableNullColumn(name),
                    });
                }
                const maxLength = column.maxLength;
                if (value !== null && maxLength !== undefined && maxLength >= 0) {
                    const isUnicode = ["nchar", "nvarchar", "ntext"].includes(
                        column.typeName.toLowerCase(),
                    );
                    const valueLength = isUnicode ? value.length * 2 : value.length;
                    if (valueLength > maxLength) {
                        issues.push({
                            rowId: edit.rowId,
                            column: name,
                            message: SqlFeatures.tableLengthExceeded(name),
                        });
                    }
                }
            }
            try {
                session.script([edit]);
            } catch (error) {
                const message = describe(error);
                const column = /Column "([^"]+)"/.exec(message)?.[1];
                issues.push({ rowId: edit.rowId, ...(column ? { column } : {}), message });
            }
        }
        return issues;
    }

    private mutationsBlocked(): boolean {
        return [
            "saving",
            "unknown",
            "conflict",
            "savedReloadFailed",
            "savedReconciliationFailed",
        ].includes(this.state.saveState);
    }

    private markDraftChanged(): void {
        this._draftRevision++;
        this.state.draftRevision = this._draftRevision;
        this.showRestorePromptAfterClose = Object.keys(this.state.staged).length > 0;
        this.state.draftRows = [...this._draftRows.values()].map((row) => ({
            ...row,
            values: { ...row.values },
            key: { ...row.key },
            incompleteColumns: [...row.incompleteColumns],
        }));
        this.syncHistoryState();
        if (this.state.saveState !== "saving" && this.state.saveState !== "unknown") {
            const session = this._editSession;
            let issues: { rowId: number; column?: string; message: string }[] = [];
            if (session && Object.keys(this.state.staged).length > 0) {
                try {
                    issues = this.validateEdits(session, this.buildEdits());
                } catch (error) {
                    issues = [{ rowId: 0, message: describe(error) }];
                }
            }
            this.state.saveState =
                issues.length > 0
                    ? "invalid"
                    : Object.keys(this.state.staged).length > 0
                      ? "pending"
                      : "clean";
            this.state.saveError = issues[0]?.message;
            this.state.issues = issues;
        }
    }

    /** Keeps the preview in step with what saving would run. */
    private refreshScript(): void {
        const session = this._editSession;
        if (!session || !this.state.showScript) {
            return;
        }
        try {
            const edits = this.buildEdits();
            this.state.script = edits.length > 0 ? session.script(edits) : undefined;
        } catch (error) {
            // A half-typed value cannot be scripted yet; that is not worth an error banner.
            this.state.script = `-- ${describe(error)}`;
        }
    }

    // -----------------------------------------------------------------------
    // Large values
    // -----------------------------------------------------------------------

    /** Fetches one cell in full, so a clipped document is edited whole rather than truncated. */
    private async openCell(rowId: number, column: string): Promise<void> {
        const session = this._editSession;
        const row = this.state.rows.find((r) => r.id === rowId);
        if (!session || !row) {
            return;
        }

        const generation = ++this._cellGeneration;
        const staged = this.state.staged[rowId];
        if (staged && column in staged.values) {
            this.state.openCell = { rowId, column, value: staged.values[column], status: "ready" };
            this.updateState();
            return;
        }
        if (row.isNew) {
            this.state.openCell = { rowId, column, value: null, status: "ready" };
            this.updateState();
            return;
        }

        this.state.openCell = { rowId, column, value: null, status: "loading" };
        this.updateState();
        try {
            const value = await session.readCellValue(
                row.key as PageCursor,
                column,
                this.state.sort as EngineSort[],
            );
            if (generation !== this._cellGeneration) return;
            this.state.openCell = { rowId, column, value, status: "ready" };
        } catch (error) {
            if (generation !== this._cellGeneration) return;
            this.state.openCell = {
                rowId,
                column,
                value: null,
                status: "error",
                error: describe(error),
            };
        }
        this.updateState();
    }

    private async countRows(): Promise<void> {
        const session = this._editSession;
        if (!session) {
            return;
        }
        try {
            this.state.totalRows = await session.countRows({
                filters: this.state.filters as EngineFilter[],
            });
        } catch (error) {
            this.state.saveError = describe(error);
        }
        this.updateState();
    }

    private async reconcile(): Promise<void> {
        if (this.state.saveState !== "unknown" || this.state.isLoading) {
            return;
        }
        const snapshot = this.state.submittedSnapshot;
        if (!snapshot) return;
        const evidence: TableEditorReconciliation[] = [];
        for (const edit of snapshot.edits) {
            if (edit.kind === "insert") {
                evidence.push({
                    rowId: edit.rowId,
                    kind: edit.kind,
                    status: "notProven",
                    detail: SqlFeatures.tableInsertOutcomeUnproven,
                });
                continue;
            }
            const row = this._draftRows.get(edit.rowId);
            if (!row || !this._editSession) {
                evidence.push({
                    rowId: edit.rowId,
                    kind: edit.kind,
                    status: "unavailable",
                    detail: SqlFeatures.tableOutcomeEvidenceUnavailable,
                });
                continue;
            }
            try {
                const current = await this._editSession.readCurrentRow(row.key);
                if (!current) {
                    evidence.push({
                        rowId: edit.rowId,
                        kind: edit.kind,
                        status: "notFound",
                        detail: SqlFeatures.tableOutcomeRowNotFound,
                    });
                    continue;
                }
                const values = Object.fromEntries(
                    Object.entries(edit.values).filter(([, value]) => !isDefaultValue(value)),
                );
                const matching =
                    edit.kind === "update" &&
                    Object.entries(values).every(
                        ([column, value]) => current.values[column] === value,
                    );
                evidence.push({
                    rowId: edit.rowId,
                    kind: edit.kind,
                    status: matching ? "observedMatching" : "observedDifferent",
                    detail: matching
                        ? SqlFeatures.tableOutcomeMatchingNotProof
                        : SqlFeatures.tableOutcomeDifferentState,
                    serverKey: { ...current.cursor } as RowKey,
                    serverValues: { ...current.values },
                    ...(current.incompleteColumns.length > 0
                        ? { incompleteColumns: [...current.incompleteColumns] }
                        : {}),
                });
            } catch {
                evidence.push({
                    rowId: edit.rowId,
                    kind: edit.kind,
                    status: "unavailable",
                    detail: SqlFeatures.tableOutcomeEvidenceUnavailable,
                });
            }
        }
        this.state.reconciliation = evidence;
        await this.loadPage(this.state.pageIndex);
        this.state.saveError = SqlFeatures.tableOutcomeReconciled;
        this.state.issues = evidence.map((item) => ({ rowId: item.rowId, message: item.detail }));
        this.updateState();
    }

    /** Rechecks acknowledged rows before allowing a saved result to become ordinary state. */
    private async verifySavedReconciliation(): Promise<boolean> {
        const session = this._editSession;
        const snapshot = this.state.submittedSnapshot;
        if (!session || !snapshot) return false;

        const previous = new Map(
            (this.state.reconciliation ?? []).map((item) => [item.rowId, item]),
        );
        const unresolved: TableEditorReconciliation[] = [];
        for (const edit of snapshot.edits) {
            const prior = previous.get(edit.rowId);
            const key = this.reconciliationKey(edit, prior, session.key.columns);
            if (!key) {
                unresolved.push(
                    prior ?? {
                        rowId: edit.rowId,
                        kind: edit.kind,
                        status: "notProven",
                        detail: SqlFeatures.tableOutcomeObservationMissing,
                    },
                );
                continue;
            }

            try {
                const current = await session.readCurrentRow(key);
                if (!current) {
                    if (edit.kind === "delete") continue;
                    unresolved.push({
                        rowId: edit.rowId,
                        kind: edit.kind,
                        status: "notFound",
                        detail: SqlFeatures.tableOutcomeRowNotFound,
                        serverKey: { ...key },
                    });
                    continue;
                }
                if (current.incompleteColumns.length > 0) {
                    unresolved.push({
                        rowId: edit.rowId,
                        kind: edit.kind,
                        status: "unavailable",
                        detail: SqlFeatures.tableOutcomeReadIncomplete,
                        serverKey: { ...current.cursor } as RowKey,
                        serverValues: { ...current.values },
                        incompleteColumns: [...current.incompleteColumns],
                    });
                    continue;
                }
                if (edit.kind === "delete") {
                    unresolved.push({
                        rowId: edit.rowId,
                        kind: edit.kind,
                        status: "observedDifferent",
                        detail: SqlFeatures.tableOutcomeDifferentState,
                        serverKey: { ...current.cursor } as RowKey,
                        serverValues: { ...current.values },
                    });
                }
            } catch {
                unresolved.push({
                    rowId: edit.rowId,
                    kind: edit.kind,
                    status: "unavailable",
                    detail: SqlFeatures.tableOutcomeEvidenceUnavailable,
                    serverKey: { ...key },
                });
            }
        }

        this.state.reconciliation = unresolved.length > 0 ? unresolved : undefined;
        this.state.issues = unresolved.map((item) => ({ rowId: item.rowId, message: item.detail }));
        return unresolved.length === 0;
    }

    private reconciliationKey(
        _edit: SubmittedTableEdit,
        prior: TableEditorReconciliation | undefined,
        columns: readonly string[],
    ): RowKey | undefined {
        const candidate = prior?.serverKey;
        if (!candidate || !columns.every((column) => Object.hasOwn(candidate, column))) {
            return undefined;
        }
        if (prior?.incompleteColumns?.some((column) => columns.includes(column))) {
            return undefined;
        }
        return Object.fromEntries(
            columns.map((column) => [column, candidate[column] ?? null]),
        ) as RowKey;
    }

    private acceptReconciliation(): void {
        if (this.state.saveState !== "savedReconciliationFailed") return;
        this.state.saveState = "saved";
        this.state.saveError = SqlFeatures.tableSaveAcknowledged;
        this.state.reconciliation = undefined;
        this.state.submittedSnapshot = undefined;
        this.state.submittedRevision = undefined;
        this.state.issues = [];
        this.showRestorePromptAfterClose = false;
        this.updateState();
    }

    // -----------------------------------------------------------------------
    // Reducers
    // -----------------------------------------------------------------------

    private registerReducers(): void {
        this.registerReducer("refresh", async () => {
            if (this.state.saveState === "saving") return this.state;
            const wasReconciliationPending = this.state.saveState === "savedReconciliationFailed";
            const reconciliationVerified = wasReconciliationPending
                ? await this.verifySavedReconciliation()
                : false;
            const reloaded = await this.loadPage(this.state.pageIndex);
            if (reloaded && this.state.saveState === "savedReloadFailed") {
                this.state.saveState = "saved";
                this.state.saveError = SqlFeatures.tableSaveAcknowledged;
                this.state.submittedSnapshot = undefined;
                this.state.submittedRevision = undefined;
                this.updateState();
            }
            if (wasReconciliationPending && reconciliationVerified) {
                this.state.saveState = reloaded ? "saved" : "savedReloadFailed";
                this.state.saveError = reloaded
                    ? SqlFeatures.tableSaveAcknowledged
                    : SqlFeatures.tableSavedReloadFailed;
                this.state.reconciliation = undefined;
                this.state.submittedSnapshot = undefined;
                this.state.submittedRevision = undefined;
                this.state.issues = [];
                this.showRestorePromptAfterClose = false;
                this.updateState();
            } else if (wasReconciliationPending) {
                this.state.saveState = "savedReconciliationFailed";
                this.state.saveError = SqlFeatures.tableSavedReconciliationFailed;
                this.updateState();
            }
            return this.state;
        });

        this.registerReducer("nextPage", async () => {
            if (this.mutationsBlocked()) return this.state;
            if (this.state.hasNextPage) {
                await this.loadPage(this.state.pageIndex + 1);
            }
            return this.state;
        });

        this.registerReducer("previousPage", async () => {
            if (this.mutationsBlocked()) return this.state;
            if (this.state.pageIndex > 0) {
                await this.loadPage(this.state.pageIndex - 1);
            }
            return this.state;
        });

        this.registerReducer("setPageSize", async (state, payload) => {
            if (this.mutationsBlocked()) return this.state;
            state.pageSize = Math.max(1, Math.min(1000, Math.floor(payload.pageSize)));
            this.resetPaging();
            await this.loadPage(0);
            return this.state;
        });

        this.registerReducer("setFilters", async (state, payload) => {
            if (this.mutationsBlocked()) return this.state;
            state.filters = payload.filters as ColumnFilter[];
            state.totalRows = undefined;
            this.resetPaging();
            await this.loadPage(0);
            return this.state;
        });

        this.registerReducer("setSort", async (state, payload) => {
            if (this.mutationsBlocked()) return this.state;
            state.sort = payload.sort;
            this.resetPaging();
            await this.loadPage(0);
            return this.state;
        });

        this.registerReducer("editCell", async (state, payload) => {
            this.stageCell(payload.rowId, payload.column, payload.value);
            return this.state;
        });

        this.registerReducer("setCellDefault", async (state, payload) => {
            this.setCellDefault(payload.rowId, payload.column);
            return this.state;
        });

        this.registerReducer("revertCell", async (state, payload) => {
            this.revertCell(payload.rowId, payload.column);
            return this.state;
        });

        this.registerReducer("addRow", async () => {
            this.addRow();
            return this.state;
        });

        this.registerReducer("insertUsingDefaults", async (state, payload) => {
            this.insertUsingDefaults(payload.rowId);
            return this.state;
        });

        this.registerReducer("deleteRow", async (state, payload) => {
            this.deleteRow(payload.rowId);
            return this.state;
        });

        this.registerReducer("revertRow", async (state, payload) => {
            this.revertRow(payload.rowId);
            return this.state;
        });

        this.registerReducer("discardAll", async () => {
            this.discardAll();
            return this.state;
        });

        this.registerReducer("undo", async () => {
            this.undo();
            return this.state;
        });

        this.registerReducer("redo", async () => {
            this.redo();
            return this.state;
        });

        this.registerReducer("applyPaste", async (state, payload) => {
            this.applyPaste(payload.cells);
            return this.state;
        });

        this.registerReducer("save", async () => {
            await this.save();
            return this.state;
        });

        this.registerReducer("toggleScript", async (state) => {
            state.showScript = !state.showScript;
            this.refreshScript();
            return this.state;
        });

        this.registerReducer("openCell", async (state, payload) => {
            await this.openCell(payload.rowId, payload.column);
            return this.state;
        });

        this.registerReducer("closeCell", async (state) => {
            ++this._cellGeneration;
            state.openCell = undefined;
            return state;
        });

        this.registerReducer("countRows", async () => {
            await this.countRows();
            return this.state;
        });

        this.registerReducer("reconcile", async () => {
            await this.reconcile();
            return this.state;
        });

        this.registerReducer("acceptReconciliation", async () => {
            this.acceptReconciliation();
            return this.state;
        });

        this.registerReducer("keepServer", async (_state, payload) => {
            this.keepServer(payload.rowId);
            return this.state;
        });

        this.registerReducer("reapplyConflict", async (_state, payload) => {
            this.reapplyConflict(payload.rowId);
            return this.state;
        });
    }

    /** Cursors describe a specific filter and sort, so changing either invalidates them. */
    private resetPaging(): void {
        this._pageStarts = [undefined];
        this.state.pageIndex = 0;
    }

    public override dispose(): void {
        void this._table.session.close({ reason: "table editor closed" }).catch(() => undefined);
        super.dispose();
    }
}

/** Engine errors already read as sentences; anything else is wrapped rather than shown raw. */
function describe(error: unknown): string {
    if (error instanceof EditCommitError || error instanceof SqlEditError) {
        return error.message;
    }
    return getErrorMessage(error);
}

function cloneRow(row: TableEditorRow): TableEditorRow {
    return {
        ...row,
        values: { ...row.values },
        key: { ...row.key },
        incompleteColumns: [...row.incompleteColumns],
    };
}
