/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useEffect, useRef } from "react";
import { SlickgridReactInstance, Column, GridOption, SlickgridReact } from "slickgrid-react";
import { EditSubsetResult } from "../../../sharedInterfaces/tableExplorer";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import "@slickgrid-universal/common/dist/styles/css/slickgrid-theme-default.css";

interface TableDataGridProps {
    resultSet: EditSubsetResult | undefined;
    tableMetadata?: any;
    tableName?: string;
    schemaName?: string;
    themeKind?: ColorThemeKind;
}

export const TableDataGrid: React.FC<TableDataGridProps> = ({
    resultSet,
    tableMetadata,
    tableName,
    schemaName,
    themeKind,
}) => {
    const [dataset, setDataset] = useState<any[]>([]);
    const [columns, setColumns] = useState<Column[]>([]);
    const [options, setOptions] = useState<GridOption | undefined>(undefined);
    const reactGridRef = useRef<SlickgridReactInstance | null>(null);

    function reactGridReady(reactGrid: SlickgridReactInstance) {
        reactGridRef.current = reactGrid;
    }

    // Convert resultSet data to SlickGrid format
    useEffect(() => {
        if (resultSet?.subset) {
            // Debug: Log available metadata
            console.log("Table metadata:", tableMetadata);

            // Create columns based on the number of cells in the first row
            const firstRow = resultSet.subset[0];
            if (firstRow?.cells) {
                const generatedColumns: Column[] = firstRow.cells.map((cell, index) => {
                    // Try to get column name from metadata if available
                    let columnName = `Column ${index + 1}`;

                    // Check if we have table metadata with column information
                    if (tableMetadata?.columnInfo && Array.isArray(tableMetadata.columnInfo)) {
                        const columnInfo = tableMetadata.columnInfo[index];
                        if (columnInfo?.columnName) {
                            columnName = columnInfo.columnName;
                        }
                    }
                    // Alternative check for different metadata structure
                    else if (tableMetadata?.columns && Array.isArray(tableMetadata.columns)) {
                        const columnInfo = tableMetadata.columns[index];
                        if (columnInfo?.name) {
                            columnName = columnInfo.name;
                        } else if (columnInfo?.columnName) {
                            columnName = columnInfo.columnName;
                        }
                    }
                    // Check if metadata is directly on the result set (might be provided by backend)
                    // else if (resultSet?.columnInfo && Array.isArray(resultSet.columnInfo)) {
                    //     const columnInfo = resultSet.columnInfo[index];
                    //     if (columnInfo?.columnName) {
                    //         columnName = columnInfo.columnName;
                    //     }
                    // }

                    // If we have table info, try to create better fallback names
                    else if (tableName && schemaName) {
                        // Create a more descriptive column name based on data type inference
                        const displayValue = cell.displayValue;
                        if (displayValue !== null && displayValue !== "") {
                            // Try to infer data type from the first value
                            if (!isNaN(Number(displayValue)) && !displayValue.includes(".")) {
                                columnName = `${tableName}_Id_${index + 1}`;
                            } else if (!isNaN(Number(displayValue))) {
                                columnName = `${tableName}_Number_${index + 1}`;
                            } else if (displayValue.match(/^\d{4}-\d{2}-\d{2}/)) {
                                columnName = `${tableName}_Date_${index + 1}`;
                            } else {
                                columnName = `${tableName}_Text_${index + 1}`;
                            }
                        } else {
                            columnName = `${tableName}_Col_${index + 1}`;
                        }
                    }

                    return {
                        id: `col${index}`,
                        name: columnName,
                        field: `col${index}`,
                        sortable: true,
                        minWidth: 100,
                    };
                });
                setColumns(generatedColumns);
            }

            // Convert rows to dataset
            const convertedDataset = resultSet.subset.map((row, rowIndex) => {
                const dataRow: any = { id: rowIndex };
                row.cells.forEach((cell, cellIndex) => {
                    dataRow[`col${cellIndex}`] = cell.displayValue;
                });
                return dataRow;
            });
            setDataset(convertedDataset);

            // Set grid options
            setOptions({
                enableAutoResize: true,
                gridHeight: 400,
                enableSorting: true,
                darkMode:
                    themeKind === ColorThemeKind.Dark || themeKind === ColorThemeKind.HighContrast,
            });
        }
    }, [resultSet, tableMetadata, themeKind]);

    if (!resultSet || columns.length === 0 || !options) {
        return null;
    }

    const isDarkMode =
        themeKind === ColorThemeKind.Dark || themeKind === ColorThemeKind.HighContrast;

    return (
        <div className={`table-explorer-grid-container ${isDarkMode ? "dark-mode" : ""}`}>
            <SlickgridReact
                gridId="tableExplorerGrid"
                columns={columns}
                options={options}
                dataset={dataset}
                onReactGridCreated={($event) => reactGridReady($event.detail)}
            />
        </div>
    );
};
