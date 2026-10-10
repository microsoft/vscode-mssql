/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Caption1,
    createTableColumn,
    Link,
    makeStyles,
    mergeClasses,
    TableColumnDefinition,
    tokens,
} from "@fluentui/react-components";
import {
    DataGrid,
    DataGridBody,
    DataGridCell,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridRow,
} from "@fluentui-contrib/react-data-grid-react-window";
import { Star16Filled, Star16Regular } from "@fluentui/react-icons";
import { CSSProperties, RefObject, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PerformanceReadResult } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { SqlText } from "../../common/sqlText";
import { ExtensionRequestState, isFirstLoad } from "../../common/useExtensionRequest";
import { formatShare } from "./performanceDashboardFormat";
import { StatusBar } from "./performanceDashboardParts";
import { QueryListRow } from "./performanceDashboardQueryList";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import { TableSkeleton, useFadeInClass } from "./performanceDashboardSkeletons";
import { readStatusMessage } from "./performanceDashboardStatus";

const rowHeight = 36;
/** The query text shown in a row. The full text is in the tooltip and on the query page. */
const maxQueryTextLength = 160;
const cellBorder = "1px solid var(--vscode-panel-border)";
const favoriteWidth = 36;
const idWidth = 88;
const textMinWidth = 200;
const numberWidth = 150;
const shareWidth = 180;

const useStyles = makeStyles({
    // The slot takes the space left below the grid's siblings; the frame fits the rows in it.
    slot: {
        flex: "1 1 0px",
        minWidth: 0,
    },
    // A narrow grid scrolls sideways in the frame, so the header and the rows move together.
    frame: {
        width: "100%",
        minWidth: 0,
        border: cellBorder,
        borderRadius: tokens.borderRadiusMedium,
        overflowX: "auto",
        overflowY: "hidden",
    },
    grid: {
        width: "100%",
    },
    // The virtualized header scrolls sideways on its own; here the frame scrolls instead.
    header: {
        backgroundColor: tokens.colorNeutralBackground2,
        overflowX: "visible",
    },
    headerRow: {
        height: `${rowHeight}px`,
    },
    // When the body scrolls, the header keeps the space of its scroll bar, so that the columns
    // line up with the cells.
    headerRowGutter: {
        overflow: "hidden",
        scrollbarGutter: "stable",
    },
    listGutter: {
        scrollbarGutter: "stable",
    },
    // A line between the columns. Headers are on the left; numbers are on the right.
    cell: {
        minWidth: 0,
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
    favoriteColumn: {
        flex: `0 0 ${favoriteWidth}px`,
    },
    idColumn: {
        flex: `0 0 ${idWidth}px`,
    },
    // A zero basis, so that the column takes the space left and never grows with its text.
    textColumn: {
        flex: "1 1 0px",
        minWidth: `${textMinWidth}px`,
    },
    numberColumn: {
        flex: `0 0 ${numberWidth}px`,
    },
    shareColumn: {
        flex: `0 0 ${shareWidth}px`,
    },
    numeric: {
        justifyContent: "flex-end",
        textAlign: "right",
        fontFamily: tokens.fontFamilyMonospace,
        fontVariantNumeric: "tabular-nums",
    },
    queryText: {
        display: "block",
        fontFamily: tokens.fontFamilyMonospace,
        whiteSpace: "nowrap",
        overflowX: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
    },
    // The share fills the cell from the left, behind the text.
    shareCell: {
        position: "relative",
        alignSelf: "stretch",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        width: "100%",
    },
    shareFill: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: "-8px",
        backgroundColor: "color-mix(in srgb, var(--vscode-charts-blue) 22%, transparent)",
    },
    shareText: {
        position: "relative",
        whiteSpace: "nowrap",
    },
    shareValue: {
        fontWeight: tokens.fontWeightSemibold,
    },
    favorite: {
        color: tokens.colorPaletteMarigoldForeground1,
    },
});

/** A number column of a query list. */
export interface QueryGridColumn {
    readonly id: string;
    readonly header: string;
    readonly value: (row: QueryListRow) => number | undefined;
    readonly format: (value: number) => string;
    /** The exact value, for the tooltip, when the format rounds it. */
    readonly exact?: (value: number) => string;
    /**
     * The share of the value in percent. The cell shows the share and the value, for example
     * "91.3% / 34.63s", over a bar of the share.
     */
    readonly share?: (row: QueryListRow) => number | undefined;
    /**
     * False shows only the value over the bar, for a share that is not a part of a whole, such
     * as an average against the highest average. Default true.
     */
    readonly showShare?: boolean;
    /** The tooltip of a cell with a share. Default: the exact value. */
    readonly shareTitle?: (share: number, value: number) => string;
}

export interface QueryGridFavorites {
    readonly queryIds: ReadonlySet<string>;
    toggle(queryId: string, favorite: boolean): void;
}

export interface PerformanceDashboardQueryGridProps {
    readonly rows: readonly QueryListRow[];
    readonly columns: readonly QueryGridColumn[];
    readonly ariaLabel: string;
    readonly favorites?: QueryGridFavorites;
    /** The rows that the grid shows at least, before the page scrolls instead. Default 5. */
    readonly visibleRows?: number;
    /** Query values to keep on the query page link, such as the time range. */
    readonly linkQuery?: Readonly<Record<string, string>>;
}

/**
 * A virtualized, sortable list of queries: a favorite star, the query ID (a link to the query
 * page), the query text, and number columns. The rows come ranked by the first number column,
 * so the grid shows that column sorted, from the highest value.
 */
export const PerformanceDashboardQueryGrid = ({
    rows,
    columns,
    ariaLabel,
    favorites,
    visibleRows = 5,
    linkQuery,
}: PerformanceDashboardQueryGridProps) => {
    const classes = useStyles();
    const { router, navigate } = useNavigation<PerformanceDashboardRoute>();
    const fadeIn = useFadeInClass();

    const definitions = useMemo<TableColumnDefinition<QueryListRow>[]>(() => {
        const text = loc.performanceDashboard;
        const list: TableColumnDefinition<QueryListRow>[] = [];
        if (favorites) {
            list.push(
                createTableColumn<QueryListRow>({
                    columnId: "favorite",
                    compare: (left, right) =>
                        Number(favorites.queryIds.has(left.queryId)) -
                        Number(favorites.queryIds.has(right.queryId)),
                    renderHeaderCell: () => "",
                    renderCell: (row) => {
                        const isFavorite = favorites.queryIds.has(row.queryId);
                        return (
                            <Button
                                appearance="transparent"
                                size="small"
                                icon={
                                    isFavorite ? (
                                        <Star16Filled className={classes.favorite} />
                                    ) : (
                                        <Star16Regular />
                                    )
                                }
                                aria-label={
                                    isFavorite
                                        ? text.removeFavorite(row.queryId)
                                        : text.addFavorite(row.queryId)
                                }
                                aria-pressed={isFavorite}
                                onClick={() => favorites.toggle(row.queryId, !isFavorite)}
                            />
                        );
                    },
                }),
            );
        }
        list.push(
            createTableColumn<QueryListRow>({
                columnId: "queryId",
                compare: (left, right) => Number(left.queryId) - Number(right.queryId),
                renderHeaderCell: () => text.queryId,
                renderCell: (row) => {
                    const location = router.build("query", { queryId: row.queryId }, linkQuery);
                    return (
                        <Link
                            href={`#${location}`}
                            onClick={(event) => {
                                event.preventDefault();
                                navigate(location);
                            }}>
                            {row.queryId}
                        </Link>
                    );
                },
            }),
            createTableColumn<QueryListRow>({
                columnId: "queryText",
                compare: (left, right) => left.queryText.localeCompare(right.queryText),
                renderHeaderCell: () => text.queryText,
                renderCell: (row) => (
                    <SqlText
                        className={classes.queryText}
                        text={shortQueryText(row.queryText)}
                        singleLine
                        title={row.queryText}
                    />
                ),
            }),
        );
        for (const column of columns) {
            list.push(
                createTableColumn<QueryListRow>({
                    columnId: column.id,
                    compare: (left, right) =>
                        (column.value(left) ?? -1) - (column.value(right) ?? -1),
                    renderHeaderCell: () => column.header,
                    renderCell: (row) => {
                        const value = column.value(row);
                        if (value === undefined) {
                            return "—";
                        }
                        const exact = column.exact?.(value);
                        const share = column.share?.(row);
                        if (share === undefined) {
                            return <span title={exact}>{column.format(value)}</span>;
                        }
                        return (
                            <span
                                className={classes.shareCell}
                                title={column.shareTitle?.(share, value) ?? exact}>
                                <span
                                    className={classes.shareFill}
                                    style={{ width: `calc(${Math.min(100, share)}% + 8px)` }}
                                    aria-hidden
                                />
                                <span className={classes.shareText}>
                                    {column.showShare === false ? (
                                        column.format(value)
                                    ) : (
                                        <>
                                            <span className={classes.shareValue}>
                                                {formatShare(share)}
                                            </span>
                                            {` / ${column.format(value)}`}
                                        </>
                                    )}
                                </span>
                            </span>
                        );
                    },
                }),
            );
        }
        return list;
    }, [columns, favorites, router, navigate, linkQuery, classes]);

    const columnClass = useMemo(() => {
        const byId: Record<string, string> = {
            favorite: classes.favoriteColumn,
            queryId: classes.idColumn,
            queryText: classes.textColumn,
        };
        for (const column of columns) {
            byId[column.id] = column.share ? classes.shareColumn : classes.numberColumn;
        }
        return (columnId: string | number) => byId[String(columnId)];
    }, [columns, classes]);
    const numericIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);

    // The grid fills the space left below its siblings, and the rows scroll under the header. On
    // a short page, it keeps room for the visible rows, and the page scrolls. It is never taller
    // than its rows.
    const slot = useRef<HTMLDivElement>(null);
    const slotHeight = useElementHeight(slot);
    const rowsHeight = Math.max(1, rows.length) * rowHeight;
    const frameBorders = 2;
    const visibleHeight = Math.max(1, Math.min(rows.length, visibleRows)) * rowHeight;
    const height =
        slotHeight > 0
            ? Math.max(visibleHeight, Math.min(rowsHeight, slotHeight - rowHeight - frameBorders))
            : visibleHeight;
    const minSlotHeight = visibleHeight + rowHeight + frameBorders;
    const bodyScrolls = height < rowsHeight;
    // Below this width, the frame scrolls sideways. The header and every row are at least this
    // wide, with 1px for the line after each column.
    const columnCount = (favorites ? 1 : 0) + 2 + columns.length;
    const minGridWidth =
        (favorites ? favoriteWidth : 0) +
        idWidth +
        textMinWidth +
        columns.reduce((sum, column) => sum + (column.share ? shareWidth : numberWidth), 0) +
        columnCount;

    return (
        <div ref={slot} className={classes.slot} style={{ minHeight: minSlotHeight }}>
            <div className={mergeClasses(classes.frame, fadeIn)}>
                <DataGrid
                    className={classes.grid}
                    style={{ minWidth: minGridWidth }}
                    items={[...rows]}
                    columns={definitions}
                    getRowId={(row: QueryListRow) => row.queryId}
                    sortable
                    defaultSortState={
                        columns[0]
                            ? { sortColumn: columns[0].id, sortDirection: "descending" }
                            : undefined
                    }
                    size="small"
                    focusMode="composite"
                    aria-label={ariaLabel}>
                    <DataGridHeader className={classes.header}>
                        <DataGridRow
                            className={mergeClasses(
                                classes.headerRow,
                                bodyScrolls && classes.headerRowGutter,
                            )}
                            style={{ minWidth: minGridWidth }}>
                            {({
                                renderHeaderCell,
                                columnId,
                            }: {
                                renderHeaderCell: () => React.ReactNode;
                                columnId: string | number;
                            }) => (
                                <DataGridHeaderCell
                                    className={mergeClasses(
                                        classes.cell,
                                        classes.headerCell,
                                        columnClass(columnId),
                                    )}>
                                    {renderHeaderCell()}
                                </DataGridHeaderCell>
                            )}
                        </DataGridRow>
                    </DataGridHeader>
                    <DataGridBody<QueryListRow>
                        itemSize={rowHeight}
                        height={height}
                        width={`max(100%, ${minGridWidth}px)`}
                        listProps={{
                            className: bodyScrolls ? classes.listGutter : undefined,
                            // The frame scrolls sideways, not the body. The list sets its
                            // overflow inline, so this is inline too.
                            style: { overflowX: "hidden" },
                        }}>
                        {(
                            { item, rowId }: { item: QueryListRow; rowId: string | number },
                            style: CSSProperties,
                        ) => (
                            <DataGridRow<QueryListRow>
                                key={rowId}
                                style={{ ...style, minWidth: minGridWidth }}>
                                {({
                                    renderCell,
                                    columnId,
                                }: {
                                    renderCell: (row: QueryListRow) => React.ReactNode;
                                    columnId: string | number;
                                }) => (
                                    <DataGridCell
                                        className={mergeClasses(
                                            classes.cell,
                                            columnClass(columnId),
                                            numericIds.has(String(columnId)) && classes.numeric,
                                        )}>
                                        {renderCell(item)}
                                    </DataGridCell>
                                )}
                            </DataGridRow>
                        )}
                    </DataGridBody>
                </DataGrid>
            </div>
        </div>
    );
};

/** The query text on one line, cut after a fixed length. */
function shortQueryText(queryText: string): string {
    const line = queryText.replace(/\s+/g, " ").trim();
    return line.length > maxQueryTextLength ? `${line.slice(0, maxQueryTextLength)}…` : line;
}

/** The height of an element, kept up to date as it resizes. */
function useElementHeight(element: RefObject<HTMLElement | null>): number {
    const [height, setHeight] = useState(0);
    useLayoutEffect(() => {
        const target = element.current;
        if (!target) {
            return;
        }
        const measure = (next: number) =>
            setHeight((current) => (Math.abs(current - next) >= 1 ? Math.floor(next) : current));
        measure(target.getBoundingClientRect().height);
        const observer = new ResizeObserver((entries) => measure(entries[0].contentRect.height));
        observer.observe(target);
        return () => observer.disconnect();
    }, [element]);
    return height;
}

export interface PerformanceDashboardQueryListProps extends PerformanceDashboardQueryGridProps {
    /** The read of the rows. Its message, a skeleton, or the empty text replaces the grid. */
    readonly read: ExtensionRequestState<PerformanceReadResult<unknown>>;
    /**
     * True while another read that the rows need still runs, such as the total behind the share
     * bars. The grid shows when the rows are complete, so they do not change as reads finish.
     */
    readonly pending?: boolean;
    readonly emptyText?: string;
}

/** A query grid, or the message, skeleton, or empty text of its read. */
export const PerformanceDashboardQueryList = ({
    read,
    pending,
    emptyText,
    ...grid
}: PerformanceDashboardQueryListProps) => {
    const classes = useListStyles();
    const message = readStatusMessage(read);
    if (message) {
        return <StatusBar message={message} />;
    }
    if (isFirstLoad(read) || pending) {
        return <TableSkeleton rows={10} numberColumns={grid.columns.length} />;
    }
    if (grid.rows.length === 0) {
        return (
            <Caption1 className={classes.empty}>
                {emptyText ?? loc.performanceDashboard.noQueries}
            </Caption1>
        );
    }
    return <PerformanceDashboardQueryGrid {...grid} />;
};

const useListStyles = makeStyles({
    empty: {
        color: tokens.colorNeutralForeground3,
    },
});
