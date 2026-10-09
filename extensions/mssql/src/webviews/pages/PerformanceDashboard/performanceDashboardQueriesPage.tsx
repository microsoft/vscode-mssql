/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    makeStyles,
    SearchBox,
    shorthands,
    Switch,
    Tab,
    TabList,
} from "@fluentui/react-components";
import { useEffect, useMemo, useState } from "react";
import type { QueryStoreStatistic } from "../../../sharedInterfaces/performance";
import { GetTopQueriesRequest } from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import { formatNumber } from "./performanceDashboardFormat";
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
        ...shorthands.gap("16px"),
    },
    controls: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        ...shorthands.gap("12px"),
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

    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return queryListRows(readData(topQueries)).filter(
            (row) =>
                (!favoritesOnly || favorites.queryIds.has(row.queryId)) &&
                (!needle ||
                    row.queryId.includes(needle) ||
                    row.queryText.toLowerCase().includes(needle)),
        );
    }, [topQueries, search, favoritesOnly, favorites.queryIds]);

    const setQuery = (values: Record<string, string | undefined>) =>
        navigate(router.build("queries", {}, { ...match.query, ...values }));

    const columns: QueryGridColumn[] =
        category === "executions"
            ? [
                  {
                      id: "executions",
                      header: text.executionCount,
                      value: (row) => row.executions,
                      format: formatNumber,
                  },
              ]
            : [
                  {
                      id: "value",
                      header: text.rankedMetric(
                          statisticLabel(statistic),
                          categoryMetricLabel(category),
                      ),
                      value: (row) => row.value,
                      format: formatNumber,
                  },
                  {
                      id: "executions",
                      header: text.executionCount,
                      value: (row) => row.executions,
                      format: formatNumber,
                  },
              ];

    return (
        <div className={classes.page}>
            <TabList
                appearance="filled-circular"
                size="small"
                selectedValue={category}
                aria-label={text.queryCategory}
                onTabSelect={(_event, data) =>
                    setQuery({ category: data.value === "cpu" ? undefined : String(data.value) })
                }>
                {queryCategories.map((value) => (
                    <Tab key={value} value={value}>
                        {categoryLabel(value)}
                    </Tab>
                ))}
            </TabList>
            <div className={classes.controls}>
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

function categoryMetricLabel(category: QueryCategory): string {
    const text = loc.performanceDashboard;
    switch (category) {
        case "cpu":
            return text.cpuMs;
        case "duration":
            return text.durationMs;
        default:
            return text.logicalReadsKb;
    }
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
