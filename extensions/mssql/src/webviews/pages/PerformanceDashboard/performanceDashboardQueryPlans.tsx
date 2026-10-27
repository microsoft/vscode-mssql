/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Caption1,
    Checkbox,
    Link,
    makeStyles,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MessageBar,
    MessageBarBody,
    MessageBarIntent,
    PositioningVirtualElement,
    shorthands,
    tokens,
} from "@fluentui/react-components";
import { MoreHorizontal16Regular, Open12Regular, Warning16Regular } from "@fluentui/react-icons";
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
    type PreparedPlanChange,
    type QueryStoreInterval,
    type QueryStoreMetric,
    type QueryStorePlan,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { isFirstLoad, useExtensionRequest } from "../../common/useExtensionRequest";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { ChangeDialog } from "./performanceDashboardChangeDialog";
import { dateTimeFormat, formatNumber } from "./performanceDashboardFormat";
import { ChartPanel, StatusBar, readData } from "./performanceDashboardParts";
import { usePlanColor } from "./performanceDashboardPlanColors";
import {
    PlanSummaryChart,
    planSummaryChartHeight,
    useHistorySelection,
    useQueryHistory,
} from "./performanceDashboardPlanHistory";
import { useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { SimpleGrid } from "./performanceDashboardSimpleGrid";
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
    plan: {
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("8px"),
    },
    swatch: {
        width: "10px",
        height: "10px",
        flexShrink: 0,
        ...shorthands.borderRadius("2px"),
    },
    planLink: {
        display: "inline-flex",
        alignItems: "center",
        ...shorthands.gap("4px"),
    },
    force: {
        display: "inline-flex",
        alignItems: "center",
        ...shorthands.gap("6px"),
        whiteSpace: "nowrap",
    },
    forceWarning: {
        display: "inline-flex",
        flexShrink: 0,
        color: tokens.colorPaletteYellowForeground1,
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

/** The metrics of the plans grid and the compare tab, which share the read of the plans. */
export const planMetrics: readonly QueryStoreMetric[] = ["duration", "cpuTime", "memoryGrant"];

/** No history intervals, the same array on each render so the chart does not draw again. */
const noIntervals: readonly QueryStoreInterval[] = [];

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
    const databaseName = usePerformanceDashboardSelector((state) => state.databaseName);
    const { refreshKey, refresh } = useRefresh();
    const { window, range } = useViewTimeRange();
    const [selected, setSelected] = useState<readonly string[]>([]);
    const [change, setChange] = useState<ChangeStage>({ stage: "idle" });
    const [busy, setBusy] = useState(false);
    const [applyError, setApplyError] = useState<string | undefined>(undefined);
    const [notice, setNotice] = useState<Notice | undefined>(undefined);
    const [verification, setVerification] = useState<ForcedPlanVerification | undefined>(undefined);
    // The menu of a row: at the pointer for a right-click, or under the row's actions button.
    const [contextMenu, setContextMenu] = useState<
        | { readonly planId: string; readonly target: PositioningVirtualElement | HTMLElement }
        | undefined
    >(undefined);

    const plansRead = useExtensionRequest(
        GetQueryPlansRequest.type,
        { queryId, metrics: planMetrics, ...window },
        [databaseName, refreshKey],
    );
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

    const contextMenuPlan = contextMenu
        ? plans.find((plan) => plan.planId === contextMenu.planId)
        : undefined;

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
            <SimpleGrid<QueryStorePlan>
                fill
                items={plans}
                getRowId={(plan) => plan.planId}
                ariaLabel={text.plans}
                defaultSort={{ column: "lastExecuted", direction: "descending" }}
                isSelected={(plan) => selected.includes(plan.planId)}
                onRowContextMenu={(plan, event) => {
                    event.preventDefault();
                    const { clientX: x, clientY: y } = event;
                    setContextMenu({
                        planId: plan.planId,
                        target: {
                            getBoundingClientRect: () =>
                                ({
                                    x,
                                    y,
                                    top: y,
                                    left: x,
                                    bottom: y,
                                    right: x,
                                    width: 0,
                                    height: 0,
                                }) as DOMRect,
                        },
                    });
                }}
                columns={[
                    {
                        id: "select",
                        header: "",
                        control: true,
                        idealWidth: 40,
                        render: (plan) => (
                            <Checkbox
                                aria-label={text.selectPlan(plan.planId)}
                                checked={selected.includes(plan.planId)}
                                onChange={(_event, data) => toggle(plan.planId, !!data.checked)}
                            />
                        ),
                    },
                    {
                        id: "plan",
                        header: text.plan,
                        idealWidth: 96,
                        compare: (left, right) => Number(left.planId) - Number(right.planId),
                        render: (plan) => (
                            <span className={classes.plan}>
                                <span
                                    className={classes.swatch}
                                    style={{ backgroundColor: colorOf(plan.planId) }}
                                    aria-hidden
                                />
                                <Link
                                    className={classes.planLink}
                                    title={text.openPlan(plan.planId)}
                                    onClick={() => void openPlans([plan.planId])}>
                                    {plan.planId}
                                    <Open12Regular aria-hidden />
                                </Link>
                            </span>
                        ),
                    },
                    {
                        id: "runs",
                        header: text.runs,
                        numeric: true,
                        idealWidth: 96,
                        compare: (left, right) => left.executionCount - right.executionCount,
                        render: (plan) => formatNumber(plan.executionCount),
                    },
                    {
                        id: "mean",
                        header: text.mean,
                        numeric: true,
                        idealWidth: 120,
                        compare: (left, right) =>
                            (left.metrics.duration?.avg ?? -1) -
                            (right.metrics.duration?.avg ?? -1),
                        render: (plan) => <AverageCell plan={plan} metric="duration" />,
                    },
                    {
                        id: "cpu",
                        header: text.meanCpu,
                        numeric: true,
                        idealWidth: 120,
                        compare: (left, right) =>
                            (left.metrics.cpuTime?.avg ?? -1) - (right.metrics.cpuTime?.avg ?? -1),
                        render: (plan) => <AverageCell plan={plan} metric="cpuTime" />,
                    },
                    {
                        id: "lastExecuted",
                        header: text.lastExecuted,
                        grow: true,
                        idealWidth: 180,
                        compare: (left, right) => lastExecuted(left) - lastExecuted(right),
                        render: (plan) =>
                            plan.lastExecutionTimeUtc
                                ? dateTimeFormat.format(new Date(plan.lastExecutionTimeUtc))
                                : "—",
                    },
                    {
                        id: "force",
                        header: text.force,
                        idealWidth: 180,
                        render: (plan) => <ForceCell plan={plan} />,
                    },
                    {
                        id: "actions",
                        header: "",
                        control: true,
                        idealWidth: 40,
                        render: (plan) => (
                            <Button
                                appearance="subtle"
                                size="small"
                                icon={<MoreHorizontal16Regular />}
                                aria-label={text.planActions(plan.planId)}
                                title={text.planActions(plan.planId)}
                                aria-haspopup="menu"
                                onClick={(event) =>
                                    setContextMenu({
                                        planId: plan.planId,
                                        target: event.currentTarget,
                                    })
                                }
                            />
                        ),
                    },
                ]}
            />
            {contextMenuPlan && (
                <Menu
                    open
                    positioning={{
                        target: contextMenu?.target,
                        position: "below",
                        align: contextMenu?.target instanceof HTMLElement ? "end" : "start",
                    }}
                    onOpenChange={(_event, data) => !data.open && setContextMenu(undefined)}>
                    <MenuPopover>
                        <MenuList>
                            <MenuItem onClick={() => void openPlans([contextMenuPlan.planId])}>
                                {text.openPlanXml}
                            </MenuItem>
                            <MenuItem
                                disabled={busy || change.stage === "review"}
                                onClick={() => void prepareForce(contextMenuPlan)}>
                                {contextMenuPlan.isForced ? text.unforcePlan : text.forcePlan}
                            </MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            )}
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
const AverageCell = ({
    plan,
    metric,
}: {
    plan: QueryStorePlan;
    metric: "duration" | "cpuTime";
}) => {
    const average = plan.metrics[metric]?.avg;
    return average !== undefined ? (
        <span title={metrics[metric].exact(average)}>{metrics[metric].display(average)}</span>
    ) : (
        <>—</>
    );
};

/** The force status on one line, with a warning icon when forcing last failed. */
const ForceCell = ({ plan }: { plan: QueryStorePlan }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const failure = plan.lastForceFailureReason
        ? text.forceFailed(plan.lastForceFailureReason)
        : undefined;
    return (
        <span className={classes.force}>
            {!plan.isForced
                ? text.notForced
                : plan.forcingType === "auto"
                  ? text.forcedAutomatically
                  : text.forcedManually}
            {failure && (
                <span
                    className={classes.forceWarning}
                    role="img"
                    aria-label={failure}
                    title={failure}>
                    <Warning16Regular />
                </span>
            )}
        </span>
    );
};

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
