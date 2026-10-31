/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, SearchBox, shorthands, Switch } from "@fluentui/react-components";
import { useEffect, useMemo, useState } from "react";
import {
    ContinueInChatRequest,
    GetTopQueriesRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
    SetQueryCategoryRequest,
    type ChatPrompt,
    type QueryCategory,
    type QueryStoreStatistic,
} from "../../../sharedInterfaces/performanceDashboard";
import { GithubCopilot16Regular } from "../../common/icons/fluentIcons";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { SegmentedControl } from "../../common/segmentedControl";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { formatNumber, formatShare } from "./performanceDashboardFormat";
import { useFavoriteQueries } from "./performanceDashboardFavorites";
import { metrics } from "./performanceDashboardMetrics";
import {
    InlineSelect,
    ReadOnlyNotice,
    isReadOnly,
    readData,
    usePerformanceRead,
} from "./performanceDashboardParts";
import {
    PerformanceDashboardQueryList,
    QueryGridColumn,
    QueryRowAction,
} from "./performanceDashboardQueryGrid";
import {
    queryCategories,
    queryCategoryRanking,
    queryListRows,
    rankStatistics,
    toQueryCategory,
} from "./performanceDashboardQueryList";
import type { HistoryMetric, HistoryView } from "./performanceDashboardPlanHistory";
import { useRefresh } from "./performanceDashboardRefresh";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { useViewTimeRange } from "./performanceDashboardTimeRange";

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
 * The top queries of the database in five categories: high CPU, high memory, duration, most
 * frequent, and high reads, ranked by a statistic. The category and the statistic are in the
 * location, for example `queries?category=duration&rank=avg`. Without a category, the page shows
 * the one that the user chose last, which the extension saves.
 */
export const PerformanceDashboardQueriesPage = () => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { router, match, navigate } = useNavigation<PerformanceDashboardRoute>();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const { window } = useViewTimeRange();
    const { extensionRpc } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const favorites = useFavoriteQueries();
    const [search, setSearch] = useState("");
    const [favoritesOnly, setFavoritesOnly] = useState(false);

    const savedCategory = usePerformanceDashboardSelector((state) => state.queryCategory);
    const category =
        toQueryCategory(match.query.category) ?? toQueryCategory(savedCategory) ?? "cpu";
    const rankBy = queryCategoryRanking[category];
    // Executions have only a total.
    const statistic: QueryStoreStatistic =
        category !== "executions" &&
        rankStatistics.includes(match.query.rank as QueryStoreStatistic)
            ? (match.query.rank as QueryStoreStatistic)
            : "total";

    useEffect(() => setSearch(""), [databaseName]);

    const topQueries = usePerformanceRead(
        GetTopQueriesRequest.type,
        { ...window, rankBy, statistic, top: queryCount },
        [databaseName, refreshKey],
    );

    const isTotal = statistic === "total";
    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return queryListRows(readData(topQueries), rankBy, statistic).filter(
            (row) =>
                (!favoritesOnly || favorites.queryIds.has(row.queryId)) &&
                (!needle ||
                    row.queryId.includes(needle) ||
                    row.queryText.toLowerCase().includes(needle)),
        );
    }, [topQueries, rankBy, statistic, search, favoritesOnly, favorites.queryIds]);

    // The menu of each row asks Copilot Chat to analyze or explain its query.
    const rowActions = useMemo<readonly QueryRowAction[]>(() => {
        const chat = (prompt: ChatPrompt) => (queryId: string) =>
            void extensionRpc.sendRequest(ContinueInChatRequest.type, {
                prompt,
                queryId,
                ...window,
            });
        return [
            {
                label: loc.performanceDashboard.analyzeInChat,
                icon: <GithubCopilot16Regular />,
                run: chat("analyze"),
            },
            {
                label: loc.performanceDashboard.explainInChat,
                icon: <GithubCopilot16Regular />,
                run: chat("explain"),
            },
        ];
    }, [extensionRpc, window]);

    // A query opens at the metric and statistic of the list, so its page shows what ranked it.
    const queryPageQuery = useMemo(
        () => queryPageQueryOf(category, statistic),
        [category, statistic],
    );

    const setQuery = (values: Record<string, string | undefined>) =>
        navigate(router.build("queries", {}, { ...match.query, ...values }));

    // The grid builds its columns again when these change, so they change only with the view.
    const columns = useMemo<QueryGridColumn[]>(() => {
        const columnText = loc.performanceDashboard;
        const format = categoryFormat(category);
        const ranked: QueryGridColumn = {
            id: "value",
            header:
                category === "executions"
                    ? columnText.executionCount
                    : columnText.rankedMetric(
                          statisticLabel(statistic),
                          categoryMetricName(category),
                      ),
            value: (row) => (category === "executions" ? row.executions : row.value),
            format: format.format,
            exact: format.exact,
            share: (row) => row.share,
            showShare: isTotal,
            shareTitle: isTotal
                ? (share, value) =>
                      columnText.shareOfAllQueries(formatShare(share), format.exact(value))
                : undefined,
        };
        return category === "executions"
            ? [ranked]
            : [
                  ranked,
                  {
                      id: "executions",
                      header: columnText.executionCount,
                      value: (row) => row.executions,
                      format: formatNumber,
                  },
              ];
    }, [category, statistic, isTotal]);

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
                    onValueChange={(value) => {
                        // The category stays in the location, so the saved one does not apply.
                        setQuery({ category: value });
                        void extensionRpc.sendRequest(SetQueryCategoryRequest.type, {
                            category: value,
                        });
                    }}
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
                rows={rows}
                columns={columns}
                ariaLabel={categoryLabel(category)}
                favorites={favorites}
                rowActions={rowActions}
                queryPageQuery={queryPageQuery}
                emptyText={favoritesOnly || search ? text.noMatchingQueries : text.noQueries}
            />
        </div>
    );
};

/**
 * The metric and statistic of the query page for a category and its ranking: CPU for the CPU
 * queries, and the average for a list ranked by the average. The defaults, duration and total,
 * are left out of the location.
 */
function queryPageQueryOf(
    category: QueryCategory,
    statistic: QueryStoreStatistic,
): Record<string, string | undefined> {
    const metric: HistoryMetric | undefined = (
        {
            cpu: "cpuTime",
            duration: undefined,
            memory: "memoryGrant",
            executions: undefined,
            reads: "logicalReads",
        } as const
    )[category];
    // The charts show the total, the average, the maximum, or the minimum.
    const view: HistoryView | undefined =
        category !== "executions" &&
        (statistic === "avg" || statistic === "max" || statistic === "min")
            ? statistic
            : undefined;
    return { metric, view };
}

export function categoryLabel(category: QueryCategory): string {
    const text = loc.performanceDashboard;
    switch (category) {
        case "cpu":
            return text.highCpuQueries;
        case "duration":
            return text.durationQueries;
        case "memory":
            return text.highMemoryQueries;
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
            return text.durationCategory;
        case "memory":
            return text.highMemory;
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
        case "memory":
            return text.metricMemory;
        default:
            return text.logicalReadsMetric;
    }
}

/** The formats of the values of a category: readable, and exact for the tooltip. */
/** The formats of the values of a category, from the metric catalog: with the unit, and exact. */
function categoryFormat(category: QueryCategory): {
    format: (value: number) => string;
    exact: (value: number) => string;
} {
    const definition = {
        cpu: metrics.cpuTime,
        duration: metrics.duration,
        memory: metrics.memoryGrant,
        executions: metrics.executions,
        reads: metrics.logicalReads,
    }[category];
    return { format: definition.display, exact: definition.exact };
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
