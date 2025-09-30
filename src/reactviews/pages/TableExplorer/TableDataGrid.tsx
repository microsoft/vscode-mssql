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
    const cellChangesRef = useRef<Map<string, any>>(new Map());

    function reactGridReady(reactGrid: SlickgridReactInstance) {
        reactGridRef.current = reactGrid;
    }

    function handleCellChange(_e: CustomEvent, args: any) {
        const rowIndex = args.row;
        const cellIndex = args.cell; // The actual cell index in the grid
        const columnIndex = cellIndex - 1; // -1 because first column is row number
        const column = columns[cellIndex]; // Use cellIndex to get the correct column

        console.log(
            `Cell Changed - Row: ${rowIndex}, Cell: ${cellIndex}, Column Index: ${columnIndex}`,
        );
        console.log(`Column ID: ${column?.id}, Field: ${column?.field}`);
        console.log(`New Value: ${args.item[column?.field]}`);

        // Store the change with a unique key (row-columnIndex)
        // Use columnIndex (which excludes row number column) for consistency with formatter
        const changeKey = `${rowIndex}-${columnIndex}`;
        cellChangesRef.current.set(changeKey, {
            rowIndex,
            columnIndex,
            columnId: column?.id,
            field: column?.field,
            newValue: args.item[column?.field],
            item: args.item,
        });

        console.log(`Total changes tracked: ${cellChangesRef.current.size}`);

        // Force grid to re-render to show background color change
        if (reactGridRef.current?.slickGrid) {
            reactGridRef.current.slickGrid.invalidate();
            reactGridRef.current.slickGrid.render();
        }
    }

    // Convert resultSet data to SlickGrid format (initial setup)
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
                    formatter: (row: number, cell: number, value: any) => {
                        // The first column is row number, so data columns start at cell 1
                        const changeKey = `${row}-${cell - 1}`;
                        const isModified = cellChangesRef.current.has(changeKey);
                        if (isModified) {
                            return `<div style="background-color: var(--vscode-inputValidation-warningBackground, #fffbe6); padding: 2px 4px; height: 100%;">${value ?? ""}</div>`;
                        }
                        return value ?? "";
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
                    // Add to command queue for undo functionality
                    commandQueue.push(editCommand);
                    editCommand.execute();
                },
                darkMode:
                    themeKind === ColorThemeKind.Dark || themeKind === ColorThemeKind.HighContrast,
            });
        }
    }, [resultSet, themeKind, commandQueue]);

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
                onCellChange={($event) => handleCellChange($event, $event.detail.args)}
            />
        </div>
    );
};
