/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, shorthands, tokens } from "@fluentui/react-components";

export const useStyles = makeStyles({
    container: {
        display: "flex",
        height: "400px",
        width: "100%",
        ...shorthands.gap("10px"),
        overflow: "hidden",
        marginTop: "10px",
    },
    workspaceExplorer: {
        display: "flex",
        flexDirection: "column",
        width: "160px",
        minWidth: "160px",
        height: "100%",
        borderRight: "1px solid var(--vscode-panel-border)",
        transition: "width 0.2s ease-in-out",
        overflow: "hidden",
        backgroundColor: "var(--vscode-sideBar-background)",
    },
    workspaceExplorerCollapsed: {
        width: "28px",
        minWidth: "28px",
        ...shorthands.overflow("visible"),
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: "4px",
        borderRight: "1px solid var(--vscode-panel-border)",
        backgroundColor: "var(--vscode-sideBar-background)",
    },
    workspaceGrid: {
        flexGrow: 1,
        overflow: "auto",
        ...shorthands.padding("8px", "8px", "16px", "8px"),
        height: "100%",
        display: "flex",
        flexDirection: "column",
    },
    workspaceTitle: {
        fontSize: "13px",
        fontWeight: "600",
        marginBottom: "8px",
        paddingLeft: "8px",
        paddingTop: "4px",
        paddingRight: "4px",
        flexShrink: 0,
    },
    workspaceListContainer: {
        flexGrow: 1,
        overflow: "auto",
        paddingLeft: "4px",
        paddingRight: "4px",
    },
    workspaceHeader: {
        flexShrink: 0,
        paddingTop: "4px",
        paddingLeft: "4px",
        paddingRight: "4px",
    },
    workspaceSearchBox: {
        marginTop: "4px",
        marginBottom: "8px",
        paddingLeft: "4px",
        paddingRight: "4px",
    },
    workspaceItem: {
        ...shorthands.padding("4px", "8px", "4px", "24px"),
        cursor: "pointer",
        borderRadius: "2px",
        marginBottom: "1px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontSize: "13px",
        height: "24px",
        lineHeight: "24px",
        position: "relative",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
    },
    workspaceItemSelected: {
        backgroundColor: tokens.colorSubtleBackgroundSelected,
        color: "var(--vscode-list-activeSelectionForeground)",
        fontWeight: "600",
        "@media (forced-colors:active)": {
            background: "Highlight",
            color: "HighlightText",
        },
        "&:hover": {
            backgroundColor: tokens.colorSubtleBackgroundSelected,
        },
    },
    collapseButton: {
        width: "calc(100% - 5px)",
        height: "24px",
        marginBottom: "8px",
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingLeft: "5px",
    },
    collapseButtonIcon: {
        fontSize: "12px",
    },
    collapsedExplorerButton: {
        width: "24px",
        height: "24px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        margin: "0 auto",
    },
    headerRow: {
        backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
        height: "22px",
        minHeight: "22px",
        maxHeight: "22px",
    },
    tableRow: {
        height: "22px",
        minHeight: "22px",
        maxHeight: "22px",
        cursor: "pointer",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
        "&:nth-child(odd)": {
            backgroundColor: "rgba(0, 0, 0, 0.1)",
        },
    },
    selectedDataGridRow: {
        backgroundColor: "var(--vscode-list-activeSelectionBackground)",
        color: "var(--vscode-list-activeSelectionForeground)",
        "&:hover": {
            backgroundColor: "var(--vscode-list-activeSelectionBackground)",
        },
    },
});
