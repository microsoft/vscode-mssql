/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useRef, useState, useEffect } from "react";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { TableDataGrid, TableDataGridRef } from "./TableDataGrid";
import { TableExplorerToolbar } from "./TableExplorerToolbar";
import {
    DefinitionPanel,
    DefinitionPanelCustomTab,
    DesignerDefinitionTabs,
} from "../../common/definitionPanel";
import { Button, makeStyles, shorthands, Spinner } from "@fluentui/react-components";
import { PlayRegular } from "@fluentui/react-icons";
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
import { useMonacoSqlIntellisense } from "./useMonacoSqlIntellisense";

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

export const TableExplorerPage: React.FC = () => {
    const classes = useStyles();
    const context = useTableExplorerContext();
    const { themeKind, extensionRpc } = useVscodeWebview<
        TableExplorerWebViewState,
        TableExplorerReducers
    >();

    // Use selectors to access specific state properties
    const resultSet = useTableExplorerSelector((s) => s.resultSet);
    const loadStatus = useTableExplorerSelector((s) => s.loadStatus);
    const currentRowCount = useTableExplorerSelector((s) => s.currentRowCount);
    const failedCells = useTableExplorerSelector((s) => s.failedCells);
    const deletedRows = useTableExplorerSelector((s) => s.deletedRows);
    const showScriptPane = useTableExplorerSelector((s) => s.showScriptPane);
    const updateScript = useTableExplorerSelector((s) => s.updateScript);
    const sqlPaneMode = useTableExplorerSelector((s) => s.sqlPaneMode);
    const tableQuery = useTableExplorerSelector((s) => s.tableQuery);
    const ownerUri = useTableExplorerSelector((s) => s.ownerUri);

    const isLoading = loadStatus === ApiStatus.Loading;

    const { beforeMount } = useMonacoSqlIntellisense(ownerUri, extensionRpc);

    const [editableQuery, setEditableQuery] = useState("");

    // Sync editableQuery when tableQuery from state changes
    useEffect(() => {
        if (tableQuery !== undefined) {
            setEditableQuery(tableQuery);
        }
    }, [tableQuery]);

    const gridRef = useRef<TableDataGridRef>(null);
    const [cellChangeCount, setCellChangeCount] = React.useState(0);
    const [deletionCount, setDeletionCount] = React.useState(0);

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
            {isLoading && !resultSet ? (
                <div className={classes.loadingContainer}>
                    <Spinner label={loc.tableExplorer.loadingTableData} labelPosition="below" />
                </div>
            ) : (
                <PanelGroup direction="vertical" className={classes.panelGroup}>
                    <Panel defaultSize={75}>
                        <div className={classes.contentArea}>
                            <TableExplorerToolbar
                                onSaveComplete={handleSaveComplete}
                                cellChangeCount={cellChangeCount}
                                deletionCount={deletionCount}
                                currentRowCount={currentRowCount}
                                onLoadSubset={context?.loadSubset}
                            />
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
                                        onDeleteRow={context?.deleteRow}
                                        onUpdateCell={context?.updateCell}
                                        onRevertCell={context?.revertCell}
                                        onRevertRow={context?.revertRow}
                                        onLoadSubset={context?.loadSubset}
                                        onCellChangeCountChanged={handleCellChangeCountChanged}
                                        onDeletionCountChanged={handleDeletionCountChanged}
                                        onSaveResults={context?.saveResults}
                                        onModifyTable={context?.modifyTable}
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
                                    value:
                                        updateScript || `-- ${loc.tableExplorer.noPendingChanges}`,
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
                                            <div className={classes.editorPane}>
                                                <VscodeEditor
                                                    height={"100%"}
                                                    width={"100%"}
                                                    language="sql"
                                                    themeKind={themeKind}
                                                    value={editableQuery}
                                                    options={{
                                                        readOnly: false,
                                                        fixedOverflowWidgets: true,
                                                    }}
                                                    onChange={(value) =>
                                                        setEditableQuery(value ?? "")
                                                    }
                                                    beforeMount={beforeMount}
                                                />
                                            </div>
                                        ),
                                        headerActions: (
                                            <Button
                                                size="small"
                                                appearance="primary"
                                                icon={<PlayRegular />}
                                                onClick={() => context.runTableQuery(editableQuery)}
                                                disabled={!editableQuery.trim() || isLoading}>
                                                {loc.tableExplorer.runQuery}
                                            </Button>
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
            )}
        </div>
    );
};
