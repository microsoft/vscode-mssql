/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useRef, useEffect, useCallback } from "react";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { TableDataGrid, TableDataGridRef } from "./TableDataGrid";
import { TableExplorerToolbar } from "./TableExplorerToolbar";
import {
    TableExplorerFilterBar,
    AppliedFilter,
    composeFilteredQuery,
} from "./TableExplorerFilterBar";
import {
    DefinitionPanel,
    DefinitionPanelCustomTab,
    DesignerDefinitionTabs,
} from "../../common/definitionPanel";
import { makeStyles, shorthands, Spinner } from "@fluentui/react-components";
import { locConstants as loc } from "../../common/locConstants";
import { useTableExplorerSelector } from "./tableExplorerSelector";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import {
    SqlPaneMode,
    TableExplorerWebViewState,
    TableExplorerReducers,
} from "../../../sharedInterfaces/tableExplorer";
import { VscodeEditor } from "../../common/vscodeMonaco";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100%",
        ...shorthands.overflow("hidden"),
    },
    panelGroup: {
        ...shorthands.flex(1),
        width: "100%",
        height: "100%",
    },
    contentArea: {
        ...shorthands.flex(1),
        display: "flex",
        flexDirection: "column",
        ...shorthands.overflow("hidden"),
        height: "100%",
    },
    dataGridContainer: {
        ...shorthands.flex(1),
        ...shorthands.overflow("hidden"),
        minHeight: 0,
        position: "relative",
    },
    resizeHandle: {
        height: "2px",
        backgroundColor: "var(--vscode-editorWidget-border)",
    },
    loadingContainer: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
        width: "100%",
        flexDirection: "column",
    },
    editorPane: {
        width: "100%",
        height: "100%",
        position: "relative",
    },
    loadingOverlay: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "var(--vscode-editor-background)",
        opacity: 0.9,
        zIndex: 1000,
        flexDirection: "column",
    },
});

const escapeIdentifier = (name: string): string => `[${name.replace(/]/g, "]]")}]`;

/**
 * Builds the default `SELECT TOP N <columns> FROM [schema].[table]` query the
 * table explorer always shows. Mirrors the controller-side
 * `buildDefaultSelectQuery` so the webview can regenerate the query (e.g. when
 * the toolbar row count changes) without resorting to string-mutation regexes.
 */
const buildDefaultSelectQuery = (
    schemaName: string | undefined,
    tableName: string,
    columnNames: readonly string[],
    rowCount: number,
): string => {
    const columnList = columnNames.map((c) => `    ${escapeIdentifier(c)}`).join(",\n");
    const qualifiedName = schemaName
        ? `${escapeIdentifier(schemaName)}.${escapeIdentifier(tableName)}`
        : escapeIdentifier(tableName);
    return `SELECT TOP ${rowCount}\n${columnList}\nFROM ${qualifiedName}`;
};

export const TableExplorerPage: React.FC = () => {
    const classes = useStyles();
    const context = useTableExplorerContext();
    const { themeKind } = useVscodeWebview<TableExplorerWebViewState, TableExplorerReducers>();

    // Use selectors to access specific state properties
    const resultSet = useTableExplorerSelector((s) => s.resultSet);
    const loadStatus = useTableExplorerSelector((s) => s.loadStatus);
    const currentRowCount = useTableExplorerSelector((s) => s.currentRowCount);
    const failedCells = useTableExplorerSelector((s) => s.failedCells);
    const deletedRows = useTableExplorerSelector((s) => s.deletedRows);
    const newRows = useTableExplorerSelector((s) => s.newRows);
    const showScriptPane = useTableExplorerSelector((s) => s.showScriptPane);
    const updateScript = useTableExplorerSelector((s) => s.updateScript);
    const sqlPaneMode = useTableExplorerSelector((s) => s.sqlPaneMode);
    const tableQuery = useTableExplorerSelector((s) => s.tableQuery);
    const schemaName = useTableExplorerSelector((s) => s.schemaName);
    const tableName = useTableExplorerSelector((s) => s.tableName);

    const isLoading = loadStatus === ApiStatus.Loading;

    // Track the editor's current text in a ref so React state changes never
    // round-trip through Monaco's `value` prop. The @monaco-editor/react value
    // sync calls executeEdits with forceMoveMarkers on any prop/model mismatch,
    // which slams the cursor to the end of the document — using a ref keeps
    // Monaco fully uncontrolled while typing.
    const editableQueryRef = useRef<string>("");
    const lastSyncedTableQueryRef = useRef<string | undefined>(undefined);
    const editorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);
    const shouldFocusEditorRef = useRef(false);

    const handleEditorMount = useCallback(
        (
            editor: import("monaco-editor").editor.IStandaloneCodeEditor,
            _monaco: typeof import("monaco-editor"),
        ) => {
            editorRef.current = editor;
            editor.onDidDispose(() => {
                if (editorRef.current === editor) {
                    editorRef.current = null;
                }
            });

            // If the pane became active before the editor finished mounting,
            // honour the deferred focus request now.
            if (shouldFocusEditorRef.current) {
                shouldFocusEditorRef.current = false;
                editor.focus();
            }

            // Handle Tab at window capture phase — this fires BEFORE document capture,
            // which is where Fluent UI's Tabster registers. Using stopImmediatePropagation
            // here prevents the event from ever reaching Tabster, so focus stays in the
            // editor and Monaco's context keys remain correct.
            const editorDomNode = editor.getDomNode();
            const tabHandler = (e: KeyboardEvent) => {
                if (e.key !== "Tab") {
                    return;
                }

                const isMonacoFocused =
                    editor.hasTextFocus() ||
                    (editorDomNode !== null &&
                        (editorDomNode?.contains(document.activeElement) ?? false));
                if (!isMonacoFocused) {
                    return;
                }

                // Stop Tabster (document capture) and the browser default from running.
                e.preventDefault();
                e.stopImmediatePropagation();

                if (e.shiftKey) {
                    editor.trigger("keyboard", "outdent", undefined);
                } else {
                    editor.trigger("keyboard", "tab", undefined);
                }
                queueMicrotask(() => editor.focus());
            };
            window.addEventListener("keydown", tabHandler, true);
            editor.onDidDispose(() => window.removeEventListener("keydown", tabHandler, true));
        },
        [],
    );

    // Sync editor content from tableQuery only when the reducer updates it
    // externally (initial data load, running a custom query). Imperative
    // setValue keeps the editor uncontrolled during normal typing.
    useEffect(() => {
        if (tableQuery === undefined) {
            return;
        }
        if (tableQuery === lastSyncedTableQueryRef.current) {
            return;
        }
        lastSyncedTableQueryRef.current = tableQuery;
        editableQueryRef.current = tableQuery;

        const editor = editorRef.current;
        if (editor && editor.getValue() !== tableQuery) {
            editor.setValue(tableQuery);
        }
    }, [tableQuery]);

    // Focus the Monaco editor whenever the Table Query tab becomes active so
    // the user can start editing without an extra click. The editor may not be
    // mounted yet on the first activation, so we retry once it's available.
    useEffect(() => {
        if (!showScriptPane || sqlPaneMode !== SqlPaneMode.TableQuery) {
            return;
        }
        const editor = editorRef.current;
        if (editor) {
            editor.focus();
        } else {
            shouldFocusEditorRef.current = true;
        }
    }, [showScriptPane, sqlPaneMode]);

    const gridRef = useRef<TableDataGridRef>(null);
    const [cellChangeCount, setCellChangeCount] = React.useState(0);
    const [deletionCount, setDeletionCount] = React.useState(0);
    const [selectedRowIds, setSelectedRowIds] = React.useState<number[]>([]);
    const [filtersOpen, setFiltersOpen] = React.useState(false);
    const [activeFilters, setActiveFilters] = React.useState<AppliedFilter[]>([]);
    // Snapshot the unfiltered query so successive Apply clicks compose against
    // the original, not the previously-filtered result. Updates whenever the
    // tableQuery changes while no filters are active (initial load, or a
    // user-authored custom query).
    const baseQueryRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (activeFilters.length === 0 && tableQuery) {
            baseQueryRef.current = tableQuery;
        }
    }, [tableQuery, activeFilters.length]);

    const handleApplyFilters = useCallback(
        (filters: AppliedFilter[]) => {
            const base = baseQueryRef.current ?? tableQuery;
            if (!base) {
                return;
            }
            setActiveFilters(filters);
            const composed = composeFilteredQuery(base, filters);
            context.runTableQuery(composed);
        },
        [tableQuery, context],
    );

    const handleClearFilters = useCallback(() => {
        const base = baseQueryRef.current;
        setActiveFilters([]);
        if (base) {
            context.runTableQuery(base);
        }
    }, [context]);

    const filterColumns = React.useMemo(
        () =>
            (resultSet?.columnInfo ?? []).map((c, i) => ({
                id: `col${i}`,
                name: c.name,
            })),
        [resultSet],
    );

    const handleExport = useCallback((format: "csv" | "excel" | "json") => {
        gridRef.current?.exportData(format);
    }, []);

    const handleGetDataColumns = useCallback(() => {
        return gridRef.current?.getDataColumns() ?? [];
    }, []);

    const handleSetColumnVisibility = useCallback((id: string, visible: boolean) => {
        gridRef.current?.setDataColumnVisibility(id, visible);
    }, []);

    const handleDeleteSelected = useCallback(() => {
        if (selectedRowIds.length > 0) {
            gridRef.current?.deleteRows(selectedRowIds);
            setSelectedRowIds([]);
        }
    }, [selectedRowIds]);

    const handleShowSql = useCallback(() => {
        const sql = gridRef.current?.getSqlForCurrentView();
        if (sql) {
            context?.showSql?.(sql);
        }
    }, [context]);

    // The edit session is bounded by the TOP N from the query that opened it,
    // so changing the toolbar row count requires re-initializing the session
    // with a freshly-built query. The default query shape is always
    // `SELECT TOP N <cols> FROM [schema].[table]`, so we can regenerate it
    // from state instead of trying to surgically rewrite the TOP operand.
    const handleLoadSubset = useCallback(
        (rowCount: number) => {
            const columnNames = resultSet?.columnInfo?.map((c) => c.name) ?? [];
            if (!tableName || columnNames.length === 0) {
                context.loadSubset(rowCount);
                return;
            }
            const newQuery = buildDefaultSelectQuery(schemaName, tableName, columnNames, rowCount);
            context.runTableQuery(newQuery);
        },
        [resultSet, schemaName, tableName, context],
    );

    // Clear cell highlights when the query changes (pending changes are stale)
    useEffect(() => {
        gridRef.current?.clearAllChangeTracking();
    }, [tableQuery]);

    const handleSaveComplete = () => {
        // Clear the change tracking in the grid after successful save
        gridRef.current?.clearAllChangeTracking();
    };

    const handleCellChangeCountChanged = (count: number) => {
        setCellChangeCount(count);
    };

    const handleDeletionCountChanged = (count: number) => {
        setDeletionCount(count);
    };

    return (
        <div className={classes.root}>
            <PanelGroup direction="vertical" className={classes.panelGroup}>
                <Panel defaultSize={75}>
                    <div className={classes.contentArea}>
                        <TableExplorerToolbar
                            onSaveComplete={handleSaveComplete}
                            cellChangeCount={cellChangeCount}
                            deletionCount={deletionCount}
                            currentRowCount={currentRowCount}
                            onLoadSubset={handleLoadSubset}
                            onExport={handleExport}
                            getDataColumns={handleGetDataColumns}
                            onSetColumnVisibility={handleSetColumnVisibility}
                            onShowSql={handleShowSql}
                            selectedRowCount={selectedRowIds.length}
                            onDeleteSelected={handleDeleteSelected}
                            onToggleFilters={() => setFiltersOpen((prev) => !prev)}
                            filtersOpen={filtersOpen}
                        />
                        {filterColumns.length > 0 && (
                            // Keep the filter bar mounted but hidden when closed so
                            // the user's filter rows (and any in-progress edits)
                            // persist across toggles. Remounting would reset the
                            // bar's internal rows state and visually clear filters
                            // even though the underlying query is still filtered.
                            <div style={{ display: filtersOpen ? undefined : "none" }}>
                                <TableExplorerFilterBar
                                    columns={filterColumns}
                                    onApply={handleApplyFilters}
                                    onClear={handleClearFilters}
                                    disabled={isLoading}
                                />
                            </div>
                        )}
                        {resultSet ? (
                            <div className={classes.dataGridContainer}>
                                {isLoading && (
                                    <div className={classes.loadingOverlay}>
                                        <Spinner
                                            label={loc.tableExplorer.loadingTableData}
                                            labelPosition="below"
                                        />
                                    </div>
                                )}
                                <TableDataGrid
                                    ref={gridRef}
                                    resultSet={resultSet}
                                    themeKind={themeKind}
                                    currentRowCount={currentRowCount}
                                    failedCells={failedCells}
                                    deletedRows={deletedRows}
                                    newRowIds={newRows?.map((r) => r.id)}
                                    tableQuery={tableQuery}
                                    onDeleteRow={context?.deleteRow}
                                    onUpdateCell={context?.updateCell}
                                    onRevertCell={context?.revertCell}
                                    onRevertRow={context?.revertRow}
                                    onCellChangeCountChanged={handleCellChangeCountChanged}
                                    onDeletionCountChanged={handleDeletionCountChanged}
                                    onSelectedRowsChanged={setSelectedRowIds}
                                    onSaveResults={context?.saveResults}
                                    onModifyTable={context?.modifyTable}
                                />
                            </div>
                        ) : isLoading ? (
                            <div className={classes.loadingContainer}>
                                <Spinner
                                    label={loc.tableExplorer.loadingTableData}
                                    labelPosition="below"
                                />
                            </div>
                        ) : (
                            <p>{loc.tableExplorer.noDataAvailable}</p>
                        )}
                    </div>
                </Panel>
                {showScriptPane && (
                    <>
                        <PanelResizeHandle className={classes.resizeHandle} />
                        <DefinitionPanel<"tableQuery">
                            scriptTab={{
                                value: updateScript || `-- ${loc.tableExplorer.noPendingChanges}`,
                                themeKind,
                                language: "sql",
                                label: loc.tableExplorer.scriptChanges,
                                openInEditor: () => context.openScriptInEditor(),
                                copyToClipboard: () => context.copyScriptToClipboard(),
                            }}
                            customTabs={[
                                {
                                    id: "tableQuery" as const,
                                    label: loc.tableExplorer.tableQuery,
                                    content: (
                                        <div
                                            className={classes.editorPane}
                                            data-tabster='{"focusable": {"ignoreKeydown": {"Tab": true}}, "uncontrolled": {}}'>
                                            <VscodeEditor
                                                height={"100%"}
                                                width={"100%"}
                                                language="sql"
                                                themeKind={themeKind}
                                                defaultValue={editableQueryRef.current}
                                                options={{
                                                    readOnly: true,
                                                    fixedOverflowWidgets: true,
                                                    tabFocusMode: false,
                                                }}
                                                onMount={handleEditorMount}
                                                // beforeMount={beforeMount}
                                            />
                                        </div>
                                    ),
                                } satisfies DefinitionPanelCustomTab<"tableQuery">,
                            ]}
                            activeTab={
                                sqlPaneMode === SqlPaneMode.TableQuery
                                    ? "tableQuery"
                                    : DesignerDefinitionTabs.Script
                            }
                            setActiveTab={(tab) => {
                                if (tab === "tableQuery") {
                                    context.showTableQuery();
                                } else {
                                    context.generateScript();
                                }
                            }}
                            onClose={() => context.toggleScriptPane()}
                        />
                    </>
                )}
            </PanelGroup>
        </div>
    );
};
