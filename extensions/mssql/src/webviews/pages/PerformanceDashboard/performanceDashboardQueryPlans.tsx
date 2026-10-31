/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Caption1,
    makeStyles,
    MenuItem,
    MessageBar,
    MessageBarBody,
    MessageBarIntent,
    shorthands,
    tokens,
} from "@fluentui/react-components";
import { useMemo, useState } from "react";
import {
    ApplyPlanChangeRequest,
    ComparePlansRequest,
    GetQueryPlansRequest,
    OpenPlanRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
    PreparePlanChangeRequest,
    VerifyForcedPlanRequest,
    type ForcedPlanVerification,
    type PlanChangeBlocker,
    type PlanChangeKind,
    type PlanChangeWarning,
    type PerformanceRead,
    type PreparedPlanChange,
    type QueryStoreInterval,
    type QueryStoreMetric,
    type QueryStorePlan,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { ExtensionRequestState, isFirstLoad } from "../../common/useExtensionRequest";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { ChangeDialog } from "./performanceDashboardChangeDialog";
import { dateTimeFormat, formatNumber } from "./performanceDashboardFormat";
import {
    checkboxCell,
    DashboardGridColumn,
    DashboardGrid,
    gridIcon,
    linkCell,
    textSpan,
    withSwatch,
} from "./performanceDashboardGrid";
import { ChartPanel, StatusBar, readData, usePerformanceRead } from "./performanceDashboardParts";
import { usePlanColor } from "./performanceDashboardPlanColors";
import {
    PlanSummaryChart,
    planSummaryChartHeight,
    useHistorySelection,
    useQueryHistory,
} from "./performanceDashboardPlanHistory";
import { useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { ChartSkeleton, TableSkeleton } from "./performanceDashboardSkeletons";
import { metrics } from "./performanceDashboardMetrics";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useViewTimeRange } from "./performanceDashboardTimeRange";

const useStyles = makeStyles({
    plans: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("12px"),
        flex: "1 0 auto",
    },
    // The actions for the selected plans, above the grid.
    bar: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        ...shorthands.gap("12px"),
    },
    secondary: {
        color: tokens.colorNeutralForeground3,
        whiteSpace: "nowrap",
        overflowX: "hidden",
        textOverflow: "ellipsis",
    },
    selectionCount: {
        fontWeight: tokens.fontWeightSemibold,
    },
    actions: {
        display: "flex",
        flexWrap: "wrap",
        ...shorthands.gap("8px"),
    },
    review: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("10px"),
        ...shorthands.padding("12px", "16px"),
        ...shorthands.border("1px", "solid", "var(--vscode-panel-border)"),
        ...shorthands.borderRadius(tokens.borderRadiusMedium),
    },
});

type ChangeStage =
    | { readonly stage: "idle" }
    | { readonly stage: "review"; readonly prepared: PreparedPlanChange }
    | {
          readonly stage: "applied";
          readonly kind: PlanChangeKind;
          readonly planId: string;
          readonly appliedAtUtc?: string;
      };

interface Notice {
    readonly intent: MessageBarIntent;
    readonly text: string;
}

// The Fluent icons of the plan link and of a failed force.
const openIconPath =
    "M4 3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V7a.5.5 0 0 1 1 0v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4c0-1.1.9-2 2-2h1a.5.5 0 0 1 0 1H4Zm3 0a.5.5 0 0 1 0-1h2.5c.28 0 .5.22.5.5V5a.5.5 0 0 1-1 0V3.7L7.35 5.36a.5.5 0 1 1-.7-.7L8.29 3H7Z";
const warningIconPath =
    "M8.75 10.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM7.5 8a.5.5 0 0 0 1 0V5.5a.5.5 0 0 0-1 0V8Zm-.6-5.36c.49-.86 1.71-.86 2.2 0l4.74 8.5c.47.83-.14 1.86-1.09 1.86h-9.5a1.25 1.25 0 0 1-1.1-1.86l4.76-8.5Zm1.32.49a.25.25 0 0 0-.44 0l-4.75 8.5c-.1.16.03.37.22.37h9.5c.2 0 .31-.2.22-.37l-4.75-8.5Z";

/** The metrics of the plans grid and the compare tab, which share the read of the plans. */
export const planMetrics: readonly QueryStoreMetric[] = ["duration", "cpuTime", "memoryGrant"];

/** No history intervals, the same array on each render so the chart does not draw again. */
const noIntervals: readonly QueryStoreInterval[] = [];

/**
 * The plans of the query in the time range. The Plans and Compare tabs and the execution history
 * send the same read, so the others come from the cache, and the plans have the same colors.
 */
export function useQueryPlans(
    queryId: string,
): ExtensionRequestState<PerformanceRead<readonly QueryStorePlan[]>> {
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey } = useRefresh();
    const { window } = useViewTimeRange();
    return usePerformanceRead(
        GetQueryPlansRequest.type,
        { queryId, metrics: planMetrics, ...window },
        [databaseName, refreshKey],
    );
}

/**
 * The plans of the query in the time range: each plan's runs, mean duration and CPU, last
 * execution, and force status. Select one or two plans to open their XML, compare them, or force or unforce a plan
 * after a review of the T-SQL.
 */
export const PerformanceDashboardQueryPlans = ({ queryId }: { queryId: string }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { extensionRpc } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const { refresh } = useRefresh();
    const { range } = useViewTimeRange();
    const [selected, setSelected] = useState<readonly string[]>([]);
    const [change, setChange] = useState<ChangeStage>({ stage: "idle" });
    const [busy, setBusy] = useState(false);
    const [applyError, setApplyError] = useState<string | undefined>(undefined);
    const [notice, setNotice] = useState<Notice | undefined>(undefined);
    const [verification, setVerification] = useState<ForcedPlanVerification | undefined>(undefined);

    const plansRead = useQueryPlans(queryId);
    const plansData = readData(plansRead);
    const plans = plansData ?? [];
    const planIds = useMemo(() => (plansData ?? []).map((plan) => plan.planId), [plansData]);
    const colorOf = usePlanColor(planIds);
    const { metric, view } = useHistorySelection();
    const historyRead = useQueryHistory(queryId);
    const historyMessage = readStatusMessage(historyRead);
    const intervals = readData(historyRead) ?? noIntervals;

    const message = readStatusMessage(plansRead);
    if (message) {
        return <StatusBar message={message} />;
    }
    if (isFirstLoad(plansRead)) {
        return (
            <div className={classes.plans}>
                <ChartPanel chart={<ChartSkeleton height={planSummaryChartHeight} />} />
                <TableSkeleton rows={3} />
            </div>
        );
    }
    if (plans.length === 0) {
        return <Caption1 className={classes.secondary}>{text.noPlans}</Caption1>;
    }

    const toggle = (planId: string, checked: boolean) =>
        setSelected(
            checked
                ? [...selected.filter((id) => id !== planId), planId].slice(-2)
                : selected.filter((id) => id !== planId),
        );
    const run = async (work: () => Promise<void>) => {
        setBusy(true);
        setNotice(undefined);
        try {
            await work();
        } catch (error) {
            setNotice({
                intent: "error",
                text: text.readFailed(error instanceof Error ? error.message : String(error)),
            });
        } finally {
            setBusy(false);
        }
    };

    const openPlans = (ids: readonly string[]) =>
        run(async () => {
            for (const planId of ids) {
                const { opened } = await extensionRpc.sendRequest(OpenPlanRequest.type, {
                    queryId,
                    planId,
                });
                if (!opened) {
                    setNotice({ intent: "warning", text: text.planXmlNotFound(planId) });
                }
            }
        });

    const comparePlans = (first: string, second: string) =>
        run(async () => {
            const { opened } = await extensionRpc.sendRequest(ComparePlansRequest.type, {
                queryId,
                planIds: [first, second],
            });
            if (!opened) {
                setNotice({ intent: "warning", text: text.planCompareFailed });
            }
        });

    const prepare = (kind: PlanChangeKind, planId: string) =>
        run(async () => {
            setVerification(undefined);
            setApplyError(undefined);
            const result = await extensionRpc.sendRequest(PreparePlanChangeRequest.type, {
                kind,
                queryId,
                planId,
            });
            if ("data" in result && result.data) {
                setChange({ stage: "review", prepared: result.data });
            } else {
                const status = readStatusMessage({ loading: false, result });
                setNotice(status ?? { intent: "error", text: text.readFailed(result.status) });
            }
        });

    // A failure stays in the change dialog; a success closes it and reloads the whole page, so
    // the badge, the stats, and the plans show the new state.
    const apply = async (prepared: PreparedPlanChange) => {
        setBusy(true);
        setApplyError(undefined);
        try {
            const result = await extensionRpc.sendRequest(ApplyPlanChangeRequest.type, prepared);
            if ("data" in result && result.data?.applied) {
                setChange({
                    stage: "applied",
                    kind: prepared.target.kind,
                    planId: prepared.target.planId,
                    appliedAtUtc: result.data.appliedAtUtc,
                });
                setNotice({
                    intent: "success",
                    text:
                        prepared.target.kind === "forcePlan"
                            ? text.planForced(prepared.target.planId)
                            : text.planUnforced(prepared.target.planId),
                });
                refresh();
            } else if ("data" in result && result.data) {
                setApplyError(result.data.blockers.map(planBlockerText).join(" "));
            } else {
                const status = readStatusMessage({ loading: false, result });
                setApplyError(status?.text ?? text.readFailed(result.status));
            }
        } catch (error) {
            setApplyError(text.readFailed(error instanceof Error ? error.message : String(error)));
        } finally {
            setBusy(false);
        }
    };

    const verify = (planId: string, sinceUtc: string) =>
        run(async () => {
            const result = await extensionRpc.sendRequest(VerifyForcedPlanRequest.type, {
                queryId,
                planId,
                sinceUtc,
            });
            if ("data" in result && result.data) {
                setVerification(result.data);
            } else {
                const status = readStatusMessage({ loading: false, result });
                setNotice(status ?? { intent: "error", text: text.readFailed(result.status) });
            }
        });

    const prepareForce = (plan: QueryStorePlan) =>
        prepare(plan.isForced ? "unforcePlan" : "forcePlan", plan.planId);

    return (
        <div className={classes.plans}>
            {notice && (
                <MessageBar intent={notice.intent}>
                    <MessageBarBody>{notice.text}</MessageBarBody>
                </MessageBar>
            )}
            {historyMessage ? (
                <StatusBar message={historyMessage} />
            ) : isFirstLoad(historyRead) ? (
                <ChartPanel chart={<ChartSkeleton height={planSummaryChartHeight} />} />
            ) : (
                <ChartPanel
                    chart={
                        <PlanSummaryChart
                            intervals={intervals}
                            metric={metric}
                            view={view}
                            planIds={planIds}
                            colorOf={colorOf}
                            format={formatNumber}
                            range={range}
                        />
                    }
                />
            )}
            <div className={classes.bar}>
                <Caption1 className={classes.secondary}>
                    {selected.length === 0 ? (
                        text.selectPlans
                    ) : (
                        <>
                            <span className={classes.selectionCount}>
                                {selected.length === 1
                                    ? text.onePlanSelected
                                    : text.twoPlansSelected}
                            </span>
                            {selected.length === 1 && ` · ${text.selectTwoToCompare}`}
                        </>
                    )}
                </Caption1>
                <div className={classes.actions}>
                    <Button
                        size="small"
                        appearance="primary"
                        disabled={busy || selected.length !== 2}
                        onClick={() => void comparePlans(selected[0], selected[1])}>
                        {text.comparePlansAction}
                    </Button>
                </div>
            </div>
            <DashboardGrid<QueryStorePlan>
                items={plans}
                getRowId={(plan) => plan.planId}
                ariaLabel={text.plans}
                defaultSort={{ column: "lastExecuted", direction: "descending" }}
                isSelected={(plan) => selected.includes(plan.planId)}
                menuButtonLabel={(plan) => text.planActions(plan.planId)}
                menuItems={(plan) => (
                    <>
                        <MenuItem onClick={() => void openPlans([plan.planId])}>
                            {text.openPlanXml}
                        </MenuItem>
                        <MenuItem
                            disabled={busy || change.stage === "review"}
                            onClick={() => void prepareForce(plan)}>
                            {plan.isForced ? text.unforcePlan : text.forcePlan}
                        </MenuItem>
                    </>
                )}
                columns={[
                    {
                        id: "select",
                        header: "",
                        control: true,
                        text: () => "",
                        render: (plan) =>
                            checkboxCell(
                                selected.includes(plan.planId),
                                text.selectPlan(plan.planId),
                            ),
                        activate: (plan) => toggle(plan.planId, !selected.includes(plan.planId)),
                    },
                    {
                        id: "plan",
                        header: text.plan,
                        width: 96,
                        text: (plan) => plan.planId,
                        title: (plan) => text.openPlan(plan.planId),
                        sortValue: (plan) => Number(plan.planId),
                        render: (plan) =>
                            withSwatch(
                                colorOf(plan.planId),
                                linkCell(plan.planId, "#", openIconPath),
                            ),
                        activate: (plan) => void openPlans([plan.planId]),
                    },
                    {
                        id: "runs",
                        header: text.runs,
                        numeric: true,
                        width: 96,
                        text: (plan) => formatNumber(plan.executionCount),
                        sortValue: (plan) => plan.executionCount,
                    },
                    averageColumn("mean", text.mean, "duration"),
                    averageColumn("cpu", text.meanCpu, "cpuTime"),
                    {
                        id: "lastExecuted",
                        header: text.lastExecuted,
                        grow: true,
                        width: 180,
                        text: (plan) =>
                            plan.lastExecutionTimeUtc
                                ? dateTimeFormat.format(new Date(plan.lastExecutionTimeUtc))
                                : "—",
                        sortValue: lastExecuted,
                    },
                    {
                        id: "force",
                        header: text.force,
                        width: 180,
                        text: forceText,
                        title: forceFailure,
                        render: forceCell,
                    },
                ]}
            />
            {change.stage === "review" && (
                <ChangeDialog
                    title={
                        change.prepared.target.kind === "forcePlan"
                            ? text.reviewForcePlan(change.prepared.target.planId)
                            : text.reviewUnforcePlan(change.prepared.target.planId)
                    }
                    sql={change.prepared.sql}
                    blockers={change.prepared.blockers.map(planBlockerText)}
                    warnings={change.prepared.warnings.map(planWarningText)}
                    error={applyError}
                    busy={busy}
                    onApply={() => void apply(change.prepared)}
                    onCancel={() => setChange({ stage: "idle" })}
                />
            )}
            {change.stage === "applied" && change.kind === "forcePlan" && change.appliedAtUtc && (
                <div className={classes.review}>
                    <Caption1 className={classes.secondary}>{text.verifyExplanation}</Caption1>
                    {verification && (
                        <MessageBar intent={verificationIntent(verification)}>
                            <MessageBarBody>{verificationText(verification)}</MessageBarBody>
                        </MessageBar>
                    )}
                    <div className={classes.actions}>
                        <Button
                            size="small"
                            disabled={busy}
                            onClick={() => void verify(change.planId, change.appliedAtUtc!)}>
                            {text.verifyForcedPlan}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};

/** When the plan last ran, in milliseconds, or 0 when Query Store has no time. */
function lastExecuted(plan: QueryStorePlan): number {
    const time = plan.lastExecutionTimeUtc ? Date.parse(plan.lastExecutionTimeUtc) : NaN;
    return Number.isNaN(time) ? 0 : time;
}

/** The average of a metric for each execution of the plan, with the exact value as its title. */
function averageColumn(
    id: string,
    header: string,
    metric: "duration" | "cpuTime",
): DashboardGridColumn<QueryStorePlan> {
    const average = (plan: QueryStorePlan) => plan.metrics[metric]?.avg;
    return {
        id,
        header,
        numeric: true,
        width: 120,
        text: (plan) => {
            const value = average(plan);
            return value === undefined ? "—" : metrics[metric].display(value);
        },
        title: (plan) => {
            const value = average(plan);
            return value === undefined ? undefined : metrics[metric].exact(value);
        },
        sortValue: average,
    };
}

/** The force status of a plan. */
function forceText(plan: QueryStorePlan): string {
    const text = loc.performanceDashboard;
    return !plan.isForced
        ? text.notForced
        : plan.forcingType === "auto"
          ? text.forcedAutomatically
          : text.forcedManually;
}

/** Why forcing the plan last failed, if it did. */
function forceFailure(plan: QueryStorePlan): string | undefined {
    return plan.lastForceFailureReason
        ? loc.performanceDashboard.forceFailed(plan.lastForceFailureReason)
        : undefined;
}

/** The force status on one line, with a warning icon when forcing last failed. */
function forceCell(plan: QueryStorePlan): HTMLElement {
    const failure = forceFailure(plan);
    const status = textSpan(forceText(plan));
    if (!failure) {
        return status;
    }
    const cell = document.createElement("span");
    cell.className = "performance-grid-with-icon";
    const warning = document.createElement("span");
    warning.className = "performance-grid-warning";
    warning.setAttribute("role", "img");
    warning.setAttribute("aria-label", failure);
    warning.append(gridIcon(warningIconPath));
    cell.append(status, warning);
    return cell;
}

function planBlockerText(blocker: PlanChangeBlocker): string {
    const text = loc.performanceDashboard;
    switch (blocker) {
        case "queryStoreNotReadWrite":
            return text.planBlockerQueryStoreNotReadWrite;
        case "planNotFound":
            return text.planBlockerPlanNotFound;
        case "planNotForQuery":
            return text.planBlockerPlanNotForQuery;
        case "planAlreadyForced":
            return text.planBlockerAlreadyForced;
        case "planNotForced":
            return text.planBlockerNotForced;
        case "autoForcedPlan":
            return text.planBlockerAutoForced;
        case "dispatcherPlan":
            return text.planBlockerDispatcher;
        case "stateChanged":
            return text.planBlockerStateChanged;
        default:
            return text.blockerPreparedSqlMismatch;
    }
}

function planWarningText(warning: PlanChangeWarning): string {
    const text = loc.performanceDashboard;
    switch (warning) {
        case "replacesForcedPlan":
            return text.planWarningReplacesForced;
        case "planForcingTypeUnknown":
            return text.planWarningForcingTypeUnknown;
        case "variantPlan":
            return text.planWarningVariant;
        case "dispatcherPlan":
            return text.planWarningDispatcher;
        default:
            return text.planWarningPreviousFailures;
    }
}

function verificationIntent(verification: ForcedPlanVerification): MessageBarIntent {
    switch (verification.outcome) {
        case "forcedPlanInUse":
            return "success";
        case "otherPlansInUse":
        case "notForced":
        case "planNotFound":
            return "warning";
        default:
            return "info";
    }
}

function verificationText(verification: ForcedPlanVerification): string {
    const text = loc.performanceDashboard;
    switch (verification.outcome) {
        case "forcedPlanInUse":
            return text.verifyForcedPlanInUse;
        case "otherPlansInUse":
            return text.verifyOtherPlansInUse;
        case "noExecutions":
            return text.verifyNoExecutions;
        case "waitingForNextInterval":
            return text.verifyWaiting;
        case "notForced":
            return text.verifyNotForced;
        default:
            return text.planBlockerPlanNotFound;
    }
}
