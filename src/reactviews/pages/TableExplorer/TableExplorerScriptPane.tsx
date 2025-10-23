/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, shorthands } from "@fluentui/react-components";
import { ChevronDownFilled, ChevronUpFilled, CopyFilled, OpenFilled } from "@fluentui/react-icons";
import Editor from "@monaco-editor/react";
import { useTableExplorerContext } from "./TableExplorerStateProvider";
import { resolveVscodeThemeType } from "../../common/utils";
import { useState } from "react";
import { locConstants as loc } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderTop: "1px solid var(--vscode-editorWidget-border)",
    },
    toolbar: {
        width: "99vw",
        display: "flex",
        flexDirection: "row",
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
    const state = context?.state;
    const [isMaximized, setIsMaximized] = useState(false);

    if (!state?.showScriptPane) {
        return null;
    }

    const scriptContent =
        state.updateScript || "-- No pending changes. Make edits to generate a script.";

    // Debug logging
    console.log("TableExplorerScriptPane - showScriptPane:", state.showScriptPane);
    console.log("TableExplorerScriptPane - updateScript:", state.updateScript);
    console.log("TableExplorerScriptPane - scriptContent:", scriptContent);

    return (
        <div
            className={classes.root}
            style={{
                height: isMaximized ? "70vh" : "300px",
                minHeight: isMaximized ? "70vh" : "150px",
            }}>
            <div className={classes.toolbar}>
                <span className={classes.title}>{loc.tableExplorer.updateScript}</span>
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
                    appearance="transparent"
                    onClick={() => setIsMaximized(!isMaximized)}
                    title={
                        isMaximized
                            ? loc.tableExplorer.restorePanelSize
                            : loc.tableExplorer.maximizePanelSize
                    }
                    icon={isMaximized ? <ChevronDownFilled /> : <ChevronUpFilled />}
                />
            </div>
            <div className={classes.editorContainer}>
                <Editor
                    height="100%"
                    width="100%"
                    language="sql"
                    theme={resolveVscodeThemeType(context?.themeKind)}
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
        </div>
    );
};
