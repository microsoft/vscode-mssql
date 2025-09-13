/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";

export const useAccordionStyles = makeStyles({
    accordionItem: {
        border: "0.5px solid var(--vscode-editorWidget-border)",
        borderRadius: "2px",
        margin: "10px",
    },
});

export const useMarkdownStyles = makeStyles({
    markdownPage: {
        backgroundColor: "var(--vscode-editorWidget-background)",
        border: "1px solid var(--vscode-panel-border)",
        borderRadius: "8px",
        padding: "24px 32px",
        margin: "16px",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: "14px",
        lineHeight: "1.6",
        color: "var(--vscode-editor-foreground)",
        "& h1, & h2, & h3, & h4, & h5, & h6": {
            color: "var(--vscode-textPreformat-foreground)",
            borderBottom: "1px solid var(--vscode-panel-border)",
            paddingBottom: "8px",
            marginTop: "24px",
            marginBottom: "16px",
        },
        "& h1": {
            fontSize: "24px",
            fontWeight: "600",
        },
        "& h2": {
            fontSize: "20px",
            fontWeight: "600",
        },
        "& h3": {
            fontSize: "16px",
            fontWeight: "600",
        },
        "& p": {
            marginBottom: "16px",
        },
        "& ul, & ol": {
            marginBottom: "16px",
            paddingLeft: "24px",
        },
        "& li": {
            marginBottom: "8px",
        },
        "& code": {
            backgroundColor: "var(--vscode-textBlockQuote-background)",
            border: "1px solid var(--vscode-panel-border)",
            borderRadius: "4px",
            padding: "2px 6px",
            fontSize: "13px",
            fontFamily: "var(--vscode-editor-font-family)",
        },
        "& pre": {
            backgroundColor: "var(--vscode-textBlockQuote-background)",
            border: "1px solid var(--vscode-panel-border)",
            borderRadius: "6px",
            padding: "16px",
            marginBottom: "16px",
            overflow: "auto",
            "& code": {
                backgroundColor: "transparent",
                border: "none",
                padding: "0",
            },
        },
        "& blockquote": {
            borderLeft: "4px solid var(--vscode-textBlockQuote-border)",
            paddingLeft: "16px",
            marginLeft: "0",
            fontStyle: "italic",
            color: "var(--vscode-descriptionForeground)",
        },
        "& table": {
            width: "100%",
            borderCollapse: "collapse",
            marginBottom: "16px",
            "& th, & td": {
                border: "1px solid var(--vscode-panel-border)",
                padding: "8px 12px",
                textAlign: "left",
            },
            "& th": {
                backgroundColor: "var(--vscode-editor-background)",
                fontWeight: "600",
            },
        },
    },
});
