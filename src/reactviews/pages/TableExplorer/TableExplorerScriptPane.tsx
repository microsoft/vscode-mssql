/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, shorthands } from "@fluentui/react-components";
import {
    ChevronDown12Filled,
    ChevronUp12Filled,
    CopyFilled,
    Dismiss12Regular,
    OpenFilled,
} from "@fluentui/react-icons";
import Editor from "@monaco-editor/react";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { resolveVscodeThemeType } from "../../common/utils";
import { useState, useRef, ReactElement } from "react";
import { locConstants as loc } from "../../common/locConstants";
import { useTableExplorerSelector } from "./tableExplorerSelector";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { ImperativePanelHandle, Panel } from "react-resizable-panels";

const DEFAULT_PANEL_SIZE = 25;
const MINIMUM_PANEL_SIZE = 10;
const MAXIMUM_PANEL_SIZE = 100;

const useStyles = makeStyles({
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "5px 10px",
        gap: "10px",
        backgroundColor: "var(--vscode-editor-background)",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
    },
    title: {
        flex: 1,
        fontWeight: 600,
        fontSize: "12px",
        color: "var(--vscode-foreground)",
    },
    toolbar: {
        display: "flex",
        gap: "3px",
    },
    editorContainer: {
        ...shorthands.flex(1),
        width: "100%",
        height: "100%",
        position: "relative",
        ...shorthands.overflow("hidden"),
    },
});

export const TableExplorerScriptPane: React.FC = () => {
    const classes = useStyles();
    const context = useTableExplorerContext();
    const { themeKind } = useVscodeWebview2();

    // Use selectors to access state
    const updateScript = useTableExplorerSelector((s) => s.updateScript);

    const panelRef = useRef<ImperativePanelHandle>(null);
    const [expandCollapseButtonLabel, setExpandCollapseButtonLabel] = useState<string>(
        loc.tableExplorer.maximizePanelSize,
    );
    const [expandCollapseButtonIcon, setExpandCollapseButtonIcon] = useState<ReactElement>(
        <ChevronUp12Filled />,
    );

    const scriptContent = updateScript || `-- ${loc.tableExplorer.noPendingChanges}`;

    return (
        <Panel
            collapsible
            minSize={MINIMUM_PANEL_SIZE}
            defaultSize={DEFAULT_PANEL_SIZE}
            ref={panelRef}
            onResize={(size) => {
                if (size >= MAXIMUM_PANEL_SIZE - 1) {
                    setExpandCollapseButtonLabel(loc.tableExplorer.restorePanelSize);
                    setExpandCollapseButtonIcon(<ChevronDown12Filled />);
                } else {
                    setExpandCollapseButtonLabel(loc.tableExplorer.maximizePanelSize);
                    setExpandCollapseButtonIcon(<ChevronUp12Filled />);
                }
            }}>
            <div className={classes.header}>
                <span className={classes.title}>{loc.tableExplorer.updateScript}</span>
                <div className={classes.toolbar}>
                    <Button
                        size="small"
                        appearance="subtle"
                        onClick={() => context.openScriptInEditor()}
                        title={loc.tableExplorer.openInSqlEditor}
                        icon={<OpenFilled />}>
                        {loc.tableExplorer.openInEditor}
                    </Button>
                    <Button
                        size="small"
                        appearance="subtle"
                        onClick={() => context.copyScriptToClipboard()}
                        title={loc.tableExplorer.copyScriptToClipboard}
                        icon={<CopyFilled />}>
                        {loc.tableExplorer.copyScript}
                    </Button>
                    <Button
                        size="small"
                        appearance="subtle"
                        onClick={() => {
                            const currentSize = panelRef.current?.getSize();
                            if (currentSize && currentSize >= MAXIMUM_PANEL_SIZE - 1) {
                                panelRef.current?.resize(DEFAULT_PANEL_SIZE);
                                setExpandCollapseButtonLabel(loc.tableExplorer.maximizePanelSize);
                                setExpandCollapseButtonIcon(<ChevronUp12Filled />);
                            } else {
                                panelRef.current?.resize(MAXIMUM_PANEL_SIZE);
                                setExpandCollapseButtonLabel(loc.tableExplorer.restorePanelSize);
                                setExpandCollapseButtonIcon(<ChevronDown12Filled />);
                            }
                        }}
                        title={expandCollapseButtonLabel}
                        icon={expandCollapseButtonIcon}
                    />
                    <Button
                        size="small"
                        appearance="subtle"
                        onClick={() => context.toggleScriptPane()}
                        title={loc.tableExplorer.closeScriptPane}
                        icon={<Dismiss12Regular />}
                    />
                </div>
            </div>
            <div className={classes.editorContainer}>
                <Editor
                    height="100%"
                    width="100%"
                    language="sql"
                    theme={resolveVscodeThemeType(themeKind)}
                    value={scriptContent}
                    options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 13,
                        lineNumbers: "on",
                        renderLineHighlight: "none",
                        automaticLayout: true,
                    }}
                />
            </div>
        </Panel>
    );
};
