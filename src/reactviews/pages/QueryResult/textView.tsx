/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useContext, useEffect, useState } from "react";
import { makeStyles } from "@fluentui/react-components";
import { Editor } from "@monaco-editor/react";
import { QueryResultContext } from "./queryResultStateProvider";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { resolveVscodeThemeType } from "../../common/utils";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import * as qr from "../../../sharedInterfaces/queryResult";

const useStyles = makeStyles({
    textViewContainer: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
    },
    noResults: {
        fontStyle: "italic",
        color: "var(--vscode-descriptionForeground)",
        padding: "10px",
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: "var(--vscode-editor-font-size)",
    },
});

export interface TextViewProps {
    uri?: string;
    resultSetSummaries: Record<number, Record<number, qr.ResultSetSummary>>;
    fontSettings: qr.FontSettings;
}

export const TextView: React.FC<TextViewProps> = ({ uri, resultSetSummaries, fontSettings }) => {
    const classes = useStyles();
    const context = useContext(QueryResultContext);
    const webViewState = useVscodeWebview<qr.QueryResultWebviewState, qr.QueryResultReducers>();
    const [textContent, setTextContent] = useState<string>("");
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        const generateTextView = async () => {
            if (!uri || !resultSetSummaries) {
                setLoading(false);
                return;
            }

            setLoading(true);
            let content = "";
            let resultSetNumber = 1; // Sequential numbering for result sets

            try {
                // Count total result sets for proper numbering
                let totalResultSets = 0;
                for (const batchIdStr in resultSetSummaries) {
                    totalResultSets += Object.keys(resultSetSummaries[parseInt(batchIdStr)]).length;
                }

                for (const batchIdStr in resultSetSummaries) {
                    const batchId = parseInt(batchIdStr);

                    for (const resultIdStr in resultSetSummaries[batchId]) {
                        const resultId = parseInt(resultIdStr);
                        const resultSetSummary = resultSetSummaries[batchId][resultId];

                        // Add result set header only if there are multiple result sets
                        if (totalResultSets > 1) {
                            content += `Result Set ${resultSetNumber}\n`;
                            content += "=".repeat(40) + "\n\n";
                        }

                        // Get column information
                        const columnInfo = resultSetSummary.columnInfo;
                        const columnNames = columnInfo.map((col) => col.columnName);

                        // Calculate column widths for formatting
                        const columnWidths = columnNames.map((name, index) => {
                            let maxWidth = name.length;
                            // We'll adjust this when we have the actual data
                            return Math.max(maxWidth, 10); // minimum width of 10
                        });

                        // Add column headers
                        const headerLine = columnNames
                            .map((name, index) => name.padEnd(columnWidths[index]))
                            .join("  ");
                        content += headerLine + "\n";

                        // Add separator line
                        const separatorLine = columnWidths
                            .map((width) => "-".repeat(width))
                            .join("  ");
                        content += separatorLine + "\n";

                        // Get all rows for this result set
                        if (resultSetSummary.rowCount > 0) {
                            const response = await webViewState.extensionRpc.sendRequest(
                                qr.GetRowsRequest.type,
                                {
                                    uri: uri,
                                    batchId: batchId,
                                    resultId: resultId,
                                    rowStart: 0,
                                    numberOfRows: Math.min(resultSetSummary.rowCount, 1000), // Limit to first 1000 rows for performance
                                },
                            );

                            if (response && response.rows) {
                                for (const row of response.rows) {
                                    const formattedRow = row
                                        .map((cell, index) => {
                                            const displayValue = cell.isNull
                                                ? "NULL"
                                                : cell.displayValue || "";
                                            return displayValue
                                                .toString()
                                                .padEnd(columnWidths[index]);
                                        })
                                        .join("  ");
                                    content += formattedRow + "\n";
                                }
                            }

                            content += `(${resultSetSummary.rowCount} row${resultSetSummary.rowCount === 1 ? "" : "s"} affected)\n`;
                        } else {
                            content += "(0 rows affected)\n";
                        }

                        content += "\n";
                        resultSetNumber++; // Increment for next result set
                    }
                }

                if (content.trim() === "") {
                    content = "No results to display.";
                }
            } catch (error) {
                console.error("Error generating text view:", error);
                content = "Error generating text view. Please try switching back to grid view.";
            }

            setTextContent(content);
            setLoading(false);
        };

        void generateTextView();
    }, [uri, resultSetSummaries, webViewState]);

    if (loading) {
        return <div className={classes.noResults}>Loading text view...</div>;
    }

    return (
        <div className={classes.textViewContainer}>
            {textContent ? (
                <Editor
                    height="100%"
                    language="plaintext"
                    theme={resolveVscodeThemeType(context?.themeKind || ColorThemeKind.Light)}
                    value={textContent}
                    options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "off",
                        fontFamily: fontSettings.fontFamily || "var(--vscode-editor-font-family)",
                        fontSize: fontSettings.fontSize || 12,
                        lineNumbers: "off",
                        glyphMargin: false,
                        folding: false,
                        lineDecorationsWidth: 0,
                        lineNumbersMinChars: 0,
                        renderLineHighlight: "none",
                        scrollbar: {
                            vertical: "auto",
                            horizontal: "auto",
                        },
                        automaticLayout: true,
                    }}
                />
            ) : (
                <div className={classes.noResults}>No results to display in text format.</div>
            )}
        </div>
    );
};
