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
    shorthands,
    Spinner,
    TableColumnDefinition,
    TableColumnSizingOptions,
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
import { CSSProperties, useMemo } from "react";
import type { PerformanceReadResult } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import type { ExtensionRequestState } from "../../common/useExtensionRequest";
import { formatPercent } from "./performanceDashboardFormat";
import { StatusBar } from "./performanceDashboardParts";
import { QueryListRow } from "./performanceDashboardQueryList";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import { readStatusMessage } from "./performanceDashboardStatus";

const rowHeight = 32;

const useStyles = makeStyles({
    grid: {
        width: "100%",
        minWidth: 0,
    },
    queryText: {
        fontFamily: tokens.fontFamilyMonospace,
        whiteSpace: "nowrap",
        overflowX: "hidden",
        textOverflow: "ellipsis",
        minWidth: 0,
    },
    numeric: {
        justifyContent: "flex-end",
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
    },
    share: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        ...shorthands.gap("8px"),
        width: "100%",
    },
    shareTrack: {
        flexGrow: 1,
        maxWidth: "64px",
        height: "6px",
        ...shorthands.borderRadius("3px"),
        backgroundColor: tokens.colorNeutralBackground5,
        ...shorthands.overflow("hidden"),
    },
    shareFill: {
        display: "block",
        height: "100%",
        backgroundColor: tokens.colorBrandBackground,
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
    /** Shows a bar for a percent from 0 to 100. */
    readonly bar?: boolean;
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
    /** The rows to show before the grid scrolls. Default 10. */
    readonly visibleRows?: number;
    /** Query values to keep on the query page link, such as the time range. */
    readonly linkQuery?: Readonly<Record<string, string>>;
}

/**
 * A virtualized, sortable list of queries: a favorite star, the query ID (a link to the query
 * page), the query text, and number columns.
 */
export const PerformanceDashboardQueryGrid = ({
    rows,
    columns,
    ariaLabel,
    favorites,
    visibleRows = 10,
    linkQuery,
}: PerformanceDashboardQueryGridProps) => {
    const classes = useStyles();
    const { router, navigate } = useNavigation<PerformanceDashboardRoute>();
    const { numeric, queryText, share, shareTrack, shareFill, favorite } = classes;

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
                                        <Star16Filled className={favorite} />
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
                    <span className={queryText} title={row.queryText}>
                        {row.queryText.replace(/\s+/g, " ")}
                    </span>
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
                        if (!column.bar) {
                            return column.format(value);
                        }
                        return (
                            <span className={share}>
                                <span className={shareTrack} aria-hidden>
                                    <span
                                        className={shareFill}
                                        style={{ width: `${Math.min(100, value)}%` }}
                                    />
                                </span>
                                {formatPercent(value)}
                            </span>
                        );
                    },
                }),
            );
        }
        return list;
    }, [
        columns,
        favorites,
        router,
        navigate,
        linkQuery,
        queryText,
        share,
        shareTrack,
        shareFill,
        favorite,
    ]);

    const sizing = useMemo<TableColumnSizingOptions>(() => {
        const options: TableColumnSizingOptions = {
            favorite: { minWidth: 32, idealWidth: 32 },
            queryId: { minWidth: 64, idealWidth: 80 },
            queryText: { minWidth: 200, idealWidth: 520 },
        };
        for (const column of columns) {
            options[column.id] = { minWidth: 110, idealWidth: 150 };
        }
        return options;
    }, [columns]);

    const numericIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
    const height = Math.max(1, Math.min(rows.length, visibleRows)) * rowHeight;

    return (
        <DataGrid
            className={classes.grid}
            items={[...rows]}
            columns={definitions}
            getRowId={(row: QueryListRow) => row.queryId}
            sortable
            resizableColumns
            columnSizingOptions={sizing}
            size="small"
            focusMode="composite"
            aria-label={ariaLabel}>
            <DataGridHeader>
                <DataGridRow>
                    {({
                        renderHeaderCell,
                        columnId,
                    }: {
                        renderHeaderCell: () => React.ReactNode;
                        columnId: string | number;
                    }) => (
                        <DataGridHeaderCell
                            className={numericIds.has(String(columnId)) ? numeric : undefined}>
                            {renderHeaderCell()}
                        </DataGridHeaderCell>
                    )}
                </DataGridRow>
            </DataGridHeader>
            <DataGridBody<QueryListRow> itemSize={rowHeight} height={height} width="100%">
                {(
                    { item, rowId }: { item: QueryListRow; rowId: string | number },
                    style: CSSProperties,
                ) => (
                    <DataGridRow<QueryListRow> key={rowId} style={style}>
                        {({
                            renderCell,
                            columnId,
                        }: {
                            renderCell: (row: QueryListRow) => React.ReactNode;
                            columnId: string | number;
                        }) => (
                            <DataGridCell
                                className={numericIds.has(String(columnId)) ? numeric : undefined}>
                                {renderCell(item)}
                            </DataGridCell>
                        )}
                    </DataGridRow>
                )}
            </DataGridBody>
        </DataGrid>
    );
};

export interface PerformanceDashboardQueryListProps extends PerformanceDashboardQueryGridProps {
    /** The read of the rows. Its message, a spinner, or the empty text replaces the grid. */
    readonly read: ExtensionRequestState<PerformanceReadResult<unknown>>;
    readonly emptyText?: string;
}

/** A query grid, or the message, spinner, or empty text of its read. */
export const PerformanceDashboardQueryList = ({
    read,
    emptyText,
    ...grid
}: PerformanceDashboardQueryListProps) => {
    const classes = useListStyles();
    const message = readStatusMessage(read);
    if (message) {
        return <StatusBar message={message} />;
    }
    if (read.loading && grid.rows.length === 0) {
        return <Spinner size="small" label={loc.common.loading} />;
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
