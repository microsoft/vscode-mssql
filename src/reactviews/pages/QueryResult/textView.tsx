/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useContext, useEffect, useState } from "react";
import { makeStyles } from "@fluentui/react-components";
import { QueryResultContext } from "./queryResultStateProvider";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import * as qr from "../../../sharedInterfaces/queryResult";

const useStyles = makeStyles({
    textViewContainer: {
        width: "100%",
        height: "100%",
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: "var(--vscode-editor-font-size)",
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-editor-foreground)",
        padding: "10px",
        overflow: "auto",
        whiteSpace: "pre-wrap",
        lineHeight: "1.3",
    },
    resultSetHeader: {
        fontWeight: "bold",
        marginBottom: "8px",
        marginTop: "16px",
        borderBottom: "1px solid var(--vscode-panel-border)",
        paddingBottom: "4px",
    },
    resultSetContent: {
        marginBottom: "16px",
    },
    noResults: {
        fontStyle: "italic",
        color: "var(--vscode-descriptionForeground)",
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

            try {
                for (const batchIdStr in resultSetSummaries) {
                    const batchId = parseInt(batchIdStr);

                    for (const resultIdStr in resultSetSummaries[batchId]) {
                        const resultId = parseInt(resultIdStr);
                        const resultSetSummary = resultSetSummaries[batchId][resultId];

                        // Add result set header
                        if (
                            Object.keys(resultSetSummaries).length > 1 ||
                            Object.keys(resultSetSummaries[batchId]).length > 1
                        ) {
                            content += `Result Set ${batchId + 1}.${resultId + 1}\n`;
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
                        } else {
                            content += "(0 rows affected)\n";
                        }

                        content += "\n";
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
        return <div className={classes.textViewContainer}>Loading text view...</div>;
    }

    return (
        <div
            className={classes.textViewContainer}
            style={{
                fontFamily: fontSettings.fontFamily || "var(--vscode-editor-font-family)",
                fontSize: `${fontSettings.fontSize || 12}px`,
            }}>
            {textContent || (
                <div className={classes.noResults}>No results to display in text format.</div>
            )}
        </div>
    );
};
