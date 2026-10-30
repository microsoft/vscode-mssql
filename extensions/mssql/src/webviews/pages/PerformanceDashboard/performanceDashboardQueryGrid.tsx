/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Caption1, makeStyles, MenuItem, tokens } from "@fluentui/react-components";
import { ReactElement, useMemo } from "react";
import type { PerformanceRead } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { appendSqlText } from "../../common/sqlText";
import { ExtensionRequestState, isFirstLoad } from "../../common/useExtensionRequest";
import { formatShare } from "./performanceDashboardFormat";
import {
    DashboardGrid,
    DashboardGridColumn,
    iconButton,
    linkCell,
} from "./performanceDashboardGrid";
import { StatusBar } from "./performanceDashboardParts";
import { QueryListRow } from "./performanceDashboardQueryList";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import { TableSkeleton } from "./performanceDashboardSkeletons";
import { readStatusMessage } from "./performanceDashboardStatus";

/** The query text shown in a row. The full text is in the tooltip and on the query page. */
const maxQueryTextLength = 160;
const idWidth = 100;
const textMinWidth = 200;
const numberWidth = 150;
const shareWidth = 180;
// The 16px Fluent star icons.
const starRegularPath =
    "M7.2 2.1a.9.9 0 0 1 1.6 0l1.53 3.08 3.4.5a.9.9 0 0 1 .5 1.53l-2.46 2.4.58 3.39a.9.9 0 0 1-1.3.95L8 12.35l-3.04 1.6a.9.9 0 0 1-1.3-.95l.57-3.39-2.46-2.4a.9.9 0 0 1 .5-1.53l3.4-.5L7.2 2.1Zm.8.63L6.55 5.67a.9.9 0 0 1-.68.5l-3.25.47 2.35 2.3c.21.2.3.5.26.79l-.56 3.24 2.91-1.53a.9.9 0 0 1 .84 0l2.9 1.53-.55-3.24a.9.9 0 0 1 .26-.8l2.36-2.3-3.26-.46a.9.9 0 0 1-.67-.5L8 2.73Z";
const starFilledPath =
    "M7.2 2.1a.9.9 0 0 1 1.6 0l1.53 3.08 3.4.5a.9.9 0 0 1 .5 1.53l-2.46 2.4.58 3.39a.9.9 0 0 1-1.3.95L8 12.35l-3.04 1.6a.9.9 0 0 1-1.3-.95l.57-3.39-2.46-2.4a.9.9 0 0 1 .5-1.53l3.4-.5L7.2 2.1Z";

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

export interface QueryRowAction {
    readonly label: string;
    readonly icon: ReactElement;
    readonly run: (queryId: string) => void;
}

export interface PerformanceDashboardQueryGridProps {
    readonly rows: readonly QueryListRow[];
    readonly columns: readonly QueryGridColumn[];
    readonly ariaLabel: string;
    readonly favorites?: QueryGridFavorites;
    /** The rows that the grid shows at least, before the page scrolls instead. Default 5. */
    readonly visibleRows?: number;
    /**
     * An action on a row, such as the analysis of the query, in the row's menu after Copy. A
     * button at the end of each row opens the menu too.
     */
    readonly rowAction?: QueryRowAction;
}

/**
 * A sortable list of queries: a favorite star, the query ID (a link to the query page), the
 * query text, and number columns. The rows come ranked by the first number column, so the grid
 * shows that column sorted, from the highest value.
 */
export const PerformanceDashboardQueryGrid = ({
    rows,
    columns,
    ariaLabel,
    favorites,
    visibleRows,
    rowAction,
}: PerformanceDashboardQueryGridProps) => {
    const { router, navigate } = useNavigation<PerformanceDashboardRoute>();

    const gridColumns = useMemo<DashboardGridColumn<QueryListRow>[]>(() => {
        const text = loc.performanceDashboard;
        const list: DashboardGridColumn<QueryListRow>[] = [];
        if (favorites) {
            const isFavorite = (row: QueryListRow) => favorites.queryIds.has(row.queryId);
            list.push({
                id: "favorite",
                header: "",
                control: true,
                text: () => "",
                sortValue: isFavorite,
                render: (row) => {
                    const favorite = isFavorite(row);
                    const button = iconButton(
                        favorite ? starFilledPath : starRegularPath,
                        favorite ? text.removeFavorite(row.queryId) : text.addFavorite(row.queryId),
                    );
                    button.setAttribute("aria-pressed", String(favorite));
                    button.classList.toggle("performance-grid-favorite", favorite);
                    return button;
                },
                activate: (row) => favorites.toggle(row.queryId, !isFavorite(row)),
            });
        }
        list.push(
            {
                id: "queryId",
                header: text.queryId,
                width: idWidth,
                text: (row) => row.queryId,
                sortValue: (row) => Number(row.queryId),
                render: (row) =>
                    linkCell(row.queryId, `#${router.build("query", { queryId: row.queryId })}`),
                activate: (row) => navigate(router.build("query", { queryId: row.queryId })),
            },
            {
                id: "queryText",
                header: text.queryText,
                width: textMinWidth,
                grow: true,
                text: (row) => shortQueryText(row.queryText),
                copyText: (row) => row.queryText,
                title: (row) => row.queryText,
                sortValue: (row) => row.queryText,
                render: (row) => {
                    const span = document.createElement("span");
                    span.className = "performance-grid-sql";
                    appendSqlText(span, shortQueryText(row.queryText));
                    return span;
                },
            },
        );
        for (const column of columns) {
            const formatted = (row: QueryListRow) => {
                const value = column.value(row);
                return value === undefined ? "—" : column.format(value);
            };
            list.push({
                id: column.id,
                header: column.header,
                numeric: true,
                width: column.share ? shareWidth : numberWidth,
                text: formatted,
                sortValue: column.value,
                title: (row) => {
                    const value = column.value(row);
                    const share = column.share?.(row);
                    if (value === undefined) {
                        return undefined;
                    }
                    return share !== undefined && column.shareTitle
                        ? column.shareTitle(share, value)
                        : column.exact?.(value);
                },
                render: column.share ? (row) => shareCell(column, row, formatted(row)) : undefined,
            });
        }
        return list;
    }, [columns, favorites, router, navigate]);

    return (
        <DashboardGrid<QueryListRow>
            items={rows}
            columns={gridColumns}
            getRowId={(row) => row.queryId}
            ariaLabel={ariaLabel}
            defaultSort={
                columns[0] ? { column: columns[0].id, direction: "descending" } : undefined
            }
            visibleRows={visibleRows}
            menuButtonLabel={
                rowAction ? (row) => loc.performanceDashboard.queryActions(row.queryId) : undefined
            }
            menuItems={
                rowAction
                    ? (row) => (
                          <MenuItem
                              icon={rowAction.icon}
                              onClick={() => rowAction.run(row.queryId)}>
                              {rowAction.label}
                          </MenuItem>
                      )
                    : undefined
            }
        />
    );
};

/** The value of a number column over a bar of its share, which fills the cell from the left. */
function shareCell(column: QueryGridColumn, row: QueryListRow, formatted: string): HTMLElement {
    const share = column.value(row) === undefined ? undefined : column.share?.(row);
    const cell = document.createElement("span");
    cell.className = "performance-grid-share";
    const label = document.createElement("span");
    label.className = "performance-grid-share-text";
    if (share === undefined) {
        label.textContent = formatted;
        cell.append(label);
        return cell;
    }
    const fill = document.createElement("span");
    fill.className = "performance-grid-share-fill";
    fill.style.width = `${Math.min(100, Math.max(0, share))}%`;
    fill.setAttribute("aria-hidden", "true");
    if (column.showShare === false) {
        label.textContent = formatted;
    } else {
        const shareValue = document.createElement("span");
        shareValue.className = "performance-grid-share-value";
        shareValue.textContent = formatShare(share);
        label.append(shareValue, ` / ${formatted}`);
    }
    cell.append(fill, label);
    return cell;
}

/** The query text on one line, cut after a fixed length. */
function shortQueryText(queryText: string): string {
    // Each run of whitespace, such as a line break and its indent, becomes one space.
    const line = queryText.replace(/\s+/g, " ").trim();
    return line.length > maxQueryTextLength ? `${line.slice(0, maxQueryTextLength)}…` : line;
}

export interface PerformanceDashboardQueryListProps extends PerformanceDashboardQueryGridProps {
    /** The read of the rows. Its message, a skeleton, or the empty text replaces the grid. */
    readonly read: ExtensionRequestState<PerformanceRead<unknown>>;
    readonly emptyText?: string;
}

/** A query grid, or the message, skeleton, or empty text of its read. */
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
    if (isFirstLoad(read)) {
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
