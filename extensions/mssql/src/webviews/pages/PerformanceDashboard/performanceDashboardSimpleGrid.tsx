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
import {
    DataGrid as VirtualDataGrid,
    DataGridBody as VirtualDataGridBody,
    DataGridHeader as VirtualDataGridHeader,
    DataGridRow as VirtualDataGridRow,
} from "@fluentui-contrib/react-data-grid-react-window";
import { CSSProperties, MouseEvent, ReactNode, useMemo, useRef } from "react";
import { useElementHeight } from "./performanceDashboardElementHeight";
import { useFadeInClass } from "./performanceDashboardSkeletons";

const cellBorder = "1px solid var(--vscode-panel-border)";
const rowHeight = 36;
/** The rows that a filling grid shows at least, before the page scrolls instead. */
const minVisibleRows = 5;
/** A filling grid with more rows than this virtualizes them, so it renders only those in view. */
const virtualizeAbove = 50;

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
    virtualFrame: {
        overflowY: "hidden",
    },
    // When the virtualized rows scroll, the header keeps the space of their scroll bar, so that
    // the columns line up with the cells.
    headerRowGutter: {
        overflowY: "hidden",
        scrollbarGutter: "stable",
    },
    listGutter: {
        scrollbarGutter: "stable",
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
    // The totals: a row below the rows, in the column widths, in bold.
    totalsRow: {
        display: "flex",
        minHeight: `${rowHeight}px`,
        borderTop: cellBorder,
        fontWeight: tokens.fontWeightSemibold,
    },
    totalsCell: {
        display: "flex",
        alignItems: "center",
        minWidth: 0,
        padding: `0 ${tokens.spacingHorizontalS}`,
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
    /** The initial sort shown in the header. */
    readonly defaultSort?: {
        readonly column: string;
        readonly direction: "ascending" | "descending";
    };
    readonly rowClassName?: (item: T) => string | undefined;
    /** Highlights a row, for example a selected plan. */
    readonly isSelected?: (item: T) => boolean;
    readonly onRowContextMenu?: (item: T, event: MouseEvent) => void;
    /** Content inside the frame, below the rows, such as the actions for the selected rows. */
    readonly footer?: ReactNode;
    /**
     * A row of totals below the rows, by column ID, such as "Total" and a size. It lines up with
     * the columns when a column grows.
     */
    readonly totals?: Readonly<Record<string, ReactNode>>;
    /** False leaves out the frame, for a grid inside another panel. Default true. */
    readonly framed?: boolean;
    /**
     * Takes the space left in a flex column, with the header fixed and the rows scrolling under
     * it. The parent must grow to the bottom of the page.
     */
    readonly fill?: boolean;
    /** Virtualizes rows in a filling grid. Default: when it has more than 50 rows. */
    readonly virtualized?: boolean;
}

/** A Fluent data grid for dashboard lists, with optional row virtualization. */
export function SimpleGrid<T>({
    items,
    columns,
    getRowId,
    ariaLabel,
    defaultSort,
    rowClassName,
    isSelected,
    onRowContextMenu,
    footer,
    totals,
    framed = true,
    fill = false,
    virtualized: virtualizedOption,
}: SimpleGridProps<T>) {
    const virtualized = fill && (virtualizedOption ?? items.length > virtualizeAbove);
    const classes = useStyles();
    const fadeIn = useFadeInClass();
    // The grid sorts its items again when they change, so they change only with the items prop.
    const gridItems = useMemo(() => [...items], [items]);
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
    const slot = useRef<HTMLDivElement>(null);
    const slotHeight = useElementHeight(slot);
    const rowsHeight = Math.max(1, items.length) * rowHeight;
    const minBodyHeight = Math.min(Math.max(items.length, 1), minVisibleRows) * rowHeight;
    const bodyHeight =
        slotHeight > 0
            ? Math.max(
                  minBodyHeight,
                  Math.min(
                      rowsHeight,
                      slotHeight - rowHeight - (footer ? rowHeight + 8 : 0) - (framed ? 2 : 0),
                  ),
              )
            : minBodyHeight;
    const bodyScrolls = virtualized && bodyHeight < rowsHeight;
    const Grid = virtualized ? VirtualDataGrid : DataGrid;
    const GridHeader = virtualized ? VirtualDataGridHeader : DataGridHeader;
    const GridRow = virtualized ? VirtualDataGridRow : DataGridRow;

    const renderRow = (
        { item, rowId }: { item: T; rowId: string | number },
        style?: CSSProperties,
    ) => (
        <GridRow<T>
            key={rowId}
            className={mergeClasses(
                classes.row,
                isSelected?.(item) && classes.selected,
                rowClassName?.(item),
            )}
            style={{ ...rowStyle, ...style }}
            aria-selected={isSelected ? isSelected(item) : undefined}
            onContextMenu={
                onRowContextMenu ? (event: MouseEvent) => onRowContextMenu(item, event) : undefined
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
        </GridRow>
    );

    const grid = (
        <div
            className={mergeClasses(
                classes.frame,
                framed && classes.framed,
                fill && classes.fillFrame,
                virtualized && classes.virtualFrame,
                fadeIn,
            )}>
            <Grid
                className={classes.grid}
                items={gridItems}
                columns={definitions}
                getRowId={getRowId}
                style={rowStyle}
                sortable={sortable}
                defaultSortState={
                    defaultSort
                        ? { sortColumn: defaultSort.column, sortDirection: defaultSort.direction }
                        : undefined
                }
                resizableColumns={!fixedLayout}
                columnSizingOptions={fixedLayout ? undefined : sizing}
                size="small"
                focusMode="composite"
                aria-label={ariaLabel}>
                <GridHeader className={mergeClasses(classes.header, fill && classes.stickyHeader)}>
                    <GridRow
                        className={bodyScrolls ? classes.headerRowGutter : undefined}
                        style={rowStyle}>
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
                    </GridRow>
                </GridHeader>
                {virtualized ? (
                    <VirtualDataGridBody<T>
                        itemSize={rowHeight}
                        height={bodyHeight}
                        width={`max(100%, ${layout.minWidth}px)`}
                        listProps={{
                            className: bodyScrolls ? classes.listGutter : undefined,
                            style: { overflowX: "hidden" },
                        }}>
                        {(row, style) => renderRow(row, style)}
                    </VirtualDataGridBody>
                ) : (
                    <DataGridBody<T>>{(row) => renderRow(row)}</DataGridBody>
                )}
            </Grid>
            {totals && (
                <div role="row" className={classes.totalsRow} style={rowStyle}>
                    {columns.map((column) => (
                        <div
                            key={column.id}
                            role="gridcell"
                            className={mergeClasses(
                                classes.cell,
                                classes.totalsCell,
                                column.numeric && classes.numeric,
                            )}
                            style={cellStyle(column.id)}>
                            {totals[column.id]}
                        </div>
                    ))}
                </div>
            )}
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
        <div ref={slot} className={classes.slot} style={{ minHeight }}>
            {grid}
        </div>
    );
}
