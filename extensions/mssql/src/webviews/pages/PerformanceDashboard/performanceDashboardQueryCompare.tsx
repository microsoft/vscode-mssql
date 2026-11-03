/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Caption1,
    Text,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
} from "@fluentui/react-components";
import { Clock16Regular } from "@fluentui/react-icons";
import {
    GetQueryPlansRequest,
    type QueryStorePlan,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useNavigation } from "../../common/navigation/navigationProvider";
import { SegmentedControl } from "../../common/segmentedControl";
import { isFirstLoad } from "../../common/useExtensionRequest";
import { dateTimeFormat, formatNumber } from "./performanceDashboardFormat";
import { metrics } from "./performanceDashboardMetrics";
import {
    InlineSelect,
    StatStrip,
    StatusBar,
    readData,
    usePerformanceRead,
} from "./performanceDashboardParts";
import { usePlanColor } from "./performanceDashboardPlanColors";
import { planMetrics } from "./performanceDashboardQueryPlans";
import { useRefresh } from "./performanceDashboardRefresh";
import { PerformanceDashboardRoute } from "./performanceDashboardRoutes";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { DashboardGrid, textSpan, withSwatch } from "./performanceDashboardGrid";
import { TableSkeleton } from "./performanceDashboardSkeletons";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useViewTimeRange } from "./performanceDashboardTimeRange";

/** The measure that the comparison shows. */
type CompareMetric = "cpu" | "memory";
/** Per execution, or the total of a day, so periods of different length compare fairly. */
type CompareView = "avg" | "perDay";
/** The baseline: a period that ends where the recent one starts. */
type CompareBaseline = "same" | "7d" | "30d";

const dayMs = 24 * 60 * 60 * 1000;

const useStyles = makeStyles({
    // Grows to the bottom of the page, so the plans grid can fill the space left.
    compare: {
        display: "flex",
        flexDirection: "column",
        flex: "1 0 auto",
        gap: "12px",
    },
    controls: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px 16px",
    },
    periods: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px 12px",
    },
    // The recent period comes from the time range at the top, so it reads as set, not as a choice.
    recent: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 10px",
        border: `1px dashed ${tokens.colorNeutralStroke1}`,
        borderRadius: tokens.borderRadiusMedium,
        whiteSpace: "nowrap",
    },
    muted: {
        color: tokens.colorNeutralForeground3,
    },
    panel: {
        border: "1px solid var(--vscode-panel-border)",
        borderRadius: tokens.borderRadiusMedium,
        padding: "14px 16px",
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        alignItems: "center",
        gap: "12px 16px",
    },
    track: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minWidth: 0,
    },
    bar: {
        height: "14px",
        borderRadius: tokens.borderRadiusSmall,
        minWidth: "2px",
    },
    recentBar: {
        backgroundColor: "var(--vscode-charts-blue)",
    },
    baselineBar: {
        backgroundColor: tokens.colorNeutralForeground4,
    },
    barValue: {
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
    },
});

/** The totals of a period: its executions and the total of the measure. */
interface PeriodTotals {
    readonly executions: number;
    readonly total: number;
}

function planTotal(plan: QueryStorePlan, metric: CompareMetric): number {
    return plan.metrics[metric === "cpu" ? "cpuTime" : "memoryGrant"]?.total ?? 0;
}

function periodTotals(plans: readonly QueryStorePlan[], metric: CompareMetric): PeriodTotals {
    return plans.reduce(
        (sum, plan) => ({
            executions: sum.executions + plan.executionCount,
            total: sum.total + planTotal(plan, metric),
        }),
        { executions: 0, total: 0 },
    );
}

/** The value of a period: per execution, or per day of its length. */
function periodValue(
    totals: PeriodTotals,
    view: CompareView,
    lengthMs: number,
): number | undefined {
    if (view === "avg") {
        return totals.executions > 0 ? totals.total / totals.executions : undefined;
    }
    return lengthMs > 0 ? totals.total / (lengthMs / dayMs) : undefined;
}

/** The change from the baseline to the recent value, in percent. */
function changePercent(recent: number | undefined, baseline: number | undefined) {
    return recent !== undefined && baseline !== undefined && baseline > 0
        ? ((recent - baseline) / baseline) * 100
        : undefined;
}

const changeFormat = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
});

/** A change such as +12% or −8%, with a minus sign, not a hyphen. */
function formatChange(percent: number | undefined): string {
    return percent === undefined
        ? "—"
        : `${changeFormat.format(Math.round(percent)).replace("-", "−")}%`;
}

/**
 * The query in the recent period, the time range of the page, against a baseline period before
 * it: per execution or per day, for CPU or memory, overall and for each plan. The two periods
 * never overlap. The choices are in the location, for example
 * `queries/913?tab=compare&compareMetric=memory&baseline=7d`.
 */
export const PerformanceDashboardQueryCompare = ({ queryId }: { queryId: string }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { router, match, navigate } = useNavigation<PerformanceDashboardRoute>();
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const { range, value, presets } = useViewTimeRange();
    const metric: CompareMetric = match.query.compareMetric === "memory" ? "memory" : "cpu";
    const view: CompareView = match.query.compareView === "perDay" ? "perDay" : "avg";
    const baseline: CompareBaseline =
        match.query.baseline === "same" || match.query.baseline === "7d"
            ? match.query.baseline
            : "30d";
    const setQuery = (values: Record<string, string | undefined>) =>
        navigate(router.build("query", match.params, { ...match.query, ...values }));

    const recentMs = range.to.getTime() - range.from.getTime();
    const baselineMs = baseline === "same" ? recentMs : (baseline === "7d" ? 7 : 30) * dayMs;
    const baselineEnd = range.from;
    const baselineStart = new Date(baselineEnd.getTime() - baselineMs);
    const key = [databaseName, refreshKey];
    // The recent read is the Plans tab's read, so it comes from the cache after that tab.
    const recentRead = usePerformanceRead(
        GetQueryPlansRequest.type,
        {
            queryId,
            metrics: planMetrics,
            startUtc: range.from.toISOString(),
            endUtc: range.to.toISOString(),
        },
        key,
    );
    const baselineRead = usePerformanceRead(
        GetQueryPlansRequest.type,
        {
            queryId,
            metrics: planMetrics,
            startUtc: baselineStart.toISOString(),
            endUtc: baselineEnd.toISOString(),
        },
        key,
    );
    const recentPlans = readData(recentRead) ?? [];
    const baselinePlans = readData(baselineRead) ?? [];
    const colorOf = usePlanColor(recentPlans.map((plan) => plan.planId));

    const definition = metric === "cpu" ? metrics.cpuTime : metrics.memoryGrant;
    const format = (amount: number | undefined) =>
        amount === undefined ? text.notAvailable : definition.display(amount);
    const recentValue = periodValue(periodTotals(recentPlans, metric), view, recentMs);
    const baselineValue = periodValue(periodTotals(baselinePlans, metric), view, baselineMs);
    const change = changePercent(recentValue, baselineValue);
    // The cells are drawn outside React, so the change colors are classes of the grid.
    const changeClass = (percent: number | undefined) =>
        percent === undefined || Math.round(percent) === 0
            ? undefined
            : percent > 0
              ? "performance-grid-worse"
              : "performance-grid-better";

    const recentLabel =
        value.kind === "preset"
            ? (presets.find((preset) => preset.id === value.presetId)?.label ?? "")
            : text.timeIntervalRange(
                  dateTimeFormat.format(range.from),
                  dateTimeFormat.format(range.to),
              );
    const baselineLabel = {
        same: text.baselineSameLength,
        "7d": text.baseline7Days,
        "30d": text.baseline30Days,
    }[baseline];
    const metricName = definition.name();
    const valueName =
        view === "avg"
            ? text.rankedMetric(text.averageShort, metricName)
            : text.metricPerDay(metricName);

    // The plans that ran in either period.
    const planIds = [
        ...new Set(
            [...recentPlans, ...baselinePlans]
                .filter((plan) => plan.executionCount > 0)
                .map((plan) => plan.planId),
        ),
    ].sort((left, right) => Number(left) - Number(right));
    const planRows = planIds.map((planId) => {
        const recent = recentPlans.find((plan) => plan.planId === planId);
        const before = baselinePlans.find((plan) => plan.planId === planId);
        const recentPlanValue = recent
            ? periodValue(periodTotals([recent], metric), view, recentMs)
            : undefined;
        const baselinePlanValue = before
            ? periodValue(periodTotals([before], metric), view, baselineMs)
            : undefined;
        return {
            planId,
            recentExecutions: recent?.executionCount ?? 0,
            baselineExecutions: before?.executionCount ?? 0,
            recent: recentPlanValue,
            baseline: baselinePlanValue,
            change: changePercent(recentPlanValue, baselinePlanValue),
        };
    });
    type PlanRow = (typeof planRows)[number];

    const message = readStatusMessage(recentRead) ?? readStatusMessage(baselineRead);
    const loading = isFirstLoad(recentRead) || isFirstLoad(baselineRead);
    const largest = Math.max(recentValue ?? 0, baselineValue ?? 0);
    const barWidth = (amount: number | undefined) =>
        `${largest > 0 && amount !== undefined ? (amount / largest) * 100 : 0}%`;

    return (
        <div className={classes.compare}>
            <div className={classes.controls}>
                <SegmentedControl<CompareMetric>
                    ariaLabel={text.metric}
                    value={metric}
                    options={[
                        { value: "cpu", label: text.compareCpu },
                        { value: "memory", label: text.compareMemory },
                    ]}
                    onValueChange={(next) =>
                        setQuery({ compareMetric: next === "cpu" ? undefined : next })
                    }
                />
                <div className={classes.periods}>
                    <InlineSelect<CompareView>
                        label={text.viewBy}
                        value={view}
                        options={[
                            { value: "avg", label: text.averagePerExecution },
                            { value: "perDay", label: text.totalPerDay },
                        ]}
                        onChange={(next) =>
                            setQuery({ compareView: next === "avg" ? undefined : next })
                        }
                    />
                    <Text className={classes.muted}>{text.compareRecent}</Text>
                    <Tooltip content={text.recentSetByRange} relationship="description">
                        <span className={classes.recent}>
                            <Clock16Regular aria-hidden />
                            {recentLabel}
                        </span>
                    </Tooltip>
                    <Text className={classes.muted}>{text.versus}</Text>
                    <InlineSelect<CompareBaseline>
                        label={text.compareBaseline}
                        value={baseline}
                        options={[
                            { value: "same", label: text.baselineSameLength },
                            { value: "7d", label: text.baseline7Days },
                            { value: "30d", label: text.baseline30Days },
                        ]}
                        onChange={(next) =>
                            setQuery({ baseline: next === "30d" ? undefined : next })
                        }
                    />
                </div>
            </div>
            {message ? (
                <StatusBar message={message} />
            ) : (
                <>
                    <StatStrip
                        loading={loading}
                        stats={[
                            {
                                label: text.recentPeriod(recentLabel.toLocaleLowerCase()),
                                value: format(recentValue),
                            },
                            {
                                label: text.baselinePeriod(baselineLabel.toLocaleLowerCase()),
                                value: format(baselineValue),
                            },
                            { label: text.change, value: formatChange(change) },
                        ]}
                    />
                    {loading ? (
                        <TableSkeleton rows={2} numberColumns={4} />
                    ) : planRows.length === 0 ? (
                        <Caption1 className={classes.muted}>{text.noCompareData}</Caption1>
                    ) : (
                        <>
                            <div className={classes.panel} aria-label={valueName}>
                                <Text>{text.compareRecent}</Text>
                                <span className={classes.track}>
                                    <span
                                        className={mergeClasses(classes.bar, classes.recentBar)}
                                        style={{ width: barWidth(recentValue) }}
                                    />
                                    <Caption1 className={classes.barValue}>
                                        {format(recentValue)}
                                    </Caption1>
                                </span>
                                <Text>{text.compareBaseline}</Text>
                                <span className={classes.track}>
                                    <span
                                        className={mergeClasses(classes.bar, classes.baselineBar)}
                                        style={{ width: barWidth(baselineValue) }}
                                    />
                                    <Caption1 className={classes.barValue}>
                                        {format(baselineValue)}
                                    </Caption1>
                                </span>
                            </div>
                            <DashboardGrid<PlanRow>
                                items={planRows}
                                getRowId={(row) => row.planId}
                                ariaLabel={text.plans}
                                columns={[
                                    {
                                        id: "plan",
                                        header: text.plan,
                                        width: 90,
                                        text: (row) => row.planId,
                                        sortValue: (row) => Number(row.planId),
                                        render: (row) =>
                                            withSwatch(colorOf(row.planId), textSpan(row.planId)),
                                    },
                                    {
                                        id: "executions",
                                        header: text.executionsRecentBaseline,
                                        numeric: true,
                                        width: 200,
                                        sortValue: (row) => row.recentExecutions,
                                        text: (row) =>
                                            `${formatNumber(row.recentExecutions)} / ${formatNumber(row.baselineExecutions)}`,
                                    },
                                    {
                                        id: "recent",
                                        header: text.recentColumn(valueName),
                                        numeric: true,
                                        width: 160,
                                        sortValue: (row) => row.recent,
                                        text: (row) => format(row.recent),
                                    },
                                    {
                                        id: "baseline",
                                        header: text.baselineColumn(valueName),
                                        numeric: true,
                                        width: 160,
                                        sortValue: (row) => row.baseline,
                                        text: (row) => format(row.baseline),
                                    },
                                    {
                                        id: "change",
                                        header: text.change,
                                        numeric: true,
                                        width: 100,
                                        sortValue: (row) => row.change,
                                        text: (row) => formatChange(row.change),
                                        render: (row) =>
                                            textSpan(
                                                formatChange(row.change),
                                                changeClass(row.change),
                                            ),
                                    },
                                ]}
                            />
                        </>
                    )}
                    <Caption1 className={classes.muted}>{text.compareNote}</Caption1>
                </>
            )}
        </div>
    );
};
