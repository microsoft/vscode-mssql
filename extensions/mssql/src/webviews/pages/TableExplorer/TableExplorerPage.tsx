/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useRef, useState, useEffect, useCallback } from "react";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { TableDataGrid, TableDataGridRef } from "./TableDataGrid";
import { TableExplorerToolbar } from "./TableExplorerToolbar";
import { TableExplorerFilterBar } from "./TableExplorerFilterBar";
import {
    AppliedFilter,
    AppliedSortColumn,
    composeFilteredQuery,
    composeSortedQuery,
    stripTrailingOrderByAndSemicolon,
} from "../../../tableExplorer/tableQueryComposer";
import {
    DefinitionPanel,
    DefinitionPanelCustomTab,
    DesignerDefinitionTabs,
} from "../../common/definitionPanel";
import { Button, makeStyles, shorthands, Spinner } from "@fluentui/react-components";
import { Open12Regular, Copy16Regular } from "@fluentui/react-icons";
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
        },
        [],
    );

    const gridRef = useRef<TableDataGridRef>(null);
    const [cellChangeCount, setCellChangeCount] = React.useState(0);
    const [deletionCount, setDeletionCount] = React.useState(0);
    const [selectedRowIds, setSelectedRowIds] = React.useState<number[]>([]);
    const [filtersOpen, setFiltersOpen] = React.useState(false);
    const [activeFilters, setActiveFilters] = React.useState<AppliedFilter[]>([]);
    // Sort columns reflected in the SQL pane and appended to outgoing queries.
    // Updates whenever the user clicks a sortable column header (driven by
    // TableDataGrid's onSortChanged callback). We don't dispatch a query on
    // every change — the ORDER BY rides along the next time something else
    // (load subset, filter apply/clear) actually re-runs the query.
    const [sortColumns, setSortColumns] = useState<AppliedSortColumn[]>([]);

    // The SQL pane displays `tableQuery` rebased onto the current UI sort:
    //   - sort active   → strip any embedded ORDER BY and append the UI one
    //   - sort cleared  → strip any embedded ORDER BY (this is the case after
    //                     a re-fetch sent our ORDER BY along — once the user
    //                     clears the sort here we want the pane to drop it,
    //                     even though tableQuery still contains it)
    // This means clicking a column header updates the SQL live without
    // re-running anything against the database.
    const displayedSql = React.useMemo(() => {
        const base = tableQuery ?? "";
        if (sortColumns.length === 0) {
            return stripTrailingOrderByAndSemicolon(base);
        }
        return composeSortedQuery(base, sortColumns);
    }, [tableQuery, sortColumns]);

    // Sync editor content from displayedSql when it changes (reducer updated
    // tableQuery, or the user clicked a sort indicator). Imperative setValue
    // keeps the editor uncontrolled during normal typing.
    useEffect(() => {
        if (tableQuery === undefined) {
            return;
        }
        if (displayedSql === lastSyncedTableQueryRef.current) {
            return;
        }
        lastSyncedTableQueryRef.current = displayedSql;
        editableQueryRef.current = displayedSql;

        const editor = editorRef.current;
        if (editor && editor.getValue() !== displayedSql) {
            editor.setValue(displayedSql);
        }
    }, [displayedSql, tableQuery]);

    // Snapshot the unfiltered query so successive Apply clicks compose against
    // the original, not the previously-filtered result. Updates when tableQuery
    // changes and no filters are active (initial load or user clears filters).
    // When filters are active, we skip the update to preserve the base query.
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
            // Pass only operator names (never column names or values) for telemetry.
            context.runTableQuery(
                composeSortedQuery(composed, sortColumns),
                undefined,
                filters.map((f) => f.operator),
            );
        },
        [tableQuery, context, sortColumns],
    );

    const handleClearFilters = useCallback(() => {
        if (activeFilters.length === 0) {
            return;
        }
        const base = baseQueryRef.current;
        setActiveFilters([]);
        if (base) {
            context.runTableQuery(composeSortedQuery(base, sortColumns), undefined, []);
        }
    }, [activeFilters.length, context, sortColumns]);

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
            let queryToRun = composeSortedQuery(newQuery, sortColumns);

            // Update baseQueryRef with the new unfiltered query before applying filters
            baseQueryRef.current = queryToRun;

            // Reapply active filters to the new query
            if (activeFilters.length > 0) {
                queryToRun = composeFilteredQuery(queryToRun, activeFilters);
            }

            context.runTableQuery(
                queryToRun,
                rowCount,
                activeFilters.map((f) => f.operator),
            );
        },
        [resultSet, schemaName, tableName, context, sortColumns, activeFilters],
    );

    // Clear cell highlights and reset sort tracking when the query changes
    // (pending changes are stale, and slickgrid's sort indicators are dropped
    // when the grid re-initializes — keeping our sortColumns aligned with what
    // the grid actually shows avoids spurious ORDER BYs on the next re-fetch).
    useEffect(() => {
        gridRef.current?.clearAllChangeTracking();
        setSortColumns([]);
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
                                    initialFilters={activeFilters}
                                    isOpen={filtersOpen}
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
                                    onSortChanged={setSortColumns}
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
                                    headerActions: (
                                        <>
                                            <Button
                                                size="small"
                                                appearance="subtle"
                                                title={loc.tableExplorer.openInEditor}
                                                icon={<Open12Regular />}
                                                disabled={!displayedSql}
                                                onClick={() => context.showSql(displayedSql)}>
                                                {loc.tableExplorer.openInEditor}
                                            </Button>
                                            <Button
                                                size="small"
                                                appearance="subtle"
                                                title={loc.common.copy}
                                                aria-label={loc.common.copy}
                                                icon={<Copy16Regular />}
                                                disabled={!displayedSql}
                                                onClick={async () => {
                                                    if (displayedSql) {
                                                        try {
                                                            await navigator.clipboard.writeText(
                                                                displayedSql,
                                                            );
                                                        } catch (error) {
                                                            console.error(
                                                                "Failed to copy to clipboard:",
                                                                error,
                                                            );
                                                        }
                                                    }
                                                }}
                                            />
                                        </>
                                    ),
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
