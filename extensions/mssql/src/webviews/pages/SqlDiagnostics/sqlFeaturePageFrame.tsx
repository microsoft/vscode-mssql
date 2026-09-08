/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, useContext, useEffect, useMemo } from "react";
import {
    Badge,
    Button,
    MessageBar,
    Spinner,
    Text,
    Tooltip,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    ArrowClockwise16Regular,
    ArrowDownload16Regular,
    Open16Regular,
} from "@fluentui/react-icons";

import {
    DiagnosticsResult,
    DiagnosticsQuerySummary,
    DiagnosticsSection,
} from "../../../sharedInterfaces/sqlDiagnostics";
import { LocConstants } from "../../common/locConstants";
import { SqlDiagnosticsContext } from "./sqlDiagnosticsStateProvider";
import { useSqlDiagnosticsSelector } from "./sqlDiagnosticsSelector";
import { DiagnosticsResults } from "./diagnosticsResults";
import { JobHistoryResults } from "./jobHistoryResults";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
    },
    header: {
        display: "flex",
        flexDirection: "column",
        rowGap: "4px",
        padding: "12px 16px 8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    headerLine: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "8px 12px",
    },
    serverLine: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "4px 12px",
        color: tokens.colorNeutralForeground3,
    },
    body: { display: "flex", flexGrow: 1, minHeight: 0 },
    sidebar: {
        width: "250px",
        flexShrink: 0,
        overflowY: "auto",
        borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
        padding: "8px",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
    },
    navItem: {
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: "2px",
        width: "100%",
        padding: "9px 10px",
        border: "none",
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: "transparent",
        color: tokens.colorNeutralForeground1,
        textAlign: "left",
        cursor: "pointer",
        ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    },
    navItemSelected: { backgroundColor: tokens.colorNeutralBackground1Selected },
    navItemDisabled: { opacity: 0.55, cursor: "not-allowed" },
    navTitle: { fontWeight: tokens.fontWeightSemibold },
    navDescription: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
    content: {
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
    },
    summary: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "10px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    evidence: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "4px 12px",
        padding: "6px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        color: tokens.colorNeutralForeground3,
    },
    toolbar: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "8px",
        padding: "8px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    spacer: { flexGrow: 1 },
    messages: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px 12px",
    },
    results: { flexGrow: 1, minHeight: 0, overflow: "hidden", padding: "0 8px 8px" },
    empty: { padding: "32px", color: tokens.colorNeutralForeground3, textAlign: "center" },
});

export interface SqlFeatureNavigationItem {
    id: string;
    queryId: string;
    label: string;
    description: string;
}

export interface SqlFeaturePageFrameProps {
    section: DiagnosticsSection;
    title: string;
    subtitle: string;
    navigation: readonly SqlFeatureNavigationItem[];
    defaultQueryId: string;
    summary?: ReactNode;
    toolbar?: ReactNode;
    children?: ReactNode;
    onSelectRow?: (index: number, result: DiagnosticsResult) => void;
    onSelectQuery?: (queryId: string) => void;
}

export function SqlFeaturePageFrame({
    section,
    title,
    subtitle,
    navigation,
    defaultQueryId,
    summary,
    toolbar,
    children,
    onSelectRow,
    onSelectQuery,
}: SqlFeaturePageFrameProps) {
    const styles = useStyles();
    const context = useContext(SqlDiagnosticsContext);
    const loc = LocConstants.getInstance().sqlFeaturePage;
    const sectionState = useSqlDiagnosticsSelector((state) => state.section);
    const queries = useSqlDiagnosticsSelector((state) => state.queries);
    const selectedQueryId = useSqlDiagnosticsSelector((state) => state.selectedQueryId);
    const result = useSqlDiagnosticsSelector((state) => state.result);
    const server = useSqlDiagnosticsSelector((state) => state.server);
    const isLoading = useSqlDiagnosticsSelector((state) => state.isLoading);
    const errorMessage = useSqlDiagnosticsSelector((state) => state.errorMessage);
    const visibleQueries = useMemo(
        () => queries.filter((query) => query.section === section),
        [queries, section],
    );
    const snapshot = result?.snapshot;
    const queryStoreContext = result?.queryStoreContext;
    const snapshotStatus = snapshot ? loc.snapshot[snapshot.completeness] : undefined;
    const snapshotTime = (value: string | undefined) =>
        value ? new Date(value).toLocaleString() : "";
    const comparisonReason = (reason: string | undefined) => {
        switch (reason) {
            case "counterReset":
                return loc.snapshot.comparison.counterReset;
            case "incomplete":
                return loc.snapshot.comparison.incomplete;
            case "invalidValue":
                return loc.snapshot.comparison.invalidValue;
            default:
                return loc.snapshot.comparison.incomplete;
        }
    };
    const emptyResultMessage =
        snapshot?.completeness === "partial"
            ? loc.empty.partial
            : snapshot?.completeness === "unknown"
              ? loc.empty.unknown
              : selectedQueryId
                ? ((loc.empty[section] as Record<string, string>)[
                      emptyMessageKey(selectedQueryId)
                  ] ?? loc.noRows)
                : loc.chooseInvestigation;

    useEffect(() => {
        if (!context || sectionState !== section || isLoading || selectedQueryId) return;
        const defaultQuery = visibleQueries.find((query) => query.id === defaultQueryId);
        const firstAvailable = visibleQueries.find((query) => query.available);
        const query = defaultQuery?.available ? defaultQuery : firstAvailable;
        if (query) {
            if (onSelectQuery) onSelectQuery(query.id);
            else context.runQuery(query.id);
        }
    }, [
        context,
        defaultQueryId,
        isLoading,
        onSelectQuery,
        section,
        sectionState,
        selectedQueryId,
        visibleQueries,
    ]);

    if (!context) return <Spinner label={loc.identifying} />;

    const selected = visibleQueries.find((query) => query.id === selectedQueryId);
    const selectQuery = (query: DiagnosticsQuerySummary) => {
        if (!query.available) return;
        if (onSelectQuery) onSelectQuery(query.id);
        else context.runQuery(query.id);
    };
    const renderNavigationItem = (item: SqlFeatureNavigationItem) => {
        const query = visibleQueries.find((candidate) => candidate.id === item.queryId);
        const available = query?.available === true;
        const button = (
            <button
                key={item.id}
                className={`${styles.navItem} ${
                    selected?.id === item.queryId ? styles.navItemSelected : ""
                } ${available ? "" : styles.navItemDisabled}`}
                disabled={!available}
                onClick={() => query && selectQuery(query)}
                aria-current={selected?.id === item.queryId ? "page" : undefined}>
                <span className={styles.navTitle}>{item.label}</span>
                <span className={styles.navDescription}>{item.description}</span>
            </button>
        );
        return available ? (
            button
        ) : (
            <Tooltip
                key={item.id}
                content={query?.unavailableReason ?? loc.unavailable(1)}
                relationship="description">
                <span>{button}</span>
            </Tooltip>
        );
    };

    return (
        <div className={styles.root}>
            <header className={styles.header}>
                <div className={styles.headerLine}>
                    <Text weight="semibold" size={500}>
                        {title}
                    </Text>
                    <Badge appearance="outline">{loc.evidence}</Badge>
                </div>
                <Text size={300}>{subtitle}</Text>
                <div className={styles.serverLine}>
                    {server ? (
                        <>
                            <Text size={200}>{server.serverName ?? loc.connectedServer}</Text>
                            <Badge appearance="outline">{server.platformName}</Badge>
                            {server.edition && <Text size={200}>{server.edition}</Text>}
                            {server.database && (
                                <Text size={200}>{loc.database(server.database)}</Text>
                            )}
                            {section === "agent" && !server.hasSqlAgent && (
                                <Badge appearance="outline" color="informative">
                                    {loc.noAgent}
                                </Badge>
                            )}
                        </>
                    ) : (
                        <Text size={200}>{loc.identifying}</Text>
                    )}
                </div>
            </header>

            {summary && <section className={styles.summary}>{summary}</section>}
            {snapshot && (
                <section className={styles.evidence} aria-label={loc.evidence}>
                    <Badge appearance="outline">{snapshotStatus}</Badge>
                    <Text size={200}>
                        {loc.snapshot.scope(
                            snapshot.scope.serverName ?? loc.connectedServer,
                            snapshot.scope.database ?? "",
                        )}
                    </Text>
                    <Text size={200}>
                        {loc.snapshot.collected(
                            snapshotTime(snapshot.collectionStartedAt),
                            snapshotTime(snapshot.collectionEndedAt),
                        )}
                    </Text>
                    {snapshot.window.kind === "sinceReset" ? (
                        <Text size={200}>{loc.snapshot.sinceReset}</Text>
                    ) : snapshot.window.start && snapshot.window.end ? (
                        <Text size={200}>
                            {loc.snapshot.window(
                                snapshotTime(snapshot.window.start),
                                snapshotTime(snapshot.window.end),
                            )}
                        </Text>
                    ) : (
                        <Text size={200}>{loc.snapshot.point}</Text>
                    )}
                    {snapshot.window.baselineStart && snapshot.window.baselineEnd && (
                        <Text size={200}>
                            {loc.snapshot.baselineWindow(
                                snapshotTime(snapshot.window.baselineStart),
                                snapshotTime(snapshot.window.baselineEnd),
                            )}
                        </Text>
                    )}
                    {snapshot.metric && (
                        <Text size={200}>
                            {loc.snapshot.metric(loc.snapshot.metricNames[snapshot.metric])}
                        </Text>
                    )}
                    {snapshot.aggregation && (
                        <>
                            <Text size={200}>
                                {loc.snapshot.aggregation(
                                    loc.snapshot.aggregationNames[snapshot.aggregation],
                                )}
                            </Text>
                            <Text size={200}>
                                {loc.snapshot.aggregationDetails[snapshot.aggregation]}
                            </Text>
                        </>
                    )}
                    {queryStoreContext?.filters.queryId !== undefined && (
                        <Text size={200}>
                            {loc.snapshot.filter(
                                `${loc.queryStore.queryIdFilter}: ${queryStoreContext.filters.queryId}`,
                            )}
                        </Text>
                    )}
                    {queryStoreContext?.filters.text && (
                        <Text size={200}>
                            {loc.snapshot.filter(
                                `${loc.queryStore.textFilter}: ${queryStoreContext.filters.text}`,
                            )}
                        </Text>
                    )}
                    {queryStoreContext?.filters.source && (
                        <Text size={200}>
                            {loc.snapshot.filter(
                                `${loc.queryStore.sourceFilter}: ${loc.queryStore.sourceValues[queryStoreContext.filters.source]}`,
                            )}
                        </Text>
                    )}
                    {queryStoreContext?.filters.executionType && (
                        <Text size={200}>
                            {loc.snapshot.filter(
                                `${loc.queryStore.executionType}: ${loc.queryStore.executionTypeValues[queryStoreContext.filters.executionType]}`,
                            )}
                        </Text>
                    )}
                    {queryStoreContext?.filters.waitCategory && (
                        <Text size={200}>
                            {loc.snapshot.filter(
                                `${loc.queryStore.waitCategory}: ${queryStoreContext.filters.waitCategory}`,
                            )}
                        </Text>
                    )}
                    {snapshot.comparison?.status === "baseline" && (
                        <Text size={200}>{loc.snapshot.comparison.baseline}</Text>
                    )}
                    {snapshot.comparison?.status === "delta" &&
                        snapshot.comparison.baselineCollectedAt && (
                            <Text size={200}>
                                {loc.snapshot.comparison.delta(
                                    snapshotTime(snapshot.comparison.baselineCollectedAt),
                                )}
                            </Text>
                        )}
                    {snapshot.comparison?.status === "invalid" && (
                        <Text size={200}>
                            {loc.snapshot.comparison.invalid(
                                comparisonReason(snapshot.comparison.reason),
                            )}
                        </Text>
                    )}
                    {snapshot.rowLimit !== undefined && (
                        <>
                            <Text size={200}>{loc.snapshot.rowLimit(snapshot.rowLimit)}</Text>
                            <Text size={200}>{loc.snapshot.rowLimitNote}</Text>
                        </>
                    )}
                    {snapshot.exclusions.length > 0 && (
                        <Text size={200}>
                            {loc.snapshot.exclusions(snapshot.exclusions.join(", "))}
                        </Text>
                    )}
                    {snapshot.coverage.observedIntervals !== undefined &&
                        snapshot.coverage.availableIntervals !== undefined && (
                            <Text size={200}>
                                {loc.snapshot.coverage(
                                    snapshot.coverage.observedIntervals,
                                    snapshot.coverage.availableIntervals,
                                )}
                            </Text>
                        )}
                    {snapshot.coverage.baselineObservedIntervals !== undefined &&
                        snapshot.coverage.baselineAvailableIntervals !== undefined && (
                            <Text size={200}>
                                {loc.snapshot.baselineCoverage(
                                    snapshot.coverage.baselineObservedIntervals,
                                    snapshot.coverage.baselineAvailableIntervals,
                                )}
                            </Text>
                        )}
                    {snapshot.coverage.note && (
                        <Text size={200}>{loc.snapshot.coverageNote(snapshot.coverage.note)}</Text>
                    )}
                </section>
            )}

            <div className={styles.body}>
                <nav className={styles.sidebar} aria-label={title}>
                    {navigation.map(renderNavigationItem)}
                </nav>
                <main className={styles.content}>
                    <div className={styles.toolbar}>
                        {toolbar}
                        <div className={styles.spacer} />
                        <Button
                            icon={<ArrowClockwise16Regular />}
                            appearance="subtle"
                            disabled={!selectedQueryId || isLoading}
                            onClick={() => context.refresh()}>
                            {loc.refresh}
                        </Button>
                        <Button
                            icon={<Open16Regular />}
                            appearance="subtle"
                            disabled={!selectedQueryId}
                            onClick={() => context.openInEditor(selectedQueryId!)}>
                            {loc.openSql}
                        </Button>
                        <Button
                            icon={<ArrowDownload16Regular />}
                            appearance="subtle"
                            disabled={!result || result.rows.length === 0}
                            onClick={() => context.exportCsv()}>
                            {loc.exportCsv}
                        </Button>
                        {isLoading && <Spinner size="tiny" label={loc.running} />}
                        {result && !isLoading && (
                            <Text size={200}>
                                {loc.rows(result.rows.length, result.durationMs)}
                            </Text>
                        )}
                    </div>

                    {(errorMessage || result?.truncated) && (
                        <div className={styles.messages}>
                            {errorMessage && <MessageBar intent="error">{errorMessage}</MessageBar>}
                            {result?.truncated && (
                                <MessageBar intent="warning">{loc.incomplete}</MessageBar>
                            )}
                        </div>
                    )}
                    {children}
                    <div className={styles.results}>
                        {result && result.rows.length > 0 ? (
                            result.queryId === "agent.jobHistory" ? (
                                <JobHistoryResults
                                    key={`${result.queryId}:${result.ranAt}`}
                                    result={result}
                                    themeKind={context.themeKind}
                                    openText={(rowIndex, field) =>
                                        context.openResultText(result.ranAt, rowIndex, field)
                                    }
                                />
                            ) : (
                                <DiagnosticsResults
                                    key={`${result.queryId}:${result.ranAt}`}
                                    result={result}
                                    themeKind={context.themeKind}
                                    openText={(rowIndex, field) =>
                                        context.openResultText(result.ranAt, rowIndex, field)
                                    }
                                    onSelectRow={(index) => onSelectRow?.(index, result)}
                                />
                            )
                        ) : (
                            <div className={styles.empty}>
                                {isLoading ? loc.running : emptyResultMessage}
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
}

function emptyMessageKey(queryId: string): string {
    switch (queryId) {
        case "dmv.overview":
            return "overview";
        case "dmv.blockingChain":
            return "blocking";
        case "dmv.topWorkload":
            return "workload";
        case "dmv.waitStats":
        case "dmv.waitStatsAzure":
            return "waits";
        case "dmv.fileIoStalls":
            return "storage";
        case "dmv.missingIndexes":
            return "indexes";
        case "qds.topResourceConsumers":
            return "overview";
        case "qds.workloadHistory":
            return "overview";
        case "qds.allQueries":
            return "overview";
        case "qds.regressedQueries":
            return "regressions";
        case "qds.highVariation":
            return "variation";
        case "qds.forcedPlans":
            return "forced";
        case "qds.waitStats":
            return "waits";
        case "agent.jobs":
            return "jobs";
        case "agent.runningJobs":
            return "running";
        case "agent.status":
            return "status";
        case "agent.jobSteps":
            return "steps";
        case "agent.jobHistory":
            return "history";
        default:
            return "";
    }
}
