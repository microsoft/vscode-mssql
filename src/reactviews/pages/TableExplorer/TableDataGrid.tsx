/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useEffect, useRef } from "react";
import {
    SlickgridReactInstance,
    Column,
    GridOption,
    SlickgridReact,
    EditCommand,
    Editors,
} from "slickgrid-react";
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
    const [commandQueue] = useState<EditCommand[]>([]);

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
                field: "id",
                excludeFromColumnPicker: true,
                excludeFromGridMenu: true,
                excludeFromHeaderMenu: true,
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
                    editor: {
                        model: Editors.text,
                    },
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
                autoEdit: false,
                autoCommitEdit: false,
                editable: true,
                enableAutoResize: true,
                gridHeight: 400,
                enableCellNavigation: true,
                enableSorting: true,
                editCommandHandler: (_item, _column, editCommand) => {
                    commandQueue.push(editCommand);
                    editCommand.execute();
                },
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
