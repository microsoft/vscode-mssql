/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Field,
    MessageBar,
    Spinner,
    Text,
    Textarea,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import type { SqlDiagnosticsState } from "../../../sharedInterfaces/sqlDiagnostics";
import { LocConstants } from "../../common/locConstants";
import { SqlDiagnosticsContext } from "./sqlDiagnosticsStateProvider";
import { useContext, useEffect, useState } from "react";
import { useSqlDiagnosticsSelector } from "./sqlDiagnosticsSelector";
import { compareQueryStorePlans } from "sql-feature/diagnostics/querystore";

const useStyles = makeStyles({
    root: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "8px 12px",
        padding: "8px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    plan: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "2px",
    },
});

export function QueryStorePlanInspector({
    state,
}: {
    state: SqlDiagnosticsState["queryStorePlan"];
}) {
    const styles = useStyles();
    const context = useContext(SqlDiagnosticsContext);
    const capabilities = useSqlDiagnosticsSelector((value) => value.queryStoreInterventions);
    const queryStore = useSqlDiagnosticsSelector((value) => value.queryStore);
    const queryStoreHint = useSqlDiagnosticsSelector((value) => value.queryStoreHint);
    const queryStorePlans = useSqlDiagnosticsSelector((value) => value.queryStorePlans);
    const [hint, setHint] = useState("");
    const [comparisonPlanIds, setComparisonPlanIds] = useState<number[]>([]);
    const queryId = state?.queryId ?? queryStorePlans?.queryId;
    useEffect(() => {
        if (queryStoreHint && !queryStoreHint.loading) setHint(queryStoreHint.hint ?? "");
    }, [queryStoreHint?.queryId, queryStoreHint?.hint, queryStoreHint?.loading]);
    useEffect(() => {
        setComparisonPlanIds([]);
    }, [queryId]);
    const loc = LocConstants.getInstance().queryStorePlan;
    const selectedPlan = queryStorePlans?.plans.find((plan) => plan.planId === state?.planId);
    const comparisonPlans = queryStorePlans?.plans.filter((plan) =>
        comparisonPlanIds.includes(plan.planId),
    );
    const comparison =
        comparisonPlans?.length === 2
            ? compareQueryStorePlans(
                  comparisonPlans[0],
                  comparisonPlans[1],
                  comparisonPlans[0].selectedMetricAverage,
                  comparisonPlans[1].selectedMetricAverage,
                  5,
              )
            : undefined;
    const canApplyIntervention = queryStore?.canConfigure === true;
    const displayTime = (value: string) => new Date(value).toLocaleString();
    if (!queryId) return null;
    const planState = state;
    return (
        <section className={styles.root} aria-label={loc.title}>
            <Text weight="semibold">{loc.title}</Text>
            {queryStorePlans && queryStorePlans.queryId === queryId && (
                <Field label={loc.plans(queryId)}>
                    {queryStorePlans.loading && <Spinner size="tiny" label={loc.loading} />}
                    {!queryStorePlans.loading && queryStorePlans.error && (
                        <MessageBar intent="warning">{queryStorePlans.error}</MessageBar>
                    )}
                    {!queryStorePlans.loading &&
                        !queryStorePlans.error &&
                        queryStorePlans.plans.length === 0 && <Text>{loc.noPlans}</Text>}
                    {queryStorePlans.plans.map((plan) => (
                        <div key={plan.planId} className={styles.plan}>
                            <Checkbox
                                checked={comparisonPlanIds.includes(plan.planId)}
                                label={loc.comparePlan(plan.planId)}
                                onChange={() => {
                                    setComparisonPlanIds((current) =>
                                        current.includes(plan.planId)
                                            ? current.filter((planId) => planId !== plan.planId)
                                            : current.length < 2
                                              ? [...current, plan.planId]
                                              : current,
                                    );
                                }}
                            />
                            <Button
                                appearance={
                                    planState?.planId === plan.planId ? "primary" : "subtle"
                                }
                                onClick={() =>
                                    context?.inspectQueryStorePlan(queryId, plan.planId)
                                }>
                                {loc.selectPlan(plan.planId)}:{" "}
                                {plan.isForced ? loc.planForced : loc.planNotForced}
                            </Button>
                            <Text size={200}>
                                {loc.evidence(plan.executions, plan.observedIntervals)}
                            </Text>
                            {plan.firstInterval && plan.lastInterval && (
                                <Text size={200}>
                                    {loc.observed(
                                        displayTime(plan.firstInterval),
                                        displayTime(plan.lastInterval),
                                    )}
                                </Text>
                            )}
                        </div>
                    ))}
                </Field>
            )}
            {comparison && (
                <Field label={loc.comparisonTitle}>
                    {comparison.status === "comparable" && comparison.metricRatio !== undefined ? (
                        <Text>
                            {loc.comparison(
                                comparison.firstPlanId,
                                comparison.secondPlanId,
                                Number(comparison.metricRatio.toFixed(2)),
                            )}
                        </Text>
                    ) : (
                        <Text>
                            {loc.comparisonUnavailable(
                                comparison.reason
                                    ? loc.comparisonReasons[comparison.reason]
                                    : loc.comparisonReasons.plansMissing,
                            )}
                        </Text>
                    )}
                    <Text size={200}>{loc.comparisonLimit}</Text>
                </Field>
            )}
            {planState && <Text>{loc.selected(planState.queryId, planState.planId)}</Text>}
            {selectedPlan && (
                <>
                    <Text size={200}>
                        {loc.evidence(selectedPlan.executions, selectedPlan.observedIntervals)}
                    </Text>
                    {selectedPlan.firstInterval && selectedPlan.lastInterval && (
                        <Text size={200}>
                            {loc.observed(
                                displayTime(selectedPlan.firstInterval),
                                displayTime(selectedPlan.lastInterval),
                            )}
                        </Text>
                    )}
                </>
            )}
            {planState?.loading && <Spinner size="tiny" label={loc.loading} />}
            {!planState?.loading && planState?.error && (
                <MessageBar intent="warning">{planState.error}</MessageBar>
            )}
            {planState && !planState.loading && (
                <>
                    {planState.inspection?.complete && (
                        <Button disabled={!context} onClick={() => context?.openQueryStorePlan()}>
                            {loc.open}
                        </Button>
                    )}
                    {capabilities?.planForcing && (
                        <Button
                            appearance={planState.isForced ? "secondary" : "primary"}
                            disabled={!canApplyIntervention}
                            onClick={() =>
                                context?.queryStorePlanAction(
                                    planState.queryId,
                                    planState.planId,
                                    planState.isForced ? "unforce" : "force",
                                )
                            }>
                            {planState.isForced ? loc.unforce : loc.force}
                        </Button>
                    )}
                    <Text>{planState.isForced ? loc.forced : loc.notForced}</Text>
                    {planState.forceFailureCount !== undefined &&
                        planState.forceFailureCount > 0 && (
                            <Text>{loc.forceFailureCount(planState.forceFailureCount)}</Text>
                        )}
                    {planState.forceFailureReason && (
                        <Text>{loc.forceFailure(planState.forceFailureReason)}</Text>
                    )}
                </>
            )}
            {!planState?.loading && planState?.inspection?.reason === "missing" && (
                <Text>{loc.missing}</Text>
            )}
            {!planState?.loading && planState?.inspection && !planState.inspection.complete && (
                <Text>{loc.incomplete}</Text>
            )}
            {capabilities?.hints && (
                <Field
                    label={loc.hint}
                    validationMessage={queryStoreHint?.error}
                    hint={canApplyIntervention ? undefined : loc.interventionPermission}>
                    <Textarea
                        value={hint}
                        placeholder={loc.hintPlaceholder}
                        onChange={(_, data) => setHint(data.value)}
                    />
                    {queryStoreHint?.loading && <Spinner size="tiny" label={loc.loading} />}
                    {queryStoreHint?.error && (
                        <MessageBar intent="warning">{queryStoreHint.error}</MessageBar>
                    )}
                    <Button
                        disabled={
                            !context ||
                            !canApplyIntervention ||
                            queryStoreHint?.loading === true ||
                            hint.trim().length === 0
                        }
                        onClick={() => context?.setQueryStoreHint(queryId, hint)}>
                        {loc.saveHint}
                    </Button>
                    {queryStoreHint?.hint && (
                        <Button
                            disabled={!canApplyIntervention}
                            onClick={() => context?.clearQueryStoreHint(queryId)}>
                            {loc.clearHint}
                        </Button>
                    )}
                    {queryStoreHint?.state && <Text>{loc.hintState(queryStoreHint.state)}</Text>}
                    {queryStoreHint?.failureReason && <Text>{queryStoreHint.failureReason}</Text>}
                </Field>
            )}
            {capabilities && !capabilities.hints && <Text>{loc.hintUnavailable}</Text>}
        </section>
    );
}
