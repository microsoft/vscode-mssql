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
    mergeClasses,
    TableColumnDefinition,
    TableColumnSizingOptions,
    tokens,
} from "@fluentui/react-components";
import { MouseEvent, ReactNode, useMemo } from "react";
import { useFadeInClass } from "./performanceDashboardSkeletons";

const cellBorder = "1px solid var(--vscode-panel-border)";

/** The look of the query grid: a frame, a shaded header, and a line between the columns. */
const useStyles = makeStyles({
    frame: {
        width: "100%",
        minWidth: 0,
        border: cellBorder,
        borderRadius: tokens.borderRadiusMedium,
        overflowX: "auto",
    },
    grid: {
        width: "100%",
        minWidth: 0,
    },
    header: {
        backgroundColor: tokens.colorNeutralBackground2,
    },
    row: {
        minHeight: "36px",
    },
    selected: {
        backgroundColor: "var(--vscode-list-inactiveSelectionBackground)",
        ":hover": {
            backgroundColor: "var(--vscode-list-inactiveSelectionBackground)",
        },
    },
    // The column widths include the line, so the lines do not make the grid wider than its frame.
    cell: {
        boxSizing: "border-box",
        borderRight: cellBorder,
        "&:last-child": {
            borderRight: "none",
        },
    },
    headerCell: {
        whiteSpace: "nowrap",
        color: tokens.colorNeutralForeground2,
        "&[aria-sort='ascending'], &[aria-sort='descending']": {
            backgroundColor: tokens.colorNeutralBackground3,
            color: tokens.colorNeutralForeground1,
            fontWeight: tokens.fontWeightSemibold,
        },
    },
    numeric: {
        justifyContent: "flex-end",
        textAlign: "right",
        fontFamily: tokens.fontFamilyMonospace,
        fontVariantNumeric: "tabular-nums",
    },
    footer: {
        borderTop: cellBorder,
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
    /** Highlights a row, for example a selected plan. */
    readonly isSelected?: (item: T) => boolean;
    readonly onRowContextMenu?: (item: T, event: MouseEvent) => void;
    /** Content inside the frame, below the rows, such as the actions for the selected rows. */
    readonly footer?: ReactNode;
    /** False leaves out the frame, for a grid inside another panel. Default true. */
    readonly framed?: boolean;
}

/** A small Fluent data grid for lists that do not need virtualization. */
export function SimpleGrid<T>({
    items,
    columns,
    getRowId,
    ariaLabel,
    rowClassName,
    isSelected,
    onRowContextMenu,
    footer,
    framed = true,
}: SimpleGridProps<T>) {
    const classes = useStyles();
    const fadeIn = useFadeInClass();
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
        <div className={mergeClasses(framed && classes.frame, fadeIn)}>
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
                <DataGridHeader className={classes.header}>
                    <DataGridRow>
                        {({ renderHeaderCell }) => (
                            <DataGridHeaderCell
                                className={mergeClasses(classes.cell, classes.headerCell)}>
                                {renderHeaderCell()}
                            </DataGridHeaderCell>
                        )}
                    </DataGridRow>
                </DataGridHeader>
                <DataGridBody<T>>
                    {({ item, rowId }) => (
                        <DataGridRow<T>
                            key={rowId}
                            className={mergeClasses(
                                classes.row,
                                isSelected?.(item) && classes.selected,
                                rowClassName?.(item),
                            )}
                            aria-selected={isSelected ? isSelected(item) : undefined}
                            onContextMenu={
                                onRowContextMenu
                                    ? (event: MouseEvent) => onRowContextMenu(item, event)
                                    : undefined
                            }>
                            {({ renderCell, columnId }) => (
                                <DataGridCell
                                    className={mergeClasses(
                                        classes.cell,
                                        numericIds.has(String(columnId)) && classes.numeric,
                                    )}>
                                    {renderCell(item)}
                                </DataGridCell>
                            )}
                        </DataGridRow>
                    )}
                </DataGridBody>
            </DataGrid>
            {footer && <div className={classes.footer}>{footer}</div>}
        </div>
    );
}
