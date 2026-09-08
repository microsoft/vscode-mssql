/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import {
    Button,
    Dropdown,
    Field,
    Input,
    MessageBar,
    Option,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";

import { LocConstants } from "../../common/locConstants";
import { SqlDiagnosticsContext } from "../SqlDiagnostics/sqlDiagnosticsStateProvider";
import { useSqlDiagnosticsSelector } from "../SqlDiagnostics/sqlDiagnosticsSelector";
import { QueryStoreReadinessPanel } from "../SqlDiagnostics/queryStoreReadiness";
import { QueryStoreSettings } from "../SqlDiagnostics/queryStoreSettings";
import { QueryStoreMaintenance } from "../SqlDiagnostics/queryStoreMaintenance";
import { QueryStorePlanInspector } from "../SqlDiagnostics/queryStorePlanInspector";
import { QueryStoreRecommendations } from "./queryStoreRecommendations";
import { QueryStoreEvidenceTable } from "./queryStoreEvidenceTable";
import { QueryStoreHistoryChart } from "./queryStoreHistoryChart";
import type { DiagnosticsResult } from "../../../sharedInterfaces/sqlDiagnostics";
import {
    SqlFeatureNavigationItem,
    SqlFeaturePageFrame,
} from "../SqlDiagnostics/sqlFeaturePageFrame";

const useStyles = makeStyles({
    controls: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "end",
        gap: "8px",
        width: "100%",
    },
    field: { minWidth: "140px", flex: "1 1 140px" },
    textField: { minWidth: "220px", flex: "2 1 220px" },
    customWindow: {
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(140px, 1fr))",
        gap: "8px",
        width: "100%",
        padding: "8px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    emptyRecovery: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    recoveryActions: { display: "flex", gap: "8px", flexWrap: "wrap" },
});

type QueryStoreMetric = "duration" | "cpu" | "reads" | "executions";
type QueryStoreAggregation = "total" | "weightedMean" | "maximum" | "pooledVariation";
type ExecutionType = "all" | "successful" | "aborted" | "exception";
type QueryStoreSource = "all" | "user" | "internal";

interface QueryStoreControls {
    metric: QueryStoreMetric;
    aggregation: QueryStoreAggregation;
    executionType: ExecutionType;
    source: QueryStoreSource;
    waitCategory: string;
    text: string;
    queryId?: number;
    startAt?: string;
    endAt?: string;
    baselineStartAt?: string;
    baselineEndAt?: string;
}

export default function QueryStorePage() {
    const context = useContext(SqlDiagnosticsContext);
    const loc = LocConstants.getInstance();
    const pageLoc = loc.sqlFeaturePage;
    const queryStore = useSqlDiagnosticsSelector((state) => state.queryStore);
    const server = useSqlDiagnosticsSelector((state) => state.server);
    const queryStoreInterventions = useSqlDiagnosticsSelector(
        (state) => state.queryStoreInterventions,
    );
    const queryStoreMaintenance = useSqlDiagnosticsSelector((state) => state.queryStoreMaintenance);
    const selectedQueryId = useSqlDiagnosticsSelector((state) => state.selectedQueryId);
    const result = useSqlDiagnosticsSelector((state) => state.result);
    const errorMessage = useSqlDiagnosticsSelector((state) => state.errorMessage);
    const isLoading = useSqlDiagnosticsSelector((state) => state.isLoading);
    const queryStorePlan = useSqlDiagnosticsSelector((state) => state.queryStorePlan);
    const styles = useStyles();
    const [showSettings, setShowSettings] = useState(false);
    const [windowHours, setWindowHours] = useState(24);
    const [customWindow, setCustomWindow] = useState(false);
    const [windowError, setWindowError] = useState(false);
    const [controls, setControls] = useState<QueryStoreControls>({
        metric: "duration",
        aggregation: "weightedMean",
        executionType: "successful",
        source: "all",
        waitCategory: "",
        text: "",
    });
    const navigation: readonly SqlFeatureNavigationItem[] = [
        {
            id: "overview",
            queryId: "qds.topResourceConsumers",
            label: pageLoc.queryStore.overview,
            description: pageLoc.queryStore.overviewDescription,
        },
        {
            id: "history",
            queryId: "qds.workloadHistory",
            label: pageLoc.queryStore.history,
            description: pageLoc.queryStore.historyDescription,
        },
        {
            id: "allQueries",
            queryId: "qds.allQueries",
            label: pageLoc.queryStore.allQueries,
            description: pageLoc.queryStore.allQueriesDescription,
        },
        {
            id: "regressions",
            queryId: "qds.regressedQueries",
            label: pageLoc.queryStore.regressions,
            description: pageLoc.queryStore.regressionsDescription,
        },
        {
            id: "variation",
            queryId: "qds.highVariation",
            label: pageLoc.queryStore.variation,
            description: pageLoc.queryStore.variationDescription,
        },
        {
            id: "forced",
            queryId: "qds.forcedPlans",
            label: pageLoc.queryStore.forced,
            description: pageLoc.queryStore.forcedDescription,
        },
        {
            id: "waits",
            queryId: "qds.waitStats",
            label: pageLoc.queryStore.waits,
            description: pageLoc.queryStore.waitsDescription,
        },
    ];
    const utcInstant = (value: string | undefined): string | undefined => {
        if (!value) return undefined;
        const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
        if (!match) return undefined;
        const instant = new Date(
            Date.UTC(
                Number(match[1]),
                Number(match[2]) - 1,
                Number(match[3]),
                Number(match[4]),
                Number(match[5]),
                Number(match[6] ?? 0),
            ),
        );
        return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
    };
    const buildParams = (
        queryId: string,
        next: QueryStoreControls,
        useCustomWindow = customWindow,
    ): Record<string, unknown> | undefined => {
        const params: Record<string, unknown> = {
            metric: next.metric,
            aggregation:
                queryId === "qds.highVariation"
                    ? "pooledVariation"
                    : next.aggregation === "pooledVariation"
                      ? "weightedMean"
                      : next.aggregation,
            executionType: next.executionType,
            ...(next.source === "all" ? {} : { source: next.source }),
            ...(queryId === "qds.waitStats" && next.waitCategory.trim()
                ? { waitCategory: next.waitCategory.trim() }
                : {}),
            ...(queryId === "qds.allQueries" ? { top: 1000 } : {}),
            ...(next.text.trim() ? { text: next.text.trim() } : {}),
            ...(next.queryId !== undefined ? { queryId: next.queryId } : {}),
        };
        if (!useCustomWindow) {
            if (queryId === "qds.regressedQueries") {
                params.recentHours = windowHours;
                params.baselineHours = windowHours;
            } else {
                params.hours = windowHours;
            }
            return params;
        }
        const startAt = utcInstant(next.startAt);
        const endAt = utcInstant(next.endAt);
        const baselineStartAt = utcInstant(next.baselineStartAt);
        const baselineEndAt = utcInstant(next.baselineEndAt);
        const validRecent = startAt !== undefined && endAt !== undefined && startAt < endAt;
        const validBaseline =
            queryId !== "qds.regressedQueries" ||
            (baselineStartAt !== undefined &&
                baselineEndAt !== undefined &&
                baselineStartAt < baselineEndAt &&
                baselineEndAt <= startAt!);
        if (!validRecent || !validBaseline) {
            setWindowError(true);
            return undefined;
        }
        setWindowError(false);
        params.startAt = startAt;
        params.endAt = endAt;
        if (queryId === "qds.regressedQueries") {
            params.baselineStartAt = baselineStartAt;
            params.baselineEndAt = baselineEndAt;
        }
        return params;
    };
    const runWindow = (hours: number) => {
        setWindowHours(hours);
        setCustomWindow(false);
        setWindowError(false);
        if (!context || !selectedQueryId) return;
        const params = buildParams(selectedQueryId, controls, false);
        if (!params) return;
        context.runQuery(selectedQueryId, params);
    };
    const runWithControls = (next: QueryStoreControls = controls) => {
        if (!context || !selectedQueryId) return;
        const params = buildParams(selectedQueryId, next);
        if (!params) return;
        context.runQuery(selectedQueryId, params);
    };
    const selectQuery = (queryId: string) => {
        if (!context) return;
        const params = buildParams(queryId, controls);
        if (!params) return;
        context.runQuery(queryId, params);
    };
    const updateControls = (patch: Partial<QueryStoreControls>) => {
        setControls((current) => ({ ...current, ...patch }));
    };
    const resetInvestigation = () => {
        const next = {
            ...controls,
            text: "",
            queryId: undefined,
            source: "all" as const,
            waitCategory: "",
        };
        setControls(next);
        setWindowHours(24);
        setCustomWindow(false);
        setWindowError(false);
        if (!context || !selectedQueryId) return;
        const params = buildParams(selectedQueryId, next, false);
        if (params) context.runQuery(selectedQueryId, params);
    };
    const isComparison = selectedQueryId === "qds.regressedQueries";
    const executionLabels: Record<ExecutionType, string> = {
        all: pageLoc.queryStore.allExecutions,
        successful: pageLoc.queryStore.successfulExecutions,
        aborted: pageLoc.queryStore.abortedExecutions,
        exception: pageLoc.queryStore.exceptionExecutions,
    };
    const sourceLabels: Record<QueryStoreSource, string> = {
        all: pageLoc.queryStore.sourceValues.all,
        user: pageLoc.queryStore.sourceValues.user,
        internal: pageLoc.queryStore.sourceValues.internal,
    };
    const selectRow = (index: number, selectedResult: DiagnosticsResult) => {
        const row = selectedResult.rows[index];
        const queryId = Number(row?.query_id);
        const planId = Number(row?.plan_id);
        if (
            Number.isSafeInteger(queryId) &&
            queryId > 0 &&
            Number.isSafeInteger(planId) &&
            planId > 0
        ) {
            context?.inspectQueryStorePlan(queryId, planId);
        } else if (Number.isSafeInteger(queryId) && queryId > 0) {
            context?.loadQueryStorePlans(queryId);
        }
    };

    return (
        <>
            <SqlFeaturePageFrame
                section="querystore"
                title={loc.sqlFeatures.querystore}
                subtitle={pageLoc.queryStore.overviewDescription}
                navigation={navigation}
                defaultQueryId="qds.topResourceConsumers"
                toolbar={
                    <div className={styles.controls}>
                        <Dropdown
                            className={styles.field}
                            aria-label={pageLoc.queryStore.window}
                            value={
                                customWindow
                                    ? pageLoc.queryStore.customWindow
                                    : windowHours === 24
                                      ? pageLoc.queryStore.day
                                      : windowHours === 24 * 7
                                        ? pageLoc.queryStore.week
                                        : pageLoc.queryStore.month
                            }
                            selectedOptions={[customWindow ? "custom" : String(windowHours)]}
                            onOptionSelect={(_, data) => {
                                if (data.optionValue === "custom") setCustomWindow(true);
                                else runWindow(Number(data.optionValue));
                            }}>
                            <Option value="24">{pageLoc.queryStore.day}</Option>
                            <Option value="168">{pageLoc.queryStore.week}</Option>
                            <Option value="720">{pageLoc.queryStore.month}</Option>
                            <Option value="custom">{pageLoc.queryStore.customWindow}</Option>
                        </Dropdown>
                        <Dropdown
                            className={styles.field}
                            aria-label={pageLoc.queryStore.metric}
                            value={pageLoc.queryStore[controls.metric]}
                            selectedOptions={[controls.metric]}
                            onOptionSelect={(_, data) =>
                                updateControls({ metric: data.optionValue as QueryStoreMetric })
                            }>
                            <Option value="duration">{pageLoc.queryStore.duration}</Option>
                            <Option value="cpu">{pageLoc.queryStore.cpu}</Option>
                            <Option value="reads">{pageLoc.queryStore.reads}</Option>
                            <Option value="executions">{pageLoc.queryStore.executions}</Option>
                        </Dropdown>
                        <Dropdown
                            className={styles.field}
                            aria-label={pageLoc.queryStore.aggregation}
                            value={pageLoc.queryStore[controls.aggregation]}
                            selectedOptions={[controls.aggregation]}
                            onOptionSelect={(_, data) =>
                                updateControls({
                                    aggregation: data.optionValue as QueryStoreAggregation,
                                })
                            }>
                            <Option value="total">{pageLoc.queryStore.total}</Option>
                            <Option value="weightedMean">{pageLoc.queryStore.weightedMean}</Option>
                            <Option value="maximum">{pageLoc.queryStore.maximum}</Option>
                            {selectedQueryId === "qds.highVariation" && (
                                <Option value="pooledVariation">
                                    {pageLoc.queryStore.pooledVariation}
                                </Option>
                            )}
                        </Dropdown>
                        <Dropdown
                            className={styles.field}
                            aria-label={pageLoc.queryStore.executionType}
                            value={executionLabels[controls.executionType]}
                            selectedOptions={[controls.executionType]}
                            onOptionSelect={(_, data) =>
                                updateControls({ executionType: data.optionValue as ExecutionType })
                            }>
                            <Option value="all">{pageLoc.queryStore.allExecutions}</Option>
                            <Option value="successful">
                                {pageLoc.queryStore.successfulExecutions}
                            </Option>
                            <Option value="aborted">{pageLoc.queryStore.abortedExecutions}</Option>
                            <Option value="exception">
                                {pageLoc.queryStore.exceptionExecutions}
                            </Option>
                        </Dropdown>
                        <Dropdown
                            className={styles.field}
                            aria-label={pageLoc.queryStore.sourceFilter}
                            value={sourceLabels[controls.source]}
                            selectedOptions={[controls.source]}
                            onOptionSelect={(_, data) =>
                                updateControls({ source: data.optionValue as QueryStoreSource })
                            }>
                            <Option value="all">{pageLoc.queryStore.sourceValues.all}</Option>
                            <Option value="user">{pageLoc.queryStore.sourceValues.user}</Option>
                            <Option value="internal">
                                {pageLoc.queryStore.sourceValues.internal}
                            </Option>
                        </Dropdown>
                        <Field className={styles.textField} label={pageLoc.queryStore.textFilter}>
                            <Input
                                value={controls.text}
                                placeholder={pageLoc.queryStore.textFilterPlaceholder}
                                onChange={(_, data) => updateControls({ text: data.value })}
                            />
                        </Field>
                        {selectedQueryId === "qds.waitStats" && (
                            <Field
                                className={styles.textField}
                                label={pageLoc.queryStore.waitCategory}
                                hint={pageLoc.queryStore.waitCategoryPlaceholder}>
                                <Input
                                    value={controls.waitCategory}
                                    placeholder={pageLoc.queryStore.waitCategoryPlaceholder}
                                    onChange={(_, data) =>
                                        updateControls({ waitCategory: data.value })
                                    }
                                />
                            </Field>
                        )}
                        <Field className={styles.field} label={pageLoc.queryStore.queryIdFilter}>
                            <Input
                                type="number"
                                value={
                                    controls.queryId === undefined ? "" : String(controls.queryId)
                                }
                                placeholder={pageLoc.queryStore.queryIdPlaceholder}
                                onChange={(_, data) => {
                                    const value = data.value.trim();
                                    updateControls({
                                        queryId:
                                            /^\d+$/.test(value) && Number(value) > 0
                                                ? Number(value)
                                                : undefined,
                                    });
                                }}
                            />
                        </Field>
                        <Button appearance="primary" onClick={() => runWithControls()}>
                            {pageLoc.queryStore.applyFilters}
                        </Button>
                        <Button
                            onClick={() => {
                                const next = {
                                    ...controls,
                                    text: "",
                                    queryId: undefined,
                                    source: "all" as const,
                                    waitCategory: "",
                                };
                                setControls(next);
                                runWithControls(next);
                            }}>
                            {pageLoc.queryStore.clearFilters}
                        </Button>
                        {customWindow && (
                            <div className={styles.customWindow}>
                                <Field label={pageLoc.queryStore.startAt}>
                                    <Input
                                        type="datetime-local"
                                        value={controls.startAt ?? ""}
                                        onChange={(_, data) =>
                                            updateControls({ startAt: data.value })
                                        }
                                    />
                                </Field>
                                <Field label={pageLoc.queryStore.endAt}>
                                    <Input
                                        type="datetime-local"
                                        value={controls.endAt ?? ""}
                                        onChange={(_, data) =>
                                            updateControls({ endAt: data.value })
                                        }
                                    />
                                </Field>
                                {isComparison && (
                                    <>
                                        <Field label={pageLoc.queryStore.baselineStartAt}>
                                            <Input
                                                type="datetime-local"
                                                value={controls.baselineStartAt ?? ""}
                                                onChange={(_, data) =>
                                                    updateControls({ baselineStartAt: data.value })
                                                }
                                            />
                                        </Field>
                                        <Field label={pageLoc.queryStore.baselineEndAt}>
                                            <Input
                                                type="datetime-local"
                                                value={controls.baselineEndAt ?? ""}
                                                onChange={(_, data) =>
                                                    updateControls({ baselineEndAt: data.value })
                                                }
                                            />
                                        </Field>
                                    </>
                                )}
                            </div>
                        )}
                        {windowError && (
                            <span role="alert">{pageLoc.queryStore.invalidWindow}</span>
                        )}
                    </div>
                }
                onSelectQuery={selectQuery}
                summary={
                    queryStore ? (
                        <>
                            <QueryStoreReadinessPanel
                                state={queryStore}
                                database={server?.database}
                                busy={isLoading}
                                recheck={() => context?.refresh()}
                                chooseDatabase={() => context?.chooseDatabase()}
                                review={() => setShowSettings(true)}
                            />
                            {queryStoreInterventions && (
                                <QueryStoreMaintenance
                                    capabilities={queryStoreInterventions}
                                    busy={isLoading}
                                    outcome={queryStoreMaintenance}
                                    run={(action) => context?.queryStoreMaintenance(action)}
                                />
                            )}
                        </>
                    ) : undefined
                }
                onSelectRow={selectRow}
                children={
                    <>
                        {result &&
                            result.queryId.startsWith("qds.") &&
                            result.rows.length === 0 &&
                            !isLoading && (
                                <section
                                    className={styles.emptyRecovery}
                                    aria-label={pageLoc.queryStore.emptyRecovery}>
                                    <MessageBar intent="info">
                                        {result.queryId === "qds.regressedQueries"
                                            ? pageLoc.queryStore.emptyRegression
                                            : pageLoc.queryStore.emptyRecovery}
                                    </MessageBar>
                                    {result.queryId === "qds.regressedQueries" ? (
                                        <Text size={200}>
                                            {pageLoc.queryStore.emptyRegressionEvidence}
                                        </Text>
                                    ) : (
                                        <>
                                            <Text size={200}>
                                                {pageLoc.queryStore.emptyFutureCollection}
                                            </Text>
                                            {queryStore?.captureMode && (
                                                <Text size={200}>
                                                    {pageLoc.queryStore.emptyCapturePolicy(
                                                        queryStore.captureMode,
                                                    )}
                                                </Text>
                                            )}
                                        </>
                                    )}
                                    {selectedQueryId === "qds.waitStats" && (
                                        <Text size={200}>{pageLoc.queryStore.emptyWaitPolicy}</Text>
                                    )}
                                    <div className={styles.recoveryActions}>
                                        <Button onClick={resetInvestigation}>
                                            {pageLoc.queryStore.resetInvestigation}
                                        </Button>
                                    </div>
                                </section>
                            )}
                        <QueryStoreRecommendations result={result} />
                        <QueryStoreHistoryChart />
                        <QueryStorePlanInspector state={queryStorePlan} />
                        <QueryStoreEvidenceTable
                            onSelectRow={(index) => result && selectRow(index, result)}
                        />
                    </>
                }
            />
            {showSettings && queryStore && (
                <QueryStoreSettings
                    state={queryStore}
                    error={errorMessage}
                    busy={isLoading}
                    close={() => setShowSettings(false)}
                    review={(configuration) => context?.setQueryStore(true, configuration)}
                />
            )}
        </>
    );
}
