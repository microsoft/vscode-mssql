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
    InfoLabel,
    makeStyles,
    mergeClasses,
    TableColumnDefinition,
    TableColumnSizingOptions,
    tokens,
} from "@fluentui/react-components";
import { CSSProperties, MouseEvent, ReactNode, useMemo } from "react";
import { useFadeInClass } from "./performanceDashboardSkeletons";

const cellBorder = "1px solid var(--vscode-panel-border)";
const rowHeight = 36;
/** The rows that a filling grid shows at least, before the page scrolls instead. */
const minVisibleRows = 5;

/** The look of the query grid: a frame, a shaded header, and a line between the columns. */
const useStyles = makeStyles({
    frame: {
        boxSizing: "border-box",
        width: "100%",
        minWidth: 0,
        overflowX: "auto",
    },
    framed: {
        border: cellBorder,
        borderRadius: tokens.borderRadiusMedium,
    },
    // A filling grid takes the space left below its siblings. The frame fits the rows, up to
    // the height of the slot, and the rows scroll in it under the header.
    slot: {
        position: "relative",
        flex: "1 1 0px",
        minWidth: 0,
    },
    fillFrame: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        maxHeight: "100%",
        overflowY: "auto",
    },
    // The header shade may be translucent, so it lies over the editor background; otherwise the
    // rows show through the header as they scroll under it.
    stickyHeader: {
        position: "sticky",
        top: 0,
        zIndex: 2,
        backgroundColor: "var(--vscode-editor-background)",
        backgroundImage: `linear-gradient(${tokens.colorNeutralBackground2}, ${tokens.colorNeutralBackground2})`,
    },
    stickyFooter: {
        position: "sticky",
        bottom: 0,
        zIndex: 1,
        backgroundColor: "var(--vscode-editor-background)",
    },
    grid: {
        width: "100%",
        minWidth: 0,
    },
    header: {
        backgroundColor: tokens.colorNeutralBackground2,
    },
    row: {
        minHeight: `${rowHeight}px`,
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
    // A control column, such as a check box or a menu button: centered, without padding.
    centered: {
        justifyContent: "center",
        paddingLeft: 0,
        paddingRight: 0,
    },
    footer: {
        borderTop: cellBorder,
    },
});

export interface SimpleGridColumn<T> {
    readonly id: string;
    readonly header: string;
    /** Explains the column, in an info button after the header. */
    readonly headerInfo?: string;
    readonly render: (item: T) => ReactNode;
    /** Sorts the column. Without it, the column does not sort. */
    readonly compare?: (left: T, right: T) => number;
    readonly numeric?: boolean;
    readonly minWidth?: number;
    readonly idealWidth?: number;
    /**
     * Takes the width left. When a column grows, the other columns keep their ideal width and
     * do not resize, so a narrow column such as a menu button stays narrow.
     */
    readonly grow?: boolean;
    /** Centers a control, such as a check box or a menu button, without cell padding. */
    readonly control?: boolean;
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
    /**
     * Takes the space left in a flex column, with the header fixed and the rows scrolling under
     * it. The parent must grow to the bottom of the page.
     */
    readonly fill?: boolean;
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
    fill = false,
}: SimpleGridProps<T>) {
    const classes = useStyles();
    const fadeIn = useFadeInClass();
    const definitions = useMemo<TableColumnDefinition<T>[]>(
        () =>
            columns.map((column) =>
                createTableColumn<T>({
                    columnId: column.id,
                    compare: column.compare ?? (() => 0),
                    renderHeaderCell: () =>
                        column.headerInfo ? (
                            <InfoLabel size="small" info={column.headerInfo}>
                                {column.header}
                            </InfoLabel>
                        ) : (
                            column.header
                        ),
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
    const controlIds = new Set(
        columns.filter((column) => column.control).map((column) => column.id),
    );

    // With a growing column, each column has a fixed width or grows, and a narrow grid scrolls
    // sideways. Otherwise the columns resize, and the last one takes the width left.
    const fixedLayout = columns.some((column) => column.grow);
    const layout = useMemo(() => {
        const styles = new Map<string, CSSProperties>();
        let minWidth = 0;
        for (const column of columns) {
            const ideal = column.idealWidth ?? 140;
            const min = column.grow ? (column.minWidth ?? 80) : ideal;
            styles.set(column.id, {
                flex: column.grow ? `1 1 ${ideal}px` : `0 0 ${ideal}px`,
                minWidth: min,
            });
            minWidth += min;
        }
        return { styles, minWidth };
    }, [columns]);
    const cellStyle = (columnId: string | number) =>
        fixedLayout ? layout.styles.get(String(columnId)) : undefined;
    const rowStyle = fixedLayout ? { minWidth: layout.minWidth } : undefined;

    const grid = (
        <div
            className={mergeClasses(
                classes.frame,
                framed && classes.framed,
                fill && classes.fillFrame,
                fadeIn,
            )}>
            <DataGrid
                className={classes.grid}
                items={[...items]}
                columns={definitions}
                getRowId={getRowId}
                style={rowStyle}
                sortable={sortable}
                resizableColumns={!fixedLayout}
                columnSizingOptions={fixedLayout ? undefined : sizing}
                size="small"
                focusMode="composite"
                aria-label={ariaLabel}>
                <DataGridHeader
                    className={mergeClasses(classes.header, fill && classes.stickyHeader)}>
                    <DataGridRow style={rowStyle}>
                        {({ renderHeaderCell, columnId }) => (
                            <DataGridHeaderCell
                                className={mergeClasses(
                                    classes.cell,
                                    classes.headerCell,
                                    controlIds.has(String(columnId)) && classes.centered,
                                )}
                                style={cellStyle(columnId)}>
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
                            style={rowStyle}
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
                                        controlIds.has(String(columnId)) && classes.centered,
                                    )}
                                    style={cellStyle(columnId)}>
                                    {renderCell(item)}
                                </DataGridCell>
                            )}
                        </DataGridRow>
                    )}
                </DataGridBody>
            </DataGrid>
            {footer && (
                <div className={mergeClasses(classes.footer, fill && classes.stickyFooter)}>
                    {footer}
                </div>
            )}
        </div>
    );
    if (!fill) {
        return grid;
    }
    // The slot keeps room for the header and a few rows, so a short page scrolls rather than
    // squeezing the grid to nothing.
    const minHeight =
        (Math.min(Math.max(items.length, 1), minVisibleRows) + 1) * rowHeight +
        (framed ? 2 : 0) +
        (footer ? rowHeight + 8 : 0);
    return (
        <div className={classes.slot} style={{ minHeight }}>
            {grid}
        </div>
    );
}
