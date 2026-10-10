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
import { useState } from "react";
import type {
    ForcedPlanVerification,
    PlanChangeBlocker,
    PlanChangeWarning,
    PlanShape,
    PreparedChange,
    QueryPlanInfo,
} from "../../../sharedInterfaces/performance";
import {
    ApplyPlanChangeRequest,
    ComparePlansRequest,
    GetPlanShapesRequest,
    GetQueryHistoryRequest,
    GetQueryPlansRequest,
    OpenPlanRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
    PreparePlanChangeRequest,
    VerifyForcedPlanRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { isFirstLoad, useExtensionRequest } from "../../common/useExtensionRequest";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { ChangeDialog } from "./performanceDashboardChangeDialog";
import { formatNumber } from "./performanceDashboardFormat";
import { ChartPanel, StatusBar, readData } from "./performanceDashboardParts";
import { usePlanColor } from "./performanceDashboardPlanColors";
import {
    PlanSummaryChart,
    planSummaryChartHeight,
    useHistorySelection,
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
    stack: {
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
    },
    secondary: {
        color: tokens.colorNeutralForeground3,
        whiteSpace: "nowrap",
        overflowX: "hidden",
        textOverflow: "ellipsis",
    },
    shape: {
        fontWeight: tokens.fontWeightSemibold,
        whiteSpace: "nowrap",
        overflowX: "hidden",
        textOverflow: "ellipsis",
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
    // The actions for the selected plans, at the bottom of the grid's frame.
    bar: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        ...shorthands.gap("12px"),
        ...shorthands.padding("10px", "16px"),
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
    | { readonly stage: "review"; readonly prepared: PreparedChange }
    | {
          readonly stage: "applied";
          readonly kind: PreparedChange["kind"];
          readonly planId: string;
          readonly appliedAtUtc?: string;
      };

interface Notice {
    readonly intent: MessageBarIntent;
    readonly text: string;
}

/**
 * The plans of the query in the time range: each plan's shape, runs, mean duration, and force
 * status. Select one or two plans to open their XML, compare them, or force or unforce a plan
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
    const [selection, setSelection] = useState<readonly string[] | undefined>(undefined);
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

    const plansRead = useExtensionRequest(GetQueryPlansRequest.type, { queryId, ...window }, [
        databaseName,
        refreshKey,
    ]);
    const plans = readData(plansRead)?.plans ?? [];
    const planIds = plans.map((plan) => plan.planId);
    const colorOf = usePlanColor(planIds);
    const shapesRead = useExtensionRequest(
        GetPlanShapesRequest.type,
        { planIds },
        [databaseName, refreshKey],
        planIds.length > 0,
    );
    const shapes = shapesRead.result?.shapes ?? {};
    const { metric, view } = useHistorySelection();
    const historyRead = useExtensionRequest(GetQueryHistoryRequest.type, { queryId, ...window }, [
        databaseName,
        refreshKey,
    ]);
    const historyMessage = readStatusMessage(historyRead);
    const intervals = readData(historyRead)?.intervals ?? [];

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

    // Until the user selects plans, the two plans that ran most.
    const selected =
        selection ??
        [...plans]
            .sort((left, right) => right.executionCount - left.executionCount)
            .slice(0, 2)
            .map((plan) => plan.planId);
    const toggle = (planId: string, checked: boolean) =>
        setSelection(
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

    const prepare = (kind: PreparedChange["kind"], planId: string) =>
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
    const apply = async (prepared: PreparedChange) => {
        setBusy(true);
        setApplyError(undefined);
        try {
            const result = await extensionRpc.sendRequest(ApplyPlanChangeRequest.type, prepared);
            if ("data" in result && result.data?.applied) {
                setChange({
                    stage: "applied",
                    kind: prepared.kind,
                    planId: prepared.target.planId,
                    appliedAtUtc: result.data.appliedAtUtc,
                });
                setNotice({
                    intent: "success",
                    text:
                        prepared.kind === "forcePlan"
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

    const verify = (planId: string, since: string) =>
        run(async () => {
            const result = await extensionRpc.sendRequest(VerifyForcedPlanRequest.type, {
                queryId,
                planId,
                since,
            });
            if ("data" in result && result.data) {
                setVerification(result.data);
            } else {
                const status = readStatusMessage({ loading: false, result });
                setNotice(status ?? { intent: "error", text: text.readFailed(result.status) });
            }
        });

    const prepareForce = (plan: QueryPlanInfo) =>
        prepare(plan.isForced ? "unforcePlan" : "forcePlan", plan.planId);

    // The row menu compares with another selected plan, when there is one.
    const contextMenuPlan = contextMenu
        ? plans.find((plan) => plan.planId === contextMenu.planId)
        : undefined;
    const compareTarget = contextMenuPlan
        ? selected.find((planId) => planId !== contextMenuPlan.planId)
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
            <SimpleGrid<QueryPlanInfo>
                fill
                items={plans}
                getRowId={(plan) => plan.planId}
                ariaLabel={text.plans}
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
                footer={
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
                }
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
                        id: "shape",
                        header: text.shape,
                        grow: true,
                        minWidth: 240,
                        idealWidth: 360,
                        render: (plan) => (
                            <PlanShapeCell
                                plan={plan}
                                shape={shapes[plan.planId]}
                                loading={shapesRead.loading}
                            />
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
                            (left.avgDurationMs ?? -1) - (right.avgDurationMs ?? -1),
                        render: (plan) =>
                            plan.avgDurationMs !== undefined ? (
                                <span title={metrics.duration.exact(plan.avgDurationMs)}>
                                    {metrics.duration.display(plan.avgDurationMs)}
                                </span>
                            ) : (
                                "—"
                            ),
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
                            {compareTarget && (
                                <MenuItem
                                    onClick={() =>
                                        void comparePlans(compareTarget, contextMenuPlan.planId)
                                    }>
                                    {text.comparePlan(compareTarget)}
                                </MenuItem>
                            )}
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
                        change.prepared.kind === "forcePlan"
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

const PlanShapeCell = ({
    plan,
    shape,
    loading,
}: {
    plan: QueryPlanInfo;
    shape: PlanShape | undefined;
    loading: boolean;
}) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    // A compiled plan is the usual type, so only the other types show.
    const details = [
        plan.planType?.toLowerCase() === "compiled plan" ? undefined : planTypeText(plan.planType),
        shape?.parallel || plan.isParallel ? text.parallel : undefined,
        plan.countCompiles === undefined
            ? undefined
            : plan.countCompiles === 1
              ? text.compiledOnce
              : text.compiledTimes(formatNumber(plan.countCompiles)),
    ].filter(Boolean);
    const summary = shape?.summary || (loading ? text.loadingShape : text.shapeNotAvailable);
    return (
        <span className={classes.stack}>
            <span className={classes.shape} title={summary}>
                {summary}
            </span>
            {details.length > 0 && (
                <Caption1 className={classes.secondary}>{details.join(" · ")}</Caption1>
            )}
        </span>
    );
};

/** The force status on one line, with a warning icon when forcing last failed. */
const ForceCell = ({ plan }: { plan: QueryPlanInfo }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const failure =
        plan.lastForceFailureReason && plan.lastForceFailureReason !== "NONE"
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

function planTypeText(planType: string | undefined): string | undefined {
    const text = loc.performanceDashboard;
    switch (planType?.toLowerCase()) {
        case "compiled plan":
            return text.compiledPlan;
        case "dispatcher plan":
            return text.dispatcherPlan;
        case "query variant plan":
            return text.variantPlan;
        default:
            return planType;
    }
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
