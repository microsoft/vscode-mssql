/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createTableColumn,
    DataGrid,
    DataGridBody,
    DataGridCell,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridRow,
    makeStyles,
    TableColumnDefinition,
    TableColumnSizingOptions,
} from "@fluentui/react-components";
import { ReactNode, useMemo } from "react";

const useStyles = makeStyles({
    grid: {
        width: "100%",
        minWidth: 0,
    },
    numeric: {
        justifyContent: "flex-end",
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
    },
});

export interface SimpleGridColumn<T> {
    readonly id: string;
    readonly header: string;
    readonly render: (item: T) => ReactNode;
    /** Sorts the column. Without it, the column does not sort. */
    readonly compare?: (left: T, right: T) => number;
    readonly numeric?: boolean;
    readonly minWidth?: number;
    readonly idealWidth?: number;
}

export interface SimpleGridProps<T> {
    readonly items: readonly T[];
    readonly columns: readonly SimpleGridColumn<T>[];
    readonly getRowId: (item: T) => string;
    readonly ariaLabel: string;
    readonly rowClassName?: (item: T) => string | undefined;
}

/** A small Fluent data grid for lists that do not need virtualization. */
export function SimpleGrid<T>({
    items,
    columns,
    getRowId,
    ariaLabel,
    rowClassName,
}: SimpleGridProps<T>) {
    const classes = useStyles();
    const definitions = useMemo<TableColumnDefinition<T>[]>(
        () =>
            columns.map((column) =>
                createTableColumn<T>({
                    columnId: column.id,
                    compare: column.compare ?? (() => 0),
                    renderHeaderCell: () => column.header,
                    renderCell: column.render,
                }),
            ),
        [columns],
    );
    const sizing = useMemo<TableColumnSizingOptions>(
        () =>
            Object.fromEntries(
                columns.map((column) => [
                    column.id,
                    { minWidth: column.minWidth ?? 80, idealWidth: column.idealWidth ?? 140 },
                ]),
            ),
        [columns],
    );
    const numericIds = new Set(
        columns.filter((column) => column.numeric).map((column) => column.id),
    );
    const sortable = columns.some((column) => column.compare);

    return (
        <DataGrid
            className={classes.grid}
            items={[...items]}
            columns={definitions}
            getRowId={getRowId}
            sortable={sortable}
            resizableColumns
            columnSizingOptions={sizing}
            size="small"
            focusMode="composite"
            aria-label={ariaLabel}>
            <DataGridHeader>
                <DataGridRow>
                    {({ renderHeaderCell, columnId }) => (
                        <DataGridHeaderCell
                            className={
                                numericIds.has(String(columnId)) ? classes.numeric : undefined
                            }>
                            {renderHeaderCell()}
                        </DataGridHeaderCell>
                    )}
                </DataGridRow>
            </DataGridHeader>
            <DataGridBody<T>>
                {({ item, rowId }) => (
                    <DataGridRow<T> key={rowId} className={rowClassName?.(item)}>
                        {({ renderCell, columnId }) => (
                            <DataGridCell
                                className={
                                    numericIds.has(String(columnId)) ? classes.numeric : undefined
                                }>
                                {renderCell(item)}
                            </DataGridCell>
                        )}
                    </DataGridRow>
                )}
            </DataGridBody>
        </DataGrid>
    );
}
