/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles, shorthands } from "@fluentui/react-components";
import {
    GetDatabaseFactsRequest,
    GetMetricTotalsRequest,
    GetResourceConsumptionRequest,
    GetResourceCpuRequest,
    GetTopQueriesRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { isFirstLoad, useExtensionRequest } from "../../common/useExtensionRequest";
import {
    cpuChartPoints,
    cpuCoreCount,
    cpuSummary,
    cpuSummaryWindows,
} from "./performanceDashboardCpuModel";
import {
    formatDuration,
    formatMillisecondsExact,
    formatNumber,
    formatPercent,
    formatPercentRounded,
    formatShare,
} from "./performanceDashboardFormat";
import { sizeLabel } from "./performanceDashboardOverviewModel";
import {
    ReadOnlyNotice,
    SectionHeader,
    StatusBar,
    SummaryCard,
    SummaryCardProps,
    TimeSeriesChart,
    isReadOnly,
    readData,
} from "./performanceDashboardParts";
import { PerformanceDashboardQueryList, QueryGridColumn } from "./performanceDashboardQueryGrid";
import { queryListRows } from "./performanceDashboardQueryList";
import { useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import {
    averageResourceCpu,
    bucketMinutesFor,
    resourceCpuChange,
    resourceCpuPoints,
} from "./performanceDashboardSeries";
import { readStatusMessage } from "./performanceDashboardStatus";
import {
    queryLinkRange,
    useQueryStoreAvailableFrom,
    useViewTimeRange,
} from "./performanceDashboardTimeRange";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";

const topQueryCount = 10;
const dayMs = 24 * 60 * 60 * 1000;

const useStyles = makeStyles({
    view: {
        display: "flex",
        flexDirection: "column",
        flex: "1 0 auto",
        ...shorthands.gap("16px"),
    },
});

/**
 * CPU use over the time range, and the queries that used the most CPU. CPU use is the Query
 * Store CPU time against the cores. The Basic, S0, and S1 tiers of Azure SQL Database have no
 * core count, so there it comes from the resource stats, like in the Azure portal.
 */
export const PerformanceDashboardCpuView = () => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const key = [databaseName, refreshKey];
    const { router, match, navigate } = useNavigation<PerformanceDashboardRoute>();
    const { range, window, now } = useViewTimeRange();
    const availableFrom = useQueryStoreAvailableFrom();

    const facts = useExtensionRequest(GetDatabaseFactsRequest.type, undefined, databaseName);
    const databaseFacts = facts.result?.facts;
    const cores = cpuCoreCount(databaseFacts);
    const factsKnown = !facts.loading || !!facts.result;
    const fromResourceStats =
        factsKnown && cores === undefined && facts.result?.platform === "azureSqlDatabase";

    const totals = useExtensionRequest(
        GetMetricTotalsRequest.type,
        { metric: "cpuTime", windows: cpuSummaryWindows(range, now) },
        key,
    );
    const consumption = useExtensionRequest(
        GetResourceConsumptionRequest.type,
        window,
        key,
        factsKnown && !fromResourceStats,
    );
    // Up to 14 days, for the changes over the last 7 days.
    const resourceCpu = useExtensionRequest(
        GetResourceCpuRequest.type,
        {
            startUtc: new Date(
                Math.min(range.from.getTime(), now.getTime() - 14 * dayMs),
            ).toISOString(),
            endUtc: now.toISOString(),
        },
        key,
        fromResourceStats,
    );
    const topQueries = useExtensionRequest(
        GetTopQueriesRequest.type,
        { ...window, metric: "cpuTime", top: topQueryCount },
        key,
    );

    // A message that applies to the whole view replaces it, such as Query Store being off.
    const blocking = readStatusMessage(totals);
    if (blocking) {
        return <StatusBar message={blocking} />;
    }

    const coresLabel =
        cores === undefined
            ? undefined
            : sizeLabel(
                  cores === databaseFacts?.vCores ? { vCores: cores } : { logicalCpus: cores },
              );
    const totalsData = readData(totals);
    const samples = readData(resourceCpu) ?? [];
    const nowMs = now.getTime();

    let summary: Omit<SummaryCardProps, "children">;
    let points;
    if (fromResourceStats) {
        const average = averageResourceCpu(samples, range.from.getTime(), range.to.getTime());
        summary = {
            label: text.averageCpu,
            value: average !== undefined ? formatPercentRounded(average) : text.notAvailable,
            detail: text.ofDtuLimit,
            info: text.cpuFromResourceStats,
            loading: resourceCpu.loading && samples.length === 0,
            changes: [
                {
                    label: text.overLast24Hours,
                    value: resourceCpuChange(
                        samples,
                        { start: nowMs - dayMs, end: nowMs },
                        { start: nowMs - 2 * dayMs, end: nowMs - dayMs },
                    ),
                },
                {
                    label: text.overLast7Days,
                    value: resourceCpuChange(
                        samples,
                        { start: nowMs - 7 * dayMs, end: nowMs },
                        { start: nowMs - 14 * dayMs, end: nowMs - 7 * dayMs },
                    ),
                },
            ],
        };
        points = resourceCpuPoints(samples, range, bucketMinutesFor(range));
    } else {
        const cpu = totalsData ? cpuSummary(totalsData.windows, cores, availableFrom) : undefined;
        const average =
            cpu?.averagePercent !== undefined
                ? formatPercentRounded(cpu.averagePercent)
                : cpu?.averageBusyCores !== undefined
                  ? formatNumber(cpu.averageBusyCores)
                  : text.notAvailable;
        summary = {
            label: coresLabel ? text.averageCpu : text.averageBusyCores,
            value: average,
            detail: coresLabel ? text.ofCpuSize(coresLabel) : undefined,
            info: coresLabel ? text.cpuEstimateWithCores(coresLabel) : text.cpuEstimate,
            loading: totals.loading && !cpu,
            changes: [
                { label: text.overLast24Hours, value: cpu?.change24Hours },
                { label: text.overLast7Days, value: cpu?.change7Days },
            ],
        };
        points = cpuChartPoints(readData(consumption), range, availableFrom, cores);
    }
    const percent = fromResourceStats || cores !== undefined;
    const chartRead = fromResourceStats ? resourceCpu : consumption;

    // Each query shows its share of the CPU time of all queries in the range.
    const rows = queryListRows(readData(topQueries), totalsData?.windows[0]?.total || undefined);
    const columns: QueryGridColumn[] = [
        {
            id: "cpuTime",
            header: text.cpuTime,
            value: (row) => row.value,
            format: formatDuration,
            exact: formatMillisecondsExact,
            share: (row) => row.share,
            shareTitle: (share, value) =>
                text.shareOfAllQueries(formatShare(share), formatMillisecondsExact(value)),
        },
        {
            id: "perExecution",
            header: text.cpuPerExecution,
            value: (row) =>
                row.value !== undefined && row.executions > 0
                    ? row.value / row.executions
                    : undefined,
            format: formatDuration,
            exact: formatMillisecondsExact,
        },
        {
            id: "executions",
            header: text.executionCount,
            value: (row) => row.executions,
            format: formatNumber,
        },
    ];
    // The Queries view ranks by CPU by default, so the link needs only the time range.
    const allQueries = router.build("queries", {}, queryLinkRange(match.query));

    return (
        <div className={classes.view}>
            {isReadOnly(totals) && <ReadOnlyNotice />}
            <SummaryCard {...summary}>
                <TimeSeriesChart
                    title={text.cpuUse}
                    points={points}
                    format={percent ? formatPercent : formatNumber}
                    yMax={percent ? 100 : undefined}
                    read={chartRead}
                    message={readStatusMessage(chartRead)}
                />
            </SummaryCard>
            <SectionHeader
                title={text.topQueriesByCpu}
                count={rows.length > 0 ? text.queryCount(rows.length) : undefined}
                action={
                    <Link
                        href={"#" + allQueries}
                        onClick={(event) => {
                            event.preventDefault();
                            navigate(allQueries);
                        }}>
                        {text.viewAllQueries}
                    </Link>
                }
            />
            <PerformanceDashboardQueryList
                read={topQueries}
                pending={isFirstLoad(totals)}
                rows={rows}
                columns={columns}
                ariaLabel={text.topQueriesByCpu}
                linkQuery={queryLinkRange(match.query)}
            />
        </div>
    );
};
