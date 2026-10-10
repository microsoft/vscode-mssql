/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles, Switch } from "@fluentui/react-components";
import { useMemo, useState } from "react";
import type { QueryStoreMetric } from "../../../sharedInterfaces/performance";
import {
    GetMetricTotalsRequest,
    GetTopQueriesDetailedRequest,
    GetTopQueriesRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { SegmentedControl } from "../../common/segmentedControl";
import { isFirstLoad, useExtensionRequest } from "../../common/useExtensionRequest";
import { useFavoriteQueries } from "./performanceDashboardFavorites";
import { MetricStatistic } from "./performanceDashboardMetrics";
import { SectionHeader, readData } from "./performanceDashboardParts";
import { PerformanceDashboardQueryList, QueryGridColumn } from "./performanceDashboardQueryGrid";
import { QueryCategory, QueryListRow, queryListRows } from "./performanceDashboardQueryList";
import { useRefresh } from "./performanceDashboardRefresh";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { queryLinkRange, useViewTimeRange } from "./performanceDashboardTimeRange";

/** The queries that a section lists. */
const topQueryCount = 10;

const useStyles = makeStyles({
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        flex: "1 0 auto",
    },
    toolbar: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px 16px",
    },
});

export interface QueryListSpec {
    readonly title: () => string;
    /** The metric that the list ranks by. */
    readonly metric: QueryStoreMetric;
    /** The statistics to switch between; the first is the default. None ranks by the total. */
    readonly statistics?: readonly MetricStatistic[];
    /** Reads the statistic of every metric for each query, for columns of other metrics. */
    readonly detailed?: boolean;
    /** The columns after the star, the ID, and the text, for the statistic of the list. */
    readonly columns: (statistic: MetricStatistic) => QueryGridColumn[];
    /** The category of the Queries view that "More queries" opens. */
    readonly category: QueryCategory;
}

/**
 * The top queries of a metric in the time range: a title with the count and a link to more
 * queries, the statistic to rank by, a favorites filter, and the grid. A total shows each query's
 * share of the total of all queries; another statistic compares each query with the highest.
 * The grid shows when its rows and the total are both read, so the bars do not change after.
 */
export const QueryListSection = ({ spec }: { spec: QueryListSpec }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { router, match, navigate } = useNavigation<PerformanceDashboardRoute>();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const { window } = useViewTimeRange();
    const favorites = useFavoriteQueries();
    const [chosen, setChosen] = useState<MetricStatistic | undefined>(undefined);
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const statistic = chosen ?? spec.statistics?.[0] ?? "total";
    const isTotal = statistic === "total";
    const key = [databaseName, refreshKey];

    const params = { ...window, metric: spec.metric, statistic, top: topQueryCount };
    const report = useExtensionRequest(
        spec.detailed ? GetTopQueriesDetailedRequest.type : GetTopQueriesRequest.type,
        params,
        key,
    );
    const totals = useExtensionRequest(
        GetMetricTotalsRequest.type,
        { metric: spec.metric, windows: [window] },
        key,
        isTotal,
    );
    const whole = isTotal ? readData(totals)?.windows[0]?.total || undefined : undefined;

    const rows = useMemo(() => {
        const all = queryListRows(readData(report), whole, spec.metric);
        const highest = all.reduce((max, row) => Math.max(max, row.value ?? 0), 0);
        const withShares: QueryListRow[] = isTotal
            ? all
            : all.map((row) => ({
                  ...row,
                  ...(highest > 0 && row.value !== undefined
                      ? { share: (row.value / highest) * 100 }
                      : {}),
              }));
        return favoritesOnly
            ? withShares.filter((row) => favorites.queryIds.has(row.queryId))
            : withShares;
    }, [report, whole, spec.metric, isTotal, favoritesOnly, favorites.queryIds]);

    const allQueries = router.build(
        "queries",
        {},
        {
            ...queryLinkRange(match.query),
            ...(spec.category === "cpu" ? {} : { category: spec.category }),
        },
    );

    return (
        <section className={classes.section} aria-label={spec.title()}>
            <SectionHeader
                title={spec.title()}
                count={rows.length > 0 ? text.queryCount(rows.length) : undefined}
                action={
                    <Link
                        href={`#${allQueries}`}
                        onClick={(event) => {
                            event.preventDefault();
                            navigate(allQueries);
                        }}>
                        {text.moreQueries}
                    </Link>
                }
            />
            <div className={classes.toolbar}>
                {spec.statistics && spec.statistics.length > 1 ? (
                    <SegmentedControl<MetricStatistic>
                        size="small"
                        ariaLabel={text.rankBy}
                        value={statistic}
                        options={spec.statistics.map((value) => ({
                            value,
                            label: value === "avg" ? text.averageShort : text.total,
                        }))}
                        onValueChange={setChosen}
                    />
                ) : (
                    <span />
                )}
                <Switch
                    label={text.favoritesOnly}
                    checked={favoritesOnly}
                    onChange={(_event, data) => setFavoritesOnly(data.checked)}
                />
            </div>
            <PerformanceDashboardQueryList
                read={report}
                pending={isTotal && isFirstLoad(totals)}
                rows={rows}
                columns={spec.columns(statistic)}
                ariaLabel={spec.title()}
                favorites={favorites}
                linkQuery={queryLinkRange(match.query)}
                emptyText={favoritesOnly ? text.noMatchingQueries : text.noQueries}
            />
        </section>
    );
};
