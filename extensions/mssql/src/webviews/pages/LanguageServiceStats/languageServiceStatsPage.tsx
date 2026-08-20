/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Checkbox,
    MessageBar,
    MessageBarBody,
    Text,
    Tooltip,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { ArrowDownload16Regular, Copy16Regular } from "@fluentui/react-icons";
import { useContext, useState } from "react";

import {
    CopyStatsRequest,
    ExportStatsRequest,
    LanguageServiceStatsWebviewState,
} from "../../../sharedInterfaces/languageServiceStats";
import { locConstants } from "../../common/locConstants";
import { LanguageServiceStatsContext } from "./languageServiceStatsStateProvider";
import { useStatsSelector } from "./languageServiceStatsSelector";
import { FetchLog } from "./fetchLog";
import { formatMs } from "./format";
import { MetricCard } from "./metricCard";
import { StatTable } from "./statTable";

/**
 * One document's language service statistics, on one page.
 *
 * Tabs were the wrong shape for this much content: three tabs held four cards apiece and a table,
 * and splitting them meant a reader comparing a slow bind against the fetch that caused it had to
 * remember one page while looking at another. Everything here answers the same question -- what did
 * this file cost -- so it reads top to bottom.
 *
 * The export controls sit outside the scrolling region rather than at the end of it, because they
 * are the panel's one action and a reader should not have to reach the bottom of a long fetch log
 * to find them. The footer stays one row: the reason the identifier toggle defaults to off is a
 * tooltip rather than a third line, because it is read once and then never again.
 */
const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
    },
    header: {
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
        padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXL}`,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    title: { fontFamily: tokens.fontFamilyMonospace },
    spacer: { flexGrow: 1 },
    scroll: {
        flexGrow: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXL}`,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXL,
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
    },
    cards: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: tokens.spacingHorizontalM,
    },
    footer: {
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
        flexWrap: "wrap",
        padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXL}`,
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    caption: { color: tokens.colorNeutralForeground3 },
});

const loc = locConstants.languageServiceStats;

export const LanguageServiceStatsPage = () => {
    const styles = useStyles();
    const documentName = useStatsSelector((state) => state.documentName);
    const databaseName = useStatsSelector((state) => state.databaseName);
    const enabled = useStatsSelector((state) => state.enabled);
    const stats = useStatsSelector((state) => state.stats);

    return (
        <div className={styles.root}>
            <header className={styles.header}>
                <Text weight="semibold" size={400} className={styles.title}>
                    {documentName}
                </Text>
                {stats && <Badge appearance="tint">{`v${stats.document.version}`}</Badge>}
                <div className={styles.spacer} />
                {databaseName && (
                    <Text size={200} className={styles.caption}>
                        {databaseName}
                    </Text>
                )}
            </header>

            <div className={styles.scroll}>
                {!enabled ? (
                    <MessageBar intent="info">
                        <MessageBarBody>{loc.previewDisabled}</MessageBarBody>
                    </MessageBar>
                ) : !stats ? (
                    <MessageBar intent="info">
                        <MessageBarBody>{loc.noStatsYet}</MessageBarBody>
                    </MessageBar>
                ) : (
                    <Content stats={stats} />
                )}
            </div>

            <ExportFooter />
        </div>
    );
};

type Stats = NonNullable<LanguageServiceStatsWebviewState["stats"]>;

const Content = ({ stats }: { stats: Stats }) => {
    const styles = useStyles();
    const { syntax, semantics, metadata, requests } = stats;
    const counts = semantics.diagnostics;
    const resident = metadata.scopes.reduce((total, scope) => total + scope.residentHits, 0);
    const server = metadata.scopes.reduce((total, scope) => total + scope.serverFetches, 0);
    const elapsed = metadata.scopes.reduce((total, scope) => total + scope.elapsedMs, 0);
    const slowest = metadata.fetches.reduce((worst, fetch) => Math.max(worst, fetch.elapsedMs), 0);
    const latency = Object.entries(requests.latency);

    return (
        <>
            <section className={styles.section}>
                <Text weight="semibold" size={400}>
                    {loc.pipeline}
                </Text>
                <div className={styles.cards}>
                    <MetricCard
                        label={loc.parse}
                        value={formatMs(syntax.elapsedMs)}
                        unit="ms"
                        budgetMs={syntax.budget.targetMs}
                        history={syntax.history.samples}
                        caption={loc.parseCaption(syntax.mode, syntax.changedRangeCount)}
                    />
                    <MetricCard
                        label={loc.bind}
                        value={formatMs(semantics.elapsedMs)}
                        unit="ms"
                        budgetMs={semantics.budget.targetMs}
                        history={semantics.history.samples}
                        caption={loc.bindCaption(semantics.unitsRebound, semantics.unitsExamined)}
                    />
                    <MetricCard
                        label={loc.diagnostics}
                        value={String(semantics.diagnosticCount)}
                        caption={loc.diagnosticsCaption(counts.error, counts.warning, counts.hint)}
                        tone={counts.error > 0 ? "danger" : "neutral"}
                    />
                    <MetricCard
                        label={loc.timeLoading}
                        value={formatMs(elapsed)}
                        unit="ms"
                        caption={loc.fetchesAcross(
                            metadata.observedFetches,
                            metadata.scopes.length,
                        )}
                    />
                    <MetricCard
                        label={loc.answeredLocally}
                        value={
                            resident + server === 0
                                ? "—"
                                : `${Math.round((resident / (resident + server)) * 100)}%`
                        }
                        caption={loc.residentCaption(resident, server)}
                        tone={resident + server > 0 && resident === 0 ? "caution" : "neutral"}
                    />
                    <MetricCard
                        label={loc.slowestFetch}
                        value={metadata.observedFetches === 0 ? "—" : formatMs(slowest)}
                        unit={metadata.observedFetches === 0 ? undefined : "ms"}
                        caption={
                            metadata.inFlight > 0
                                ? loc.loadingNowCaption(metadata.inFlight)
                                : undefined
                        }
                        tone={metadata.inFlight > 0 ? "caution" : "neutral"}
                    />
                </div>
            </section>

            <section className={styles.section}>
                <Text weight="semibold" size={400}>
                    {loc.requests}
                </Text>
                <Text size={200} className={styles.caption}>
                    {loc.requestsDescription}
                </Text>
                {latency.length === 0 ? (
                    <MessageBar intent="info">
                        <MessageBarBody>{loc.noRequests}</MessageBarBody>
                    </MessageBar>
                ) : (
                    <StatTable
                        label={loc.requests}
                        template="minmax(160px, 1fr) 84px 96px 96px 96px"
                        columns={[
                            { key: "method", label: loc.columnRequest },
                            { key: "count", label: loc.columnCount, align: "end" },
                            { key: "p50", label: loc.columnMedian, align: "end" },
                            { key: "p95", label: loc.columnP95, align: "end" },
                            { key: "stale", label: loc.columnStale, align: "end" },
                        ]}
                        rows={latency.map(([method, summary]) => ({
                            key: method,
                            cells: {
                                method,
                                count: String(summary.count),
                                p50: loc.milliseconds(formatMs(summary.p50Ms)),
                                p95: loc.milliseconds(formatMs(summary.p95Ms)),
                                stale: String(summary.staleDiscarded),
                            },
                        }))}
                    />
                )}
            </section>
            <section className={styles.section}>
                <Text weight="semibold" size={400}>
                    {loc.fetchLog}
                </Text>
                <Text size={200} className={styles.caption}>
                    {loc.fetchLogDescription}
                </Text>
                <FetchLog fetches={metadata.fetches} />
            </section>

            {metadata.invalidations.length > 0 && (
                <section className={styles.section}>
                    <Text weight="semibold" size={400}>
                        {loc.reloads}
                    </Text>
                    <StatTable
                        label={loc.reloads}
                        template="minmax(140px, 200px) minmax(200px, 1fr) 110px"
                        columns={[
                            { key: "cause", label: loc.columnCause },
                            { key: "note", label: loc.columnEffect },
                            { key: "rebuildMs", label: loc.columnReloadTime, align: "end" },
                        ]}
                        rows={metadata.invalidations.map((entry, index) => ({
                            key: `${entry.at}-${index}`,
                            cells: {
                                cause: entry.cause,
                                note: entry.note,
                                rebuildMs: loc.milliseconds(formatMs(entry.rebuildMs)),
                            },
                        }))}
                    />
                </section>
            )}
        </>
    );
};

const ExportFooter = () => {
    const styles = useStyles();
    const context = useContext(LanguageServiceStatsContext);
    const [includeIdentifiers, setIncludeIdentifiers] = useState(false);
    return (
        <footer className={styles.footer}>
            <Button
                appearance="primary"
                icon={<ArrowDownload16Regular />}
                onClick={() =>
                    void context?.extensionRpc.sendRequest(ExportStatsRequest.type, {
                        includeIdentifiers,
                    })
                }>
                {loc.export}
            </Button>
            <Tooltip content={loc.copyTooltip} relationship="label" withArrow>
                <Button
                    icon={<Copy16Regular />}
                    onClick={() =>
                        void context?.extensionRpc.sendRequest(CopyStatsRequest.type, {
                            includeIdentifiers,
                        })
                    }>
                    {loc.copy}
                </Button>
            </Tooltip>
            <Tooltip content={loc.includeIdentifiersHint} relationship="description" withArrow>
                <Checkbox
                    checked={includeIdentifiers}
                    onChange={(_, data) => setIncludeIdentifiers(Boolean(data.checked))}
                    label={loc.includeIdentifiers}
                />
            </Tooltip>
        </footer>
    );
};
