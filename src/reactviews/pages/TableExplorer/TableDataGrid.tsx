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
    themeKind?: ColorThemeKind;
}

export const TableDataGrid: React.FC<TableDataGridProps> = ({ resultSet, themeKind }) => {
    const [dataset, setDataset] = useState<any[]>([]);
    const [columns, setColumns] = useState<Column[]>([]);
    const [options, setOptions] = useState<GridOption | undefined>(undefined);
    const reactGridRef = useRef<SlickgridReactInstance | null>(null);

    function reactGridReady(reactGrid: SlickgridReactInstance) {
        reactGridRef.current = reactGrid;
    }

    // Convert resultSet data to SlickGrid format
    useEffect(() => {
        if (resultSet?.columnNames && resultSet?.subset) {
            // Create a simple row number column
            const rowNumberColumn: Column = {
                id: "rowNumber",
                name: "",
                field: "id", // Can use any existing field since formatter ignores the value
                width: 50,
                minWidth: 40,
                maxWidth: 80,
                sortable: false,
                resizable: true,
                focusable: false,
                selectable: false,
                formatter: (row: number) =>
                    `<span style="color: var(--vscode-foreground); padding: 0 8px;">${row + 1}</span>`,
            };

            // Create columns using the columnNames from resultSet
            const dataColumns: Column[] = resultSet.columnNames.map((columnName, index) => {
                return {
                    id: `col${index}`,
                    name: columnName,
                    field: `col${index}`,
                    sortable: true,
                    minWidth: 100,
                };
            });

            // Add row number column as the first column
            const allColumns = [rowNumberColumn, ...dataColumns];
            setColumns(allColumns);

            // Convert rows to dataset
            const convertedDataset = resultSet.subset.map((row, rowIndex) => {
                const dataRow: any = {
                    id: rowIndex,
                };
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
    }, [resultSet, themeKind]);

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
