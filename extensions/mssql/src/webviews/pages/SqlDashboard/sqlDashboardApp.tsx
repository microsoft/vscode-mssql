/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Caption1,
    Divider,
    makeStyles,
    MessageBar,
    MessageBarBody,
    ProgressBar,
    Spinner,
    Text,
    tokens,
    Tooltip,
} from "@fluentui/react-components";
import {
    AlertRegular,
    ArrowClockwiseRegular,
    ChevronLeftRegular,
    ChevronRightRegular,
    DatabaseRegular,
    HomeRegular,
    OpenRegular,
    PulseRegular,
    ServerRegular,
    SettingsRegular,
} from "@fluentui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { SqlDashboard } from "../../../sharedInterfaces/sqlDashboard";
import { perfMarkAfterNextPaint, perfMarkAfterNextPaintComputed } from "../../common/perfMarks";
import { VscodeWebviewContext } from "../../common/vscodeWebviewProvider";
import { sqlDashboardLoc as loc } from "./locConstants";

const useStyles = makeStyles({
    root: {
        width: "100%",
        height: "100%",
        display: "grid",
        gridTemplateColumns: "208px minmax(0, 1fr)",
        gridTemplateRows: "44px minmax(0, 1fr)",
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
    },
    rootCollapsed: {
        gridTemplateColumns: "48px minmax(0, 1fr)",
    },
    topbar: {
        gridColumn: "1 / -1",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "0 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        minWidth: 0,
    },
    brand: {
        display: "flex",
        alignItems: "center",
        gap: "7px",
        fontWeight: 600,
        whiteSpace: "nowrap",
    },
    connection: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        color: tokens.colorNeutralForeground2,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    spacer: { flex: 1 },
    nav: {
        minHeight: 0,
        borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
        padding: "8px 6px",
        display: "flex",
        flexDirection: "column",
        gap: "3px",
        backgroundColor: tokens.colorNeutralBackground2,
    },
    navButton: {
        width: "100%",
        justifyContent: "flex-start",
    },
    navButtonCollapsed: {
        minWidth: "34px",
        width: "34px",
        paddingLeft: "0",
        paddingRight: "0",
    },
    navFooter: {
        marginTop: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    main: {
        minWidth: 0,
        minHeight: 0,
        overflow: "auto",
        position: "relative",
    },
    content: {
        width: "100%",
        maxWidth: "1480px",
        margin: "0 auto",
        padding: "18px 22px 32px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
    },
    pageHeader: {
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
    },
    pageTitle: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        minWidth: 0,
    },
    kpiGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(168px, 1fr))",
        gap: "8px",
    },
    kpi: {
        minHeight: "92px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        borderRadius: tokens.borderRadiusMedium,
    },
    kpiValue: {
        fontSize: tokens.fontSizeBase500,
        fontWeight: 600,
        lineHeight: tokens.lineHeightBase500,
    },
    toneGood: { borderLeft: `3px solid ${tokens.colorPaletteGreenBorderActive}` },
    toneWarning: { borderLeft: `3px solid ${tokens.colorPaletteYellowBorderActive}` },
    toneCritical: { borderLeft: `3px solid ${tokens.colorPaletteRedBorderActive}` },
    toneUnknown: { borderLeft: `3px solid ${tokens.colorNeutralStrokeAccessible}` },
    panel: {
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        borderRadius: tokens.borderRadiusMedium,
        minWidth: 0,
    },
    panelHeader: {
        minHeight: "38px",
        padding: "0 12px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        fontWeight: 600,
    },
    panelBody: { padding: "12px" },
    propertyGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "1px",
        backgroundColor: tokens.colorNeutralStroke2,
    },
    property: {
        backgroundColor: tokens.colorNeutralBackground2,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    attentionGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: "8px",
    },
    attention: {
        display: "flex",
        gap: "9px",
        padding: "10px 12px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    attentionBody: { display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 },
    table: { width: "100%", fontSize: tokens.fontSizeBase200 },
    tableHeader: {
        height: "34px",
        display: "grid",
        alignItems: "center",
        gap: "8px",
        padding: "0 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground3,
        color: tokens.colorNeutralForeground2,
        fontWeight: 600,
        boxSizing: "border-box",
    },
    tableScroller: { maxHeight: "390px", overflow: "auto", contain: "strict" },
    tableRow: {
        position: "absolute",
        left: 0,
        right: 0,
        height: "36px",
        display: "grid",
        alignItems: "center",
        gap: "8px",
        padding: "0 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
        boxSizing: "border-box",
        color: tokens.colorNeutralForeground1,
        backgroundColor: tokens.colorNeutralBackground2,
        cursor: "pointer",
    },
    tableCell: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    numeric: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
    evidence: {
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
        paddingTop: "4px",
    },
    unavailable: {
        minHeight: "280px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        textAlign: "center",
        padding: "24px",
    },
    waitGrid: {
        display: "grid",
        gridTemplateColumns: "minmax(120px, 180px) minmax(140px, 1fr) 70px",
        gap: "8px",
        alignItems: "center",
        padding: "5px 0",
    },
    loadingOverlay: {
        position: "sticky",
        top: 0,
        zIndex: 4,
        height: "2px",
    },
});

function useDashboard() {
    const webview = useContext(VscodeWebviewContext);
    if (!webview) {
        throw new Error("SQL Dashboard must be rendered inside VscodeWebviewProvider");
    }
    const state = useSyncExternalStore(
        webview.subscribe,
        webview.getSnapshot as () => SqlDashboard.WebviewState,
    );
    return { state, rpc: webview.extensionRpc };
}

function toneClass(styles: ReturnType<typeof useStyles>, tone: SqlDashboard.KpiTone): string {
    switch (tone) {
        case "good":
            return styles.toneGood;
        case "warning":
            return styles.toneWarning;
        case "critical":
            return styles.toneCritical;
        case "unknown":
            return styles.toneUnknown;
        default:
            return "";
    }
}

function Sparkline({ values }: { values: number[] }) {
    const points = useMemo(() => {
        if (values.length < 2) {
            return "";
        }
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = Math.max(1, max - min);
        return values
            .map((value, index) => {
                const x = (index / (values.length - 1)) * 100;
                const y = 22 - ((value - min) / range) * 20;
                return `${x},${y}`;
            })
            .join(" ");
    }, [values]);
    return (
        <svg width="100%" height="24" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden>
            <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}

function KpiGrid({ kpis }: { kpis: SqlDashboard.Kpi[] }) {
    const styles = useStyles();
    return (
        <div className={styles.kpiGrid} aria-label={loc.keyPerformanceIndicators}>
            {kpis.map((kpi) => (
                <div className={`${styles.kpi} ${toneClass(styles, kpi.tone)}`} key={kpi.id}>
                    <Caption1>{loc.content(kpi.label)}</Caption1>
                    <div className={styles.kpiValue}>{kpi.value}</div>
                    {kpi.note ? <Caption1>{loc.content(kpi.note)}</Caption1> : null}
                    {kpi.delta ? (
                        <Badge
                            size="small"
                            appearance="tint"
                            color={kpi.delta.direction === "up" ? "warning" : "success"}>
                            {kpi.delta.value}
                        </Badge>
                    ) : null}
                    {kpi.series && kpi.series.length > 1 ? <Sparkline values={kpi.series} /> : null}
                </div>
            ))}
        </div>
    );
}

function Attention({
    items,
    navigate,
}: {
    items: SqlDashboard.AttentionItem[];
    navigate: (route: SqlDashboard.Route) => void;
}) {
    const styles = useStyles();
    if (items.length === 0) {
        return null;
    }
    return (
        <section aria-labelledby="dashboard-attention-heading">
            <Text id="dashboard-attention-heading" weight="semibold">
                {loc.needsAttention}
            </Text>
            <div className={styles.attentionGrid}>
                {items.map((item) => (
                    <div className={styles.attention} key={item.id}>
                        <AlertRegular aria-hidden />
                        <div className={styles.attentionBody}>
                            <Text weight="semibold">{loc.content(item.title)}</Text>
                            <Caption1>{loc.content(item.detail)}</Caption1>
                            {item.route ? (
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={<OpenRegular />}
                                    onClick={() => navigate(item.route!)}>
                                    {loc.openDetails}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}

const QUERY_COLUMNS = "minmax(220px, 1.8fr) 90px 105px 105px 90px 84px";

function QueryTable({
    rows,
    total,
    onOpen,
}: {
    rows: SqlDashboard.QueryRow[];
    total: number;
    onOpen: (row: SqlDashboard.QueryRow) => void;
}) {
    const styles = useStyles();
    const parentRef = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 36,
        overscan: 8,
    });
    return (
        <div className={styles.table} role="table" aria-rowcount={total + 1}>
            <div
                className={styles.tableHeader}
                style={{ gridTemplateColumns: QUERY_COLUMNS }}
                role="row">
                <span role="columnheader">{loc.query}</span>
                <span role="columnheader" className={styles.numeric}>
                    {loc.executions}
                </span>
                <span role="columnheader" className={styles.numeric}>
                    {loc.average}
                </span>
                <span role="columnheader" className={styles.numeric}>
                    {loc.current}
                </span>
                <span role="columnheader" className={styles.numeric}>
                    {loc.change}
                </span>
                <span role="columnheader" className={styles.numeric}>
                    {loc.plans}
                </span>
            </div>
            <div className={styles.tableScroller} ref={parentRef} role="rowgroup">
                <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                        const row = rows[virtualRow.index];
                        return (
                            <button
                                type="button"
                                role="row"
                                aria-rowindex={virtualRow.index + 2}
                                className={styles.tableRow}
                                style={{
                                    gridTemplateColumns: QUERY_COLUMNS,
                                    transform: `translateY(${virtualRow.start}px)`,
                                }}
                                key={row.queryId}
                                onClick={() => onOpen(row)}>
                                <span role="cell" className={styles.tableCell}>
                                    {row.queryLabel}
                                </span>
                                <span
                                    role="cell"
                                    className={`${styles.tableCell} ${styles.numeric}`}>
                                    {row.executions.toLocaleString()}
                                </span>
                                <span
                                    role="cell"
                                    className={`${styles.tableCell} ${styles.numeric}`}>
                                    {Math.round(row.averageDurationMs)} ms
                                </span>
                                <span
                                    role="cell"
                                    className={`${styles.tableCell} ${styles.numeric}`}>
                                    {Math.round(row.currentDurationMs)} ms
                                </span>
                                <span
                                    role="cell"
                                    className={`${styles.tableCell} ${styles.numeric}`}>
                                    {row.regressPercent === undefined
                                        ? loc.unknown
                                        : `${row.regressPercent >= 0 ? "+" : ""}${Math.round(row.regressPercent)}%`}
                                </span>
                                <span
                                    role="cell"
                                    className={`${styles.tableCell} ${styles.numeric}`}>
                                    {row.planCount}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
            {total > rows.length ? (
                <div className={styles.panelBody}>
                    <Caption1>{loc.showingTopQueries(rows.length, total)}</Caption1>
                </div>
            ) : null}
        </div>
    );
}

function DatabaseTable({
    rows,
    onOpen,
}: {
    rows: SqlDashboard.DatabaseRow[];
    onOpen: (name: string) => void;
}) {
    const styles = useStyles();
    const columns = "minmax(180px, 1.5fr) 90px 120px 90px 100px 100px 120px";
    return (
        <div className={styles.table} role="table" aria-rowcount={rows.length + 1}>
            <div className={styles.tableHeader} style={{ gridTemplateColumns: columns }} role="row">
                {[
                    loc.database,
                    loc.state,
                    loc.size,
                    loc.logUsed,
                    loc.recovery,
                    loc.compatibility,
                    loc.lastBackup,
                ].map((label) => (
                    <span role="columnheader" key={label}>
                        {label}
                    </span>
                ))}
            </div>
            <div role="rowgroup" style={{ position: "relative", height: `${rows.length * 36}px` }}>
                {rows.map((row, index) => (
                    <button
                        type="button"
                        role="row"
                        className={styles.tableRow}
                        style={{
                            gridTemplateColumns: columns,
                            transform: `translateY(${index * 36}px)`,
                        }}
                        key={row.name}
                        onClick={() => onOpen(row.name)}>
                        <span role="cell" className={styles.tableCell}>
                            {row.name}
                        </span>
                        <span role="cell" className={styles.tableCell}>
                            {row.state}
                        </span>
                        <span role="cell" className={styles.tableCell}>
                            {row.size}
                        </span>
                        <span role="cell" className={styles.tableCell}>
                            {row.logUsed}
                        </span>
                        <span role="cell" className={styles.tableCell}>
                            {row.recoveryModel}
                        </span>
                        <span role="cell" className={styles.tableCell}>
                            {row.compatibilityLevel}
                        </span>
                        <span role="cell" className={styles.tableCell}>
                            {row.lastBackup}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}

function Evidence({ sections }: { sections: SqlDashboard.SectionFacts[] }) {
    const styles = useStyles();
    return (
        <div className={styles.evidence} aria-label={loc.dataProvenanceAndFreshness}>
            {sections.map((section) => {
                const freshness =
                    section.freshness.state === "unavailable"
                        ? loc.unavailable
                        : section.freshness.state === "sampled"
                          ? loc.sampledAt(new Date(section.freshness.asOfUtc).toLocaleTimeString())
                          : section.freshness.state === "live"
                            ? loc.liveAt(new Date(section.freshness.asOfUtc).toLocaleTimeString())
                            : loc.stateAsOf(
                                  section.freshness.state,
                                  new Date(section.freshness.asOfUtc).toLocaleTimeString(),
                              );
                return (
                    <Tooltip
                        key={section.id}
                        content={`${section.source.label} · ${freshness}`}
                        relationship="description">
                        <Badge
                            appearance="outline"
                            color={section.load.state === "ready" ? "informative" : "warning"}>
                            {loc.content(section.title)} · {freshness}
                        </Badge>
                    </Tooltip>
                );
            })}
        </div>
    );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
    const styles = useStyles();
    return (
        <section className={styles.panel}>
            <div className={styles.panelHeader}>{title}</div>
            {children}
        </section>
    );
}

function PageContent({
    page,
    navigate,
    openQueryStudio,
}: {
    page: SqlDashboard.Page;
    navigate: (route: SqlDashboard.Route) => void;
    openQueryStudio: (database: string, queryId?: string) => void;
}) {
    const styles = useStyles();
    if (page.kind === "unavailable") {
        return (
            <div className={`${styles.panel} ${styles.unavailable}`}>
                <AlertRegular fontSize={28} />
                <Text size={500} weight="semibold">
                    {loc.content(page.title)}
                </Text>
                <Text>{loc.content(page.state.detail)}</Text>
                {page.state.remediation ? (
                    <Caption1>{loc.content(page.state.remediation)}</Caption1>
                ) : null}
                <Evidence sections={page.sections} />
            </div>
        );
    }
    return (
        <>
            <KpiGrid kpis={page.kpis} />
            <Attention items={page.attention} navigate={navigate} />
            {page.kind === "serverOverview" ? (
                <>
                    <Panel title={loc.serverDetails}>
                        <div className={styles.propertyGrid}>
                            {Object.entries(page.server).map(([key, value]) => (
                                <div className={styles.property} key={key}>
                                    <Caption1>{loc.content(key)}</Caption1>
                                    <Text>{value}</Text>
                                </div>
                            ))}
                        </div>
                    </Panel>
                    <Panel title={loc.databases}>
                        <DatabaseTable
                            rows={page.databases}
                            onOpen={(database) => navigate({ kind: "databaseOverview", database })}
                        />
                    </Panel>
                </>
            ) : null}
            {page.kind === "databaseOverview" ? (
                <>
                    <Panel title={loc.databaseDetails}>
                        <div className={styles.propertyGrid}>
                            {page.properties.map((property) => (
                                <div className={styles.property} key={property.label}>
                                    <Caption1>{loc.content(property.label)}</Caption1>
                                    <Text>{property.value}</Text>
                                </div>
                            ))}
                        </div>
                    </Panel>
                    <Panel title={loc.queryStore}>
                        <div className={styles.panelBody}>
                            <Text>
                                {page.queryStore.state === "off"
                                    ? loc.queryStoreDisabled
                                    : page.queryStore.state === "unknown"
                                      ? loc.queryStoreUnknown
                                      : loc.queryStoreUsage(
                                            page.queryStore.usedMb ?? 0,
                                            page.queryStore.maxMb ?? 0,
                                        )}
                            </Text>
                            {page.queryStore.usedMb !== undefined && page.queryStore.maxMb ? (
                                <ProgressBar
                                    value={page.queryStore.usedMb / page.queryStore.maxMb}
                                    thickness="medium"
                                />
                            ) : null}
                        </div>
                    </Panel>
                    {page.topQueries.length > 0 ? (
                        <Panel title={loc.topQueries}>
                            <QueryTable
                                rows={page.topQueries}
                                total={page.topQueries.length}
                                onOpen={(row) =>
                                    navigate({
                                        kind: "queryDetail",
                                        database: page.database,
                                        queryId: row.queryId,
                                    })
                                }
                            />
                        </Panel>
                    ) : null}
                </>
            ) : null}
            {page.kind === "databasePerformance" ? (
                <Panel title={loc.topQueriesWindow(page.windowLabel)}>
                    <QueryTable
                        rows={page.queries}
                        total={page.totalQueryCount}
                        onOpen={(row) =>
                            navigate({
                                kind: "queryDetail",
                                database: page.database,
                                queryId: row.queryId,
                            })
                        }
                    />
                </Panel>
            ) : null}
            {page.kind === "queryDetail" ? (
                <>
                    <MessageBar intent="info">
                        <MessageBarBody>
                            {loc.content(page.privacy.message)}
                            <Button
                                appearance="subtle"
                                size="small"
                                icon={<OpenRegular />}
                                onClick={() => openQueryStudio(page.database, page.queryId)}>
                                {loc.openQueryStudio}
                            </Button>
                        </MessageBarBody>
                    </MessageBar>
                    <Panel title={loc.waitCategories}>
                        <div className={styles.panelBody}>
                            {page.waits.length === 0 ? (
                                <Caption1>{loc.waitStatisticsUnavailable}</Caption1>
                            ) : (
                                page.waits.map((wait) => (
                                    <div className={styles.waitGrid} key={wait.category}>
                                        <Text>{wait.category}</Text>
                                        <ProgressBar value={wait.percent / 100} />
                                        <Caption1>{Math.round(wait.percent)}%</Caption1>
                                    </div>
                                ))
                            )}
                        </div>
                    </Panel>
                    <Panel title={loc.planHistory}>
                        <div className={styles.propertyGrid}>
                            {page.plans.map((plan) => (
                                <div className={styles.property} key={plan.planId}>
                                    <Text weight="semibold">{loc.plan(plan.planId)}</Text>
                                    <Caption1>
                                        {loc.planSummary(
                                            Math.round(plan.averageDurationMs),
                                            plan.executions.toLocaleString(),
                                        )}
                                    </Caption1>
                                    <Badge appearance="outline">{loc.content(plan.status)}</Badge>
                                </div>
                            ))}
                        </div>
                    </Panel>
                </>
            ) : null}
            <Evidence sections={page.sections} />
        </>
    );
}

export function SqlDashboardApp() {
    const styles = useStyles();
    const { state, rpc } = useDashboard();
    const [collapsed, setCollapsed] = useState(false);
    const renderedRequestRef = useRef(-1);

    const navigate = useCallback(
        (route: SqlDashboard.Route) => {
            void rpc.sendRequest(SqlDashboard.NavigateRequest.type, { route });
        },
        [rpc],
    );

    const openQueryStudio = useCallback(
        (database: string, queryId?: string) => {
            void rpc.sendRequest(SqlDashboard.OpenQueryStudioRequest.type, { database, queryId });
        },
        [rpc],
    );

    useEffect(() => {
        perfMarkAfterNextPaint("mssql.dashboard.shell.paint", { mode: state.mode });
    }, []);

    useEffect(() => {
        if (
            state.status !== "ready" ||
            !state.page ||
            renderedRequestRef.current === state.requestId
        ) {
            return;
        }
        renderedRequestRef.current = state.requestId;
        const tableRows =
            state.page.kind === "databasePerformance"
                ? state.page.queries.length
                : state.page.kind === "databaseOverview"
                  ? state.page.topQueries.length
                  : state.page.kind === "serverOverview"
                    ? state.page.databases.length
                    : state.page.kind === "queryDetail"
                      ? state.page.plans.length
                      : 0;
        perfMarkAfterNextPaintComputed("mssql.dashboard.route.renderComplete", () => {
            void rpc.sendNotification(SqlDashboard.RenderedNotification.type, {
                requestId: state.requestId,
                route: state.route.kind,
                tableRows,
            });
            return {
                requestId: state.requestId,
                route: state.route.kind,
                tableRows,
            };
        });
        perfMarkAfterNextPaint("mssql.dashboard.table.renderComplete", {
            route: state.route.kind,
            rows: tableRows,
            totalRows:
                state.page.kind === "databasePerformance" ? state.page.totalQueryCount : tableRows,
        });
    }, [rpc, state]);

    const database = state.connection.database ?? "WideWorldImporters";
    const navItems: Array<{
        label: string;
        route: SqlDashboard.Route;
        icon: React.ReactElement;
    }> = [
        {
            label: loc.serverOverview,
            route: { kind: "serverOverview" },
            icon: <HomeRegular />,
        },
        {
            label: loc.databaseOverview,
            route: { kind: "databaseOverview", database },
            icon: <DatabaseRegular />,
        },
        {
            label: loc.performance,
            route: { kind: "databasePerformance", database },
            icon: <PulseRegular />,
        },
        {
            label: loc.liveActivity,
            route: { kind: "liveActivity", database },
            icon: <ServerRegular />,
        },
        { label: loc.sqlAgent, route: { kind: "agent" }, icon: <SettingsRegular /> },
    ];

    const pageTitle = state.page?.title ?? loc.title;
    const pageSubtitle = state.page?.subtitle ?? loc.loadingSubtitle;

    return (
        <div className={`${styles.root} ${collapsed ? styles.rootCollapsed : ""}`}>
            <header className={styles.topbar}>
                <div className={styles.brand}>
                    <PulseRegular />
                    <span>{loc.title}</span>
                </div>
                <Divider vertical />
                <div className={styles.connection} title={state.connection.displayName}>
                    <ServerRegular />
                    {state.connection.displayName}
                </div>
                {state.mode === "mock" ? (
                    <Badge appearance="tint" color="informative">
                        {loc.deterministicData(state.scenario ?? "canonical")}
                    </Badge>
                ) : (
                    <Badge appearance="outline">{state.connection.backend ?? loc.live}</Badge>
                )}
                <div className={styles.spacer} />
                <Button
                    appearance="subtle"
                    icon={<ArrowClockwiseRegular />}
                    disabled={state.status === "loading"}
                    onClick={() => void rpc.sendRequest(SqlDashboard.RefreshRequest.type)}>
                    {loc.refresh}
                </Button>
            </header>
            <nav className={styles.nav} aria-label={loc.navigation}>
                {navItems.map((item) => (
                    <Tooltip key={item.route.kind} content={item.label} relationship="label">
                        <Button
                            className={`${styles.navButton} ${collapsed ? styles.navButtonCollapsed : ""}`}
                            appearance={state.route.kind === item.route.kind ? "primary" : "subtle"}
                            icon={item.icon}
                            aria-current={state.route.kind === item.route.kind ? "page" : undefined}
                            onClick={() => navigate(item.route)}>
                            {collapsed ? null : item.label}
                        </Button>
                    </Tooltip>
                ))}
                <div className={styles.navFooter}>
                    <Button
                        className={`${styles.navButton} ${collapsed ? styles.navButtonCollapsed : ""}`}
                        appearance="subtle"
                        icon={collapsed ? <ChevronRightRegular /> : <ChevronLeftRegular />}
                        aria-label={collapsed ? loc.expandNavigation : loc.collapseNavigation}
                        onClick={() => setCollapsed((value) => !value)}>
                        {collapsed ? null : loc.collapse}
                    </Button>
                </div>
            </nav>
            <main className={styles.main}>
                {state.status === "loading" ? (
                    <div className={styles.loadingOverlay}>
                        <ProgressBar />
                    </div>
                ) : null}
                <div className={styles.content}>
                    <div className={styles.pageHeader}>
                        <div className={styles.pageTitle}>
                            <Text as="h1" size={600} weight="semibold">
                                {pageTitle}
                            </Text>
                            <Text>{pageSubtitle}</Text>
                        </div>
                        {state.status === "loading" && !state.page ? <Spinner size="tiny" /> : null}
                    </div>
                    {state.status === "error" ? (
                        <MessageBar intent="error">
                            <MessageBarBody>
                                {state.error?.detail ?? loc.routeLoadFailed}
                            </MessageBarBody>
                        </MessageBar>
                    ) : null}
                    {state.page ? (
                        <PageContent
                            page={state.page}
                            navigate={navigate}
                            openQueryStudio={openQueryStudio}
                        />
                    ) : null}
                </div>
            </main>
        </div>
    );
}
