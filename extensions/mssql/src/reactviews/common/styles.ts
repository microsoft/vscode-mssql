/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from "@fluentui/react-components";

export const useAccordionStyles = makeStyles({
    accordionItem: {
        border: "0.5px solid var(--vscode-editorWidget-border)",
        borderRadius: "2px",
        margin: "10px",
    },
});

/**
 * Compact menu item styles for context menus.
 */
export const useContextMenuStyles = makeStyles({
    menuItem: {
        minHeight: "24px",
        height: "24px",
        padding: "0 8px",
        fontSize: tokens.fontSizeBase200,
        display: "flex",
        alignItems: "center",
        lineHeight: "24px",
    },
});

/**
 * Adds markdown styles to make markdown content more readable.
 */
export const useMarkdownStyles = makeStyles({
    markdownPage: {
        backgroundColor: "var(--vscode-editorWidget-background)",
        border: "1px solid var(--vscode-panel-border)",
        borderRadius: "8px",
        padding: "12px 16px",
        margin: "8px",
        boxShadow: "0 1px 4px rgba(0, 0, 0, 0.1)",
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: "14px",
        lineHeight: "1.4",
        color: "var(--vscode-editor-foreground)",
        "& h1, & h2, & h3, & h4, & h5, & h6": {
            color: "var(--vscode-textPreformat-foreground)",
            borderBottom: "1px solid var(--vscode-panel-border)",
            paddingBottom: "4px",
            marginTop: "12px",
            marginBottom: "8px",
        },
        "& h1": {
            fontSize: "22px",
            fontWeight: "600",
        },
        "& h2": {
            fontSize: "18px",
            fontWeight: "600",
        },
        "& h3": {
            fontSize: "16px",
            fontWeight: "600",
        },
        "& p": {
            marginBottom: "8px",
        },
        "& ul, & ol": {
            marginBottom: "8px",
            paddingLeft: "18px",
        },
        "& li": {
            marginBottom: "4px",
        },
        "& code": {
            backgroundColor: "var(--vscode-textBlockQuote-background)",
            border: "1px solid var(--vscode-panel-border)",
            borderRadius: "3px",
            padding: "1px 4px",
            fontSize: "13px",
            fontFamily: "var(--vscode-editor-font-family)",
        },
        "& pre": {
            backgroundColor: "var(--vscode-textBlockQuote-background)",
            border: "1px solid var(--vscode-panel-border)",
            borderRadius: "4px",
            padding: "10px",
            marginBottom: "8px",
            overflow: "auto",
            "& code": {
                backgroundColor: "transparent",
                border: "none",
                padding: "0",
            },
        },
        "& blockquote": {
            borderLeft: "3px solid var(--vscode-textBlockQuote-border)",
            paddingLeft: "12px",
            marginLeft: "0",
            fontStyle: "italic",
            color: "var(--vscode-descriptionForeground)",
        },
        "& table": {
            width: "100%",
            borderCollapse: "collapse",
            marginBottom: "8px",
            "& th, & td": {
                border: "1px solid var(--vscode-panel-border)",
                padding: "6px 8px",
                textAlign: "left",
            },
            "& th": {
                backgroundColor: "var(--vscode-editor-background)",
                fontWeight: "600",
            },
        },
    },
});
