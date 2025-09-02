/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useContext, useEffect, useState } from "react";
import { makeStyles } from "@fluentui/react-components";
import { Editor } from "@monaco-editor/react";
import { resolveVscodeThemeType } from "../../common/utils";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import * as qr from "../../../sharedInterfaces/queryResult";
import { locConstants } from "../../common/locConstants";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";

const useStyles = makeStyles({
    textViewContainer: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
    },
    editorContainer: {
        width: "100%",
        height: "100%",
        flex: 1,
        minHeight: "400px",
    },
    noResults: {
        fontStyle: "italic",
        color: "var(--vscode-descriptionForeground)",
        padding: "10px",
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: "var(--vscode-editor-font-size)",
        width: "100%",
        height: "100%",
        flex: 1,
    },
});

export interface TextViewProps {
    uri?: string;
    resultSetSummaries?: { [batchId: number]: { [resultId: number]: qr.ResultSetSummary } };
    fontSettings: qr.FontSettings;
}

export const TextView: React.FC<TextViewProps> = ({ uri, resultSetSummaries, fontSettings }) => {
    const classes = useStyles();
    const context = useContext(QueryResultCommandsContext);
    const [textContent, setTextContent] = useState<string>("");
    const [loading, setLoading] = useState<boolean>(true);
    const { themeKind, EOL } = useVscodeWebview2<
        qr.QueryResultWebviewState,
        qr.QueryResultReducers
    >();

    useEffect(() => {
        const generateTextView = async () => {
            if (!uri || !resultSetSummaries || Object.keys(resultSetSummaries).length === 0) {
                setLoading(false);
                return;
            }

            setLoading(true);
            let content = "";

            try {
                // Process all result sets
                for (const batchIdStr in resultSetSummaries) {
                    const batchId = parseInt(batchIdStr);
                    const batch = resultSetSummaries[batchId];

                    if (!batch) continue;

                    for (const resultIdStr in batch) {
                        const resultId = parseInt(resultIdStr);
                        const resultSetSummary = batch[resultId];

                        // Skip if resultSetSummary is not valid or doesn't have column info
                        if (
                            !resultSetSummary ||
                            !resultSetSummary.columnInfo ||
                            !Array.isArray(resultSetSummary.columnInfo)
                        ) {
                            continue;
                        }

                        // Get column information
                        const columnInfo = resultSetSummary.columnInfo;
                        const columnNames = columnInfo.map((col) => col?.columnName || "");

                        // Initialize column widths with column name lengths
                        const columnWidths = columnNames.map((name) => name.length);

                        let formattedRows: string[] = [];

                        const resultIdentifier = `${batchId}-${resultId}`;

                        content += `${locConstants.queryResult.resultSet(resultIdentifier)}${EOL}`;
                        content += "=".repeat(40) + `${EOL}${EOL}`;

                        // Get all rows for this result set first to calculate proper column widths
                        if (resultSetSummary.rowCount > 0) {
                            const response = await context?.extensionRpc.sendRequest(
                                qr.GetRowsRequest.type,
                                {
                                    uri: uri,
                                    batchId: batchId,
                                    resultId: resultId,
                                    rowStart: 0,
                                    numberOfRows: resultSetSummary.rowCount,
                                },
                            );

                            if (response && response.rows) {
                                // Calculate proper column widths by considering all data values
                                for (const row of response.rows) {
                                    row.forEach((cell, index) => {
                                        const displayValue = cell.isNull
                                            ? "NULL"
                                            : cell.displayValue || "";
                                        const valueLength = displayValue.toString().length;
                                        columnWidths[index] = Math.max(
                                            columnWidths[index],
                                            valueLength,
                                        );
                                    });
                                }

                                // Apply minimum width of 10 to each column
                                for (let i = 0; i < columnWidths.length; i++) {
                                    columnWidths[i] = Math.max(columnWidths[i], 10);
                                }

                                // Format all data rows with proper column widths
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
                                    formattedRows.push(formattedRow);
                                }
                            }
                        } else {
                            // Apply minimum width of 10 to each column even with no data
                            for (let i = 0; i < columnWidths.length; i++) {
                                columnWidths[i] = Math.max(columnWidths[i], 10);
                            }
                        }

                        // Add column headers with proper alignment
                        const headerLine = columnNames
                            .map((name, index) => name.padEnd(columnWidths[index]))
                            .join("  ");
                        content += `${headerLine}${EOL}`;

                        // Add separator line
                        const separatorLine = columnWidths
                            .map((width) => "-".repeat(width))
                            .join("  ");
                        content += `${separatorLine}${EOL}`;

                        // Add the formatted data rows
                        for (const formattedRow of formattedRows) {
                            content += `${formattedRow}${EOL}`;
                        }

                        // Add row count information
                        if (resultSetSummary.rowCount > 0) {
                            content += `(${locConstants.queryResult.rowsAffected(resultSetSummary.rowCount)})${EOL}`;
                        } else {
                            content += `(${locConstants.queryResult.rowsAffected(0)})${EOL}`;
                        }

                        content += `${EOL}`;
                    }
                }

                if (content.trim() === "") {
                    content = locConstants.queryResult.noResultsToDisplay;
                }
            } catch (error) {
                content = locConstants.queryResult.errorGeneratingTextView;
                context?.log(`Error generating text view: ${error}`, "error");
            }

            setTextContent(content);
            setLoading(false);
        };

        void generateTextView();
    }, [uri, resultSetSummaries]);

    if (loading) {
        return <div className={classes.noResults}>{locConstants.queryResult.loadingTextView}</div>;
    }

    return (
        <div className={classes.textViewContainer}>
            {textContent ? (
                <div className={classes.editorContainer}>
                    <Editor
                        width="100%"
                        height="100%"
                        language="plaintext"
                        theme={resolveVscodeThemeType(themeKind || ColorThemeKind.Light)}
                        value={textContent}
                        options={{
                            readOnly: true,
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            wordWrap: "off",
                            fontFamily:
                                fontSettings.fontFamily || "var(--vscode-editor-font-family)",
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
                </div>
            ) : (
                <div className={classes.noResults}>
                    {locConstants.queryResult.noResultsToDisplay}
                </div>
            )}
        </div>
    );
};
