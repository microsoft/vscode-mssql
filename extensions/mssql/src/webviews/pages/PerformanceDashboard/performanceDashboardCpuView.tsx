/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, shorthands } from "@fluentui/react-components";
import {
    GetDatabaseFactsRequest,
    GetMetricTotalsRequest,
    GetResourceConsumptionRequest,
    GetResourceCpuRequest,
    GetTopQueriesRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import {
    cpuCapacityMs,
    cpuChartPoints,
    cpuCoreCount,
    cpuSummary,
    cpuSummaryWindows,
} from "./performanceDashboardCpuModel";
import { formatNumber, formatPercent } from "./performanceDashboardFormat";
import { sizeLabel } from "./performanceDashboardOverviewModel";
import {
    ReadOnlyNotice,
    SectionHeader,
    StatusBar,
    SummaryCard,
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
    const { match } = useNavigation<PerformanceDashboardRoute>();
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

    let summary;
    let points;
    let whole: number | undefined;
    if (fromResourceStats) {
        const average = averageResourceCpu(samples, range.from.getTime(), range.to.getTime());
        summary = (
            <SummaryCard
                value={average !== undefined ? formatPercent(average) : text.notAvailable}
                caption={text.averageCpuUsed}
                info={text.cpuFromResourceStats}
                loading={resourceCpu.loading && samples.length === 0}
                changes={[
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
                ]}
            />
        );
        points = resourceCpuPoints(samples, range, bucketMinutesFor(range));
        // Without cores, each query shows its share of the CPU time of all queries.
        whole = totalsData?.windows[0]?.total || undefined;
    } else {
        const cpu = totalsData ? cpuSummary(totalsData.windows, cores, availableFrom) : undefined;
        const average =
            cpu?.averagePercent !== undefined
                ? formatPercent(cpu.averagePercent)
                : cpu?.averageBusyCores !== undefined
                  ? formatNumber(cpu.averageBusyCores)
                  : text.notAvailable;
        summary = (
            <SummaryCard
                value={average}
                caption={coresLabel ? text.averageCpuUsedOf(coresLabel) : text.averageBusyCores}
                info={coresLabel ? text.cpuEstimateWithCores(coresLabel) : text.cpuEstimate}
                loading={totals.loading && !cpu}
                changes={[
                    { label: text.overLast24Hours, value: cpu?.change24Hours },
                    { label: text.overLast7Days, value: cpu?.change7Days },
                ]}
            />
        );
        points = cpuChartPoints(readData(consumption), range, availableFrom, cores);
        whole = cpuCapacityMs(range, availableFrom, cores);
    }
    const percent = fromResourceStats || cores !== undefined;
    const chartRead = fromResourceStats ? resourceCpu : consumption;

    const rows = queryListRows(readData(topQueries), whole);
    const columns: QueryGridColumn[] = [
        ...(rows.some((row) => row.share !== undefined)
            ? [
                  {
                      id: "share",
                      header: fromResourceStats ? text.shareOfCpu : text.cpuUse,
                      value: (row: { share?: number }) => row.share,
                      format: formatPercent,
                      bar: true,
                  },
              ]
            : []),
        {
            id: "total",
            header: text.totalCpuMs,
            value: (row) => row.value,
            format: formatNumber,
        },
        {
            id: "perExecution",
            header: text.cpuPerExecutionMs,
            value: (row) =>
                row.value !== undefined && row.executions > 0
                    ? row.value / row.executions
                    : undefined,
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
        <div className={classes.view}>
            {isReadOnly(totals) && <ReadOnlyNotice />}
            {summary}
            <TimeSeriesChart
                title={text.cpuUse}
                points={points}
                format={percent ? formatPercent : formatNumber}
                yMax={percent ? 100 : undefined}
                read={chartRead}
                message={readStatusMessage(chartRead)}
            />
            <SectionHeader title={text.highCpuQueries} />
            <PerformanceDashboardQueryList
                read={topQueries}
                rows={rows}
                columns={columns}
                ariaLabel={text.highCpuQueries}
                linkQuery={queryLinkRange(match.query)}
            />
        </div>
    );
};
