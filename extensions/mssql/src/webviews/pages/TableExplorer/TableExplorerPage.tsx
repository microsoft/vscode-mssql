/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useRef, useState, useEffect, useCallback } from "react";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { TableDataGrid, TableDataGridRef } from "./TableDataGrid";
import { TableExplorerToolbar } from "./TableExplorerToolbar";
import {
    DefinitionPanel,
    DefinitionPanelCustomTab,
    DesignerDefinitionTabs,
} from "../../common/definitionPanel";
import { Button, makeStyles, shorthands, Spinner } from "@fluentui/react-components";
import { PlayRegular, StopRegular } from "@fluentui/react-icons";
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
    const isCustomQueryRunning = useTableExplorerSelector((s) => s.isCustomQueryRunning);

    const isLoading = loadStatus === ApiStatus.Loading;

    const { beforeMount, onContentChange } = useMonacoSqlIntellisense(ownerUri, extensionRpc);

    const handleEditorMount = useCallback(
        (
            editor: import("monaco-editor").editor.IStandaloneCodeEditor,
            monaco: typeof import("monaco-editor"),
        ) => {
            // Register clipboard keybindings so copy/cut/paste work in VS Code webviews
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => {
                const selection = editor.getSelection();
                const model = editor.getModel();
                if (selection && model) {
                    const text = selection.isEmpty()
                        ? model.getLineContent(selection.startLineNumber) + model.getEOL()
                        : model.getValueInRange(selection);
                    void navigator.clipboard.writeText(text);
                }
            });

            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, () => {
                const selection = editor.getSelection();
                const model = editor.getModel();
                if (selection && model) {
                    let range: import("monaco-editor").IRange;
                    let text: string;
                    if (selection.isEmpty()) {
                        const lineCount = model.getLineCount();
                        text = model.getLineContent(selection.startLineNumber) + model.getEOL();
                        range =
                            selection.startLineNumber < lineCount
                                ? {
                                      startLineNumber: selection.startLineNumber,
                                      startColumn: 1,
                                      endLineNumber: selection.startLineNumber + 1,
                                      endColumn: 1,
                                  }
                                : {
                                      startLineNumber: selection.startLineNumber,
                                      startColumn: 1,
                                      endLineNumber: selection.startLineNumber,
                                      endColumn: model.getLineMaxColumn(selection.startLineNumber),
                                  };
                    } else {
                        text = model.getValueInRange(selection);
                        range = selection;
                    }
                    void navigator.clipboard.writeText(text);
                    editor.executeEdits("cut", [{ range, text: "" }]);
                }
            });

            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, () => {
                void navigator.clipboard
                    .readText()
                    .then((text) => {
                        editor.trigger("keyboard", "type", { text });
                    })
                    .catch(() => {
                        // Swallow clipboard read failures (e.g. permission denied) so
                        // they don't surface as unhandled promise rejections.
                    });
            });

            // Handle Tab at window capture phase — this fires BEFORE document capture,
            // which is where Fluent UI's Tabster registers. Using stopImmediatePropagation
            // here prevents the event from ever reaching Tabster, so focus stays in the
            // editor and Monaco's context keys remain correct.
            const editorDomNode = editor.getDomNode();
            const tabHandler = (e: KeyboardEvent) => {
                if (e.key !== "Tab") {
                    return;
                }
                // Check suggest widget visibility first — when fixedOverflowWidgets is true,
                // Monaco renders the suggest widget in document.body (outside editorDomNode).
                // Keyboard navigation can move DOM focus into that widget, making both
                // editor.hasTextFocus() and editorDomNode.contains(activeElement) return
                // false, which would cause the guard below to exit early and let Tabster
                // steal focus instead of accepting the suggestion.
                const suggestWidget = document.querySelector(".suggest-widget");
                const isSuggestWidgetVisible =
                    suggestWidget !== null && suggestWidget.classList.contains("visible");
                const isMonacoFocused =
                    isSuggestWidgetVisible ||
                    editor.hasTextFocus() ||
                    (editorDomNode !== null &&
                        (editorDomNode?.contains(document.activeElement) ?? false));
                if (!isMonacoFocused) {
                    return;
                }

                // Stop Tabster (document capture) and the browser default from running.
                e.preventDefault();
                e.stopImmediatePropagation();

                if (isSuggestWidgetVisible) {
                    // Restore editor text focus before triggering acceptSelectedSuggestion.
                    // The textInputFocus context key must be true for the command to execute,
                    // but if the suggest widget DOM node (in document.body) has focus,
                    // that key is false. Calling editor.focus() returns focus to the
                    // textarea without dismissing the widget.
                    editor.focus();
                    editor.trigger("keyboard", "acceptSelectedSuggestion", undefined);
                } else if (e.shiftKey) {
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
                                    tableQuery={tableQuery}
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
                                                value={editableQuery}
                                                options={{
                                                    readOnly: false,
                                                    fixedOverflowWidgets: true,
                                                    tabFocusMode: false,
                                                }}
                                                onChange={(value) => {
                                                    const text = value ?? "";
                                                    setEditableQuery(text);
                                                    onContentChange(text);
                                                }}
                                                onMount={handleEditorMount}
                                                beforeMount={beforeMount}
                                            />
                                        </div>
                                    ),
                                    headerActions: (
                                        <>
                                            <Button
                                                size="small"
                                                appearance="primary"
                                                icon={<PlayRegular />}
                                                onClick={() => context.runTableQuery(editableQuery)}
                                                disabled={!editableQuery.trim() || isLoading}>
                                                {loc.tableExplorer.runQuery}
                                            </Button>
                                            <Button
                                                size="small"
                                                appearance="subtle"
                                                icon={<StopRegular />}
                                                onClick={() => context.cancelTableQuery()}
                                                disabled={!isCustomQueryRunning}>
                                                {loc.tableExplorer.cancelQuery}
                                            </Button>
                                        </>
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
