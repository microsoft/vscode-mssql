/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, SearchBox, shorthands, Switch } from "@fluentui/react-components";
import { useEffect, useMemo, useState } from "react";
import type { QueryStoreStatistic } from "../../../sharedInterfaces/performance";
import {
    GetMetricTotalsRequest,
    GetTopQueriesRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { SegmentedControl } from "../../common/segmentedControl";
import { isFirstLoad, useExtensionRequest } from "../../common/useExtensionRequest";
import {
    formatDuration,
    formatMegabytes,
    formatMillisecondsExact,
    formatNumber,
    formatShare,
} from "./performanceDashboardFormat";
import { useFavoriteQueries } from "./performanceDashboardFavorites";
import { InlineSelect, ReadOnlyNotice, isReadOnly, readData } from "./performanceDashboardParts";
import { PerformanceDashboardQueryList, QueryGridColumn } from "./performanceDashboardQueryGrid";
import {
    QueryCategory,
    queryCategories,
    queryCategoryMetrics,
    queryListRows,
    rankStatistics,
} from "./performanceDashboardQueryList";
import { useRefresh } from "./performanceDashboardRefresh";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { queryLinkRange, useViewTimeRange } from "./performanceDashboardTimeRange";

/** The queries that each category lists. */
const queryCount = 25;

const useStyles = makeStyles({
    page: {
        display: "flex",
        flexDirection: "column",
        flex: "1 0 auto",
        ...shorthands.gap("16px"),
    },
    controls: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        ...shorthands.gap("12px", "20px"),
    },
    grow: {
        flexGrow: 1,
    },
    search: {
        width: "260px",
    },
});

/**
 * The top queries of the database in four categories: high CPU, longest running, most frequent,
 * and high reads, ranked by a statistic. The category, the statistic, and the time range are in
 * the location, for example `queries?category=duration&rank=avg&range=7d`.
 */
export const PerformanceDashboardQueriesPage = () => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { router, match, navigate } = useNavigation<PerformanceDashboardRoute>();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const { window } = useViewTimeRange();
    const favorites = useFavoriteQueries();
    const [search, setSearch] = useState("");
    const [favoritesOnly, setFavoritesOnly] = useState(false);

    const category = queryCategories.includes(match.query.category as QueryCategory)
        ? (match.query.category as QueryCategory)
        : "cpu";
    const metric = queryCategoryMetrics[category];
    // Executions have only a total.
    const statistic: QueryStoreStatistic =
        category !== "executions" &&
        rankStatistics.includes(match.query.rank as QueryStoreStatistic)
            ? (match.query.rank as QueryStoreStatistic)
            : "total";

    useEffect(() => setSearch(""), [databaseName]);

    const topQueries = useExtensionRequest(
        GetTopQueriesRequest.type,
        { ...window, metric, statistic, top: queryCount },
        [databaseName, refreshKey],
    );

    // A total has a share of the total of all queries. Other statistics are not parts of a
    // whole, so their bars compare each query with the highest one.
    const isTotal = statistic === "total";
    const totals = useExtensionRequest(
        GetMetricTotalsRequest.type,
        { metric, windows: [window] },
        [databaseName, refreshKey],
        isTotal,
    );
    const whole = isTotal ? readData(totals)?.windows[0]?.total || undefined : undefined;

    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase();
        const all = queryListRows(readData(topQueries), whole);
        const highest = all.reduce((max, row) => Math.max(max, row.value ?? 0), 0);
        return (
            isTotal
                ? all
                : all.map((row) => ({
                      ...row,
                      ...(highest > 0 && row.value !== undefined
                          ? { share: (row.value / highest) * 100 }
                          : {}),
                  }))
        ).filter(
            (row) =>
                (!favoritesOnly || favorites.queryIds.has(row.queryId)) &&
                (!needle ||
                    row.queryId.includes(needle) ||
                    row.queryText.toLowerCase().includes(needle)),
        );
    }, [topQueries, whole, isTotal, search, favoritesOnly, favorites.queryIds]);

    const setQuery = (values: Record<string, string | undefined>) =>
        navigate(router.build("queries", {}, { ...match.query, ...values }));

    const format = categoryFormat(category);
    const ranked: QueryGridColumn = {
        id: "value",
        header:
            category === "executions"
                ? text.executionCount
                : text.rankedMetric(statisticLabel(statistic), categoryMetricName(category)),
        value: (row) => (category === "executions" ? row.executions : row.value),
        format: format.format,
        exact: format.exact,
        share: (row) => row.share,
        showShare: isTotal,
        shareTitle: isTotal
            ? (share, value) => text.shareOfAllQueries(formatShare(share), format.exact(value))
            : undefined,
    };
    const columns: QueryGridColumn[] =
        category === "executions"
            ? [ranked]
            : [
                  ranked,
                  {
                      id: "executions",
                      header: text.executionCount,
                      value: (row) => row.executions,
                      format: formatNumber,
                  },
              ];

    return (
        <div className={classes.page}>
            <div className={classes.controls}>
                <SegmentedControl<QueryCategory>
                    size="small"
                    ariaLabel={text.queryCategory}
                    value={category}
                    options={queryCategories.map((value) => ({
                        value,
                        label: categoryShortLabel(value),
                    }))}
                    onValueChange={(value) =>
                        setQuery({ category: value === "cpu" ? undefined : value })
                    }
                />
                {category !== "executions" && (
                    <InlineSelect<QueryStoreStatistic>
                        label={text.rankBy}
                        value={statistic}
                        options={rankStatistics.map((value) => ({
                            value,
                            label: statisticLabel(value),
                        }))}
                        onChange={(value) =>
                            setQuery({ rank: value === "total" ? undefined : value })
                        }
                    />
                )}
                <span className={classes.grow} />
                <SearchBox
                    className={classes.search}
                    size="small"
                    placeholder={text.searchQueries}
                    aria-label={text.searchQueries}
                    value={search}
                    onChange={(_event, data) => setSearch(data.value)}
                />
                <Switch
                    label={text.favoritesOnly}
                    checked={favoritesOnly}
                    onChange={(_event, data) => setFavoritesOnly(data.checked)}
                />
            </div>
            {isReadOnly(topQueries) && <ReadOnlyNotice />}
            <PerformanceDashboardQueryList
                read={topQueries}
                pending={isTotal && isFirstLoad(totals)}
                rows={rows}
                columns={columns}
                ariaLabel={categoryLabel(category)}
                favorites={favorites}
                visibleRows={queryCount}
                linkQuery={queryLinkRange(match.query)}
                emptyText={favoritesOnly || search ? text.noMatchingQueries : text.noQueries}
            />
        </div>
    );
};

export function categoryLabel(category: QueryCategory): string {
    const text = loc.performanceDashboard;
    switch (category) {
        case "cpu":
            return text.highCpuQueries;
        case "duration":
            return text.longestRunningQueries;
        case "executions":
            return text.mostFrequentQueries;
        default:
            return text.highReadQueries;
    }
}

/** The label of a category in the category picker. */
function categoryShortLabel(category: QueryCategory): string {
    const text = loc.performanceDashboard;
    switch (category) {
        case "cpu":
            return text.highCpu;
        case "duration":
            return text.longestRunning;
        case "executions":
            return text.mostFrequent;
        default:
            return text.highReads;
    }
}

/** The metric of a category after a statistic, for example the "CPU time" of Total CPU time. */
function categoryMetricName(category: QueryCategory): string {
    const text = loc.performanceDashboard;
    switch (category) {
        case "cpu":
            return text.cpuTime;
        case "duration":
            return text.durationMetric;
        default:
            return text.logicalReadsMetric;
    }
}

/** The formats of the values of a category: readable, and exact for the tooltip. */
function categoryFormat(category: QueryCategory): {
    format: (value: number) => string;
    exact: (value: number) => string;
} {
    switch (category) {
        case "cpu":
        case "duration":
            return { format: formatDuration, exact: formatMillisecondsExact };
        case "reads":
            // The reports give reads in KB.
            return { format: formatMegabytes, exact: formatKilobytesExact };
        default:
            return { format: formatNumber, exact: formatNumber };
    }
}

function formatKilobytesExact(kilobytes: number): string {
    return new Intl.NumberFormat(undefined, {
        style: "unit",
        unit: "kilobyte",
        unitDisplay: "short",
        maximumFractionDigits: 0,
    }).format(kilobytes);
}

export function statisticLabel(statistic: QueryStoreStatistic): string {
    const text = loc.performanceDashboard;
    switch (statistic) {
        case "avg":
            return text.average;
        case "max":
            return text.maximum;
        case "min":
            return text.minimum;
        case "stdev":
            return text.standardDeviation;
        default:
            return text.total;
    }
}
