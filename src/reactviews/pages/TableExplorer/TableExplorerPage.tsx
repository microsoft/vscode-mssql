/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useRef } from "react";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { TableDataGrid, TableDataGridRef } from "./TableDataGrid";
import { TableExplorerToolbar } from "./TableExplorerToolbar";
import {
    DesignerDefinitionPane,
    DesignerDefinitionTabs,
} from "../../common/designerDefinitionPane";
import { makeStyles, shorthands, Spinner } from "@fluentui/react-components";
import { locConstants as loc } from "../../common/locConstants";
import { useTableExplorerSelector } from "./tableExplorerSelector";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ApiStatus } from "../../../sharedInterfaces/webview";

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
        ...shorthands.overflow("auto"),
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
    const { themeKind } = useVscodeWebview2();

    // Use selectors to access specific state properties
    const resultSet = useTableExplorerSelector((s) => s.resultSet);
    const loadStatus = useTableExplorerSelector((s) => s.loadStatus);
    const currentRowCount = useTableExplorerSelector((s) => s.currentRowCount);
    const failedCells = useTableExplorerSelector((s) => s.failedCells);
    const showScriptPane = useTableExplorerSelector((s) => s.showScriptPane);
    const updateScript = useTableExplorerSelector((s) => s.updateScript);

    const isLoading = loadStatus === ApiStatus.Loading;

    const gridRef = useRef<TableDataGridRef>(null);
    const [cellChangeCount, setCellChangeCount] = React.useState(0);
    const [deletionCount, setDeletionCount] = React.useState(0);

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
                            />
                            {resultSet ? (
                                <div className={classes.dataGridContainer}>
                                    {isLoading ? (
                                        <div className={classes.loadingContainer}>
                                            <Spinner
                                                label={loc.tableExplorer.loadingTableData}
                                                labelPosition="below"
                                            />
                                        </div>
                                    ) : (
                                        <TableDataGrid
                                            ref={gridRef}
                                            resultSet={resultSet}
                                            themeKind={themeKind}
                                            pageSize={10}
                                            currentRowCount={currentRowCount}
                                            failedCells={failedCells}
                                            onDeleteRow={context?.deleteRow}
                                            onUpdateCell={context?.updateCell}
                                            onRevertCell={context?.revertCell}
                                            onRevertRow={context?.revertRow}
                                            onLoadSubset={context?.loadSubset}
                                            onCellChangeCountChanged={handleCellChangeCountChanged}
                                            onDeletionCountChanged={handleDeletionCountChanged}
                                        />
                                    )}
                                </div>
                            ) : (
                                <p>{loc.tableExplorer.noDataAvailable}</p>
                            )}
                        </div>
                    </Panel>
                    {showScriptPane && (
                        <>
                            <PanelResizeHandle className={classes.resizeHandle} />
                            <DesignerDefinitionPane
                                script={updateScript || `-- ${loc.tableExplorer.noPendingChanges}`}
                                themeKind={themeKind}
                                openInEditor={() => context.openScriptInEditor()}
                                copyToClipboard={() => context.copyScriptToClipboard()}
                                activeTab={DesignerDefinitionTabs.Script}
                                onClose={() => context.toggleScriptPane()}
                            />
                        </>
                    )}
                </PanelGroup>
            )}
        </div>
    );
};
