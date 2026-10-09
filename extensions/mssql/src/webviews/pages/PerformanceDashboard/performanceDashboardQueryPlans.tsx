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
    MessageBar,
    MessageBarBody,
    MessageBarIntent,
    shorthands,
    Spinner,
    Text,
    tokens,
} from "@fluentui/react-components";
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
    OpenSqlScriptRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
    PreparePlanChangeRequest,
    VerifyForcedPlanRequest,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { useExtensionRequest } from "../../common/useExtensionRequest";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { formatNumber } from "./performanceDashboardFormat";
import { SectionHeader, StatusBar, readData } from "./performanceDashboardParts";
import { usePlanColor } from "./performanceDashboardPlanColors";
import {
    HistoryControls,
    PlanSummaryChart,
    useHistorySelection,
} from "./performanceDashboardPlanHistory";
import { useRefresh } from "./performanceDashboardRefresh";
import { usePerformanceDashboardSelector } from "./performanceDashboardSelector";
import { SimpleGrid } from "./performanceDashboardSimpleGrid";
import { readStatusMessage } from "./performanceDashboardStatus";
import { useViewTimeRange } from "./performanceDashboardTimeRange";

const useStyles = makeStyles({
    plans: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.gap("12px"),
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
        whiteSpace: "nowrap",
        overflowX: "hidden",
        textOverflow: "ellipsis",
    },
    bar: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        ...shorthands.gap("12px"),
        ...shorthands.padding("10px", "16px"),
        ...shorthands.border("1px", "solid", "var(--vscode-panel-border)"),
        ...shorthands.borderRadius(tokens.borderRadiusMedium),
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
    script: {
        ...shorthands.margin(0),
        ...shorthands.padding("12px"),
        ...shorthands.borderRadius(tokens.borderRadiusMedium),
        backgroundColor: "var(--vscode-textCodeBlock-background)",
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        whiteSpace: "pre-wrap",
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
    const { refreshKey } = useRefresh();
    const { window } = useViewTimeRange();
    const [version, setVersion] = useState(0);
    const [selection, setSelection] = useState<readonly string[] | undefined>(undefined);
    const [change, setChange] = useState<ChangeStage>({ stage: "idle" });
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<Notice | undefined>(undefined);
    const [verification, setVerification] = useState<ForcedPlanVerification | undefined>(undefined);

    const plansRead = useExtensionRequest(GetQueryPlansRequest.type, { queryId, ...window }, [
        databaseName,
        refreshKey,
        version,
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
    if (plansRead.loading && plans.length === 0) {
        return <Spinner size="small" label={loc.common.loading} />;
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
    const single =
        selected.length === 1 ? plans.find((plan) => plan.planId === selected[0]) : undefined;

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

    const comparePlans = () =>
        run(async () => {
            const { opened } = await extensionRpc.sendRequest(ComparePlansRequest.type, {
                queryId,
                planIds: [selected[0], selected[1]],
            });
            if (!opened) {
                setNotice({ intent: "warning", text: text.planCompareFailed });
            }
        });

    const prepare = (kind: PreparedChange["kind"], planId: string) =>
        run(async () => {
            setVerification(undefined);
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

    const apply = (prepared: PreparedChange) =>
        run(async () => {
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
            } else if ("data" in result && result.data) {
                setChange({ stage: "idle" });
                setNotice({
                    intent: "error",
                    text: result.data.blockers.map(planBlockerText).join(" "),
                });
            } else {
                const status = readStatusMessage({ loading: false, result });
                setNotice(status ?? { intent: "error", text: text.readFailed(result.status) });
            }
            setVersion((value) => value + 1);
        });

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

    return (
        <div className={classes.plans}>
            {notice && (
                <MessageBar intent={notice.intent}>
                    <MessageBarBody>{notice.text}</MessageBarBody>
                </MessageBar>
            )}
            <SectionHeader title={text.planSummary} />
            <HistoryControls />
            {historyMessage ? (
                <StatusBar message={historyMessage} />
            ) : historyRead.loading && intervals.length === 0 ? (
                <Spinner size="small" label={loc.common.loading} />
            ) : (
                <PlanSummaryChart
                    intervals={intervals}
                    metric={metric}
                    view={view}
                    planIds={planIds}
                    colorOf={colorOf}
                    format={formatNumber}
                />
            )}
            <SimpleGrid<QueryPlanInfo>
                items={plans}
                getRowId={(plan) => plan.planId}
                ariaLabel={text.plans}
                columns={[
                    {
                        id: "select",
                        header: "",
                        minWidth: 32,
                        idealWidth: 32,
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
                        minWidth: 70,
                        idealWidth: 80,
                        compare: (left, right) => Number(left.planId) - Number(right.planId),
                        render: (plan) => (
                            <span className={classes.plan}>
                                <span
                                    className={classes.swatch}
                                    style={{ backgroundColor: colorOf(plan.planId) }}
                                    aria-hidden
                                />
                                <Link
                                    title={text.openPlan(plan.planId)}
                                    onClick={() => void openPlans([plan.planId])}>
                                    {plan.planId}
                                </Link>
                            </span>
                        ),
                    },
                    {
                        id: "shape",
                        header: text.shape,
                        minWidth: 240,
                        idealWidth: 460,
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
                        idealWidth: 100,
                        compare: (left, right) => left.executionCount - right.executionCount,
                        render: (plan) => formatNumber(plan.executionCount),
                    },
                    {
                        id: "meanMs",
                        header: text.meanMs,
                        numeric: true,
                        idealWidth: 100,
                        compare: (left, right) =>
                            (left.avgDurationMs ?? -1) - (right.avgDurationMs ?? -1),
                        render: (plan) =>
                            plan.avgDurationMs !== undefined
                                ? formatNumber(plan.avgDurationMs)
                                : "—",
                    },
                    {
                        id: "force",
                        header: text.force,
                        idealWidth: 180,
                        render: (plan) => <ForceCell plan={plan} />,
                    },
                ]}
            />
            <div className={classes.bar}>
                <Caption1 className={classes.secondary}>
                    {selected.length === 0
                        ? text.selectPlans
                        : selected.length === 1
                          ? text.onePlanSelected(selected[0])
                          : text.twoPlansSelected(selected[0], selected[1])}
                </Caption1>
                <div className={classes.actions}>
                    <Button
                        size="small"
                        disabled={busy || selected.length === 0}
                        onClick={() => void openPlans(selected)}>
                        {text.openPlanXml}
                    </Button>
                    {single && (
                        <Button
                            size="small"
                            disabled={busy || change.stage === "review"}
                            onClick={() =>
                                void prepare(
                                    single.isForced ? "unforcePlan" : "forcePlan",
                                    single.planId,
                                )
                            }>
                            {single.isForced ? text.unforcePlan : text.forcePlan}
                        </Button>
                    )}
                    <Button
                        size="small"
                        appearance="primary"
                        disabled={busy || selected.length !== 2}
                        onClick={() => void comparePlans()}>
                        {text.comparePlansAction}
                    </Button>
                </div>
            </div>
            {change.stage === "review" && (
                <div className={classes.review}>
                    <Text weight="semibold">
                        {change.prepared.kind === "forcePlan"
                            ? text.reviewForcePlan(change.prepared.target.planId)
                            : text.reviewUnforcePlan(change.prepared.target.planId)}
                    </Text>
                    {change.prepared.blockers.map((blocker) => (
                        <MessageBar key={blocker} intent="error">
                            <MessageBarBody>{planBlockerText(blocker)}</MessageBarBody>
                        </MessageBar>
                    ))}
                    {change.prepared.warnings.map((warning) => (
                        <MessageBar key={warning} intent="warning">
                            <MessageBarBody>{planWarningText(warning)}</MessageBarBody>
                        </MessageBar>
                    ))}
                    <pre className={classes.script}>{change.prepared.sql}</pre>
                    <div className={classes.actions}>
                        <Button
                            size="small"
                            disabled={busy}
                            onClick={() => setChange({ stage: "idle" })}>
                            {loc.common.cancel}
                        </Button>
                        <Button
                            size="small"
                            onClick={() =>
                                void extensionRpc.sendRequest(OpenSqlScriptRequest.type, {
                                    sql: change.prepared.sql,
                                })
                            }>
                            {text.openInQueryEditor}
                        </Button>
                        <Button
                            size="small"
                            appearance="primary"
                            disabled={busy || change.prepared.blockers.length > 0}
                            onClick={() => void apply(change.prepared)}>
                            {busy ? <Spinner size="tiny" /> : loc.common.apply}
                        </Button>
                    </div>
                </div>
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
    const details = [
        planTypeText(plan.planType),
        shape?.parallel || plan.isParallel ? text.parallel : undefined,
        plan.countCompiles !== undefined
            ? text.compiledTimes(formatNumber(plan.countCompiles))
            : undefined,
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

const ForceCell = ({ plan }: { plan: QueryPlanInfo }) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const detail =
        plan.lastForceFailureReason && plan.lastForceFailureReason !== "NONE"
            ? text.forceFailed(plan.lastForceFailureReason)
            : plan.isForced
              ? plan.forcingType === "auto"
                  ? text.forcedAutomatically
                  : text.forcedManually
              : undefined;
    return (
        <span className={classes.stack}>
            <span>{plan.isForced ? text.forced : text.notForced}</span>
            {detail && <Caption1 className={classes.secondary}>{detail}</Caption1>}
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
