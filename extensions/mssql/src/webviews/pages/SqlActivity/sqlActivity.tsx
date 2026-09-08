/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from "react";
import {
    Button,
    Checkbox,
    Dropdown,
    MessageBar,
    Option,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { dmvBlockingTree, dmvFindings } from "sql-feature/diagnostics/dmv";

import { LocConstants } from "../../common/locConstants";
import { SqlDiagnosticsContext } from "../SqlDiagnostics/sqlDiagnosticsStateProvider";
import { useSqlDiagnosticsSelector } from "../SqlDiagnostics/sqlDiagnosticsSelector";
import type { DiagnosticsResult } from "../../../sharedInterfaces/sqlDiagnostics";
import {
    SqlFeatureNavigationItem,
    SqlFeaturePageFrame,
} from "../SqlDiagnostics/sqlFeaturePageFrame";

const useStyles = makeStyles({
    findings: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        paddingTop: "4px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    finding: { display: "flex", flexDirection: "column", gap: "2px" },
    tree: {
        margin: 0,
        paddingInlineStart: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    treeNode: { display: "flex", flexDirection: "column", gap: "2px" },
    treeSummary: { cursor: "pointer" },
});

export default function SqlActivityPage() {
    const context = useContext(SqlDiagnosticsContext);
    const loc = LocConstants.getInstance();
    const pageLoc = loc.sqlFeaturePage;
    const selectedQueryId = useSqlDiagnosticsSelector((state) => state.selectedQueryId);
    const result = useSqlDiagnosticsSelector((state) => state.result);
    const server = useSqlDiagnosticsSelector((state) => state.server);
    const dmvReadiness = useSqlDiagnosticsSelector((state) => state.dmvReadiness);
    const dmvReadinessBusy = useSqlDiagnosticsSelector((state) => state.dmvReadinessBusy);
    const collectors = Object.values(dmvReadiness?.collectors ?? {});
    const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | undefined>(undefined);
    const deniedCollector = collectors.find(
        (collector) => collector.status === "denied" && collector.permission,
    );
    const available = collectors.filter((collector) => collector.status === "ready").length;
    const needsAttention = collectors.filter(
        (collector) => collector.status === "denied" || collector.status === "unknown",
    ).length;
    const navigation: readonly SqlFeatureNavigationItem[] = [
        {
            id: "overview",
            queryId: "dmv.overview",
            label: pageLoc.activity.overview,
            description: pageLoc.activity.overviewDescription,
        },
        {
            id: "requests",
            queryId: "dmv.blockingChain",
            label: pageLoc.activity.requests,
            description: pageLoc.activity.requestsDescription,
        },
        {
            id: "workload",
            queryId: "dmv.topWorkload",
            label: pageLoc.activity.workload,
            description: pageLoc.activity.workloadDescription,
        },
        {
            id: "waits",
            queryId: "dmv.waitStats",
            label: pageLoc.activity.waits,
            description: pageLoc.activity.waitsDescription,
        },
        {
            id: "storage",
            queryId: "dmv.fileIoStalls",
            label: pageLoc.activity.storage,
            description: pageLoc.activity.storageDescription,
        },
        {
            id: "indexes",
            queryId: "dmv.missingIndexes",
            label: pageLoc.activity.indexes,
            description: pageLoc.activity.indexesDescription,
        },
    ];
    const waitQuery =
        selectedQueryId === "dmv.waitStats" || selectedQueryId === "dmv.waitStatsAzure";
    const workloadQuery = selectedQueryId === "dmv.topWorkload";
    const copyAdminRequest = async () => {
        if (!deniedCollector?.permission) return;
        const target =
            deniedCollector.permission === "VIEW DATABASE STATE"
                ? pageLoc.dmvReadiness.databaseTarget(server?.database ?? pageLoc.connectedServer)
                : pageLoc.dmvReadiness.serverTarget(server?.serverName ?? pageLoc.connectedServer);
        setCopyStatus(undefined);
        try {
            await navigator.clipboard.writeText(
                pageLoc.dmvReadiness.adminRequest(deniedCollector.permission, target),
            );
            setCopyStatus("copied");
        } catch {
            setCopyStatus("failed");
        }
    };
    const metric =
        result?.params?.metric === "cpu" || result?.params?.metric === "reads"
            ? String(result.params.metric)
            : "duration";
    const toolbar =
        context && (waitQuery || workloadQuery) ? (
            <>
                {workloadQuery && (
                    <Dropdown
                        aria-label={pageLoc.workloadMetric}
                        value={
                            metric === "cpu"
                                ? pageLoc.workloadCpu
                                : metric === "reads"
                                  ? pageLoc.workloadReads
                                  : pageLoc.workloadDuration
                        }
                        selectedOptions={[metric]}
                        onOptionSelect={(_, data) =>
                            context.runQuery(selectedQueryId!, { metric: data.optionValue })
                        }>
                        <Option value="duration">{pageLoc.workloadDuration}</Option>
                        <Option value="cpu">{pageLoc.workloadCpu}</Option>
                        <Option value="reads">{pageLoc.workloadReads}</Option>
                    </Dropdown>
                )}
                {waitQuery && (
                    <Checkbox
                        label={loc.sqlWaits.showBackground}
                        checked={result?.params?.showBackground === true}
                        onChange={(_, data) =>
                            context.runQuery(selectedQueryId!, {
                                showBackground: data.checked === true,
                            })
                        }
                    />
                )}
            </>
        ) : undefined;

    return (
        <SqlFeaturePageFrame
            section="dmv"
            title={loc.sqlFeatures.dmv}
            subtitle={pageLoc.sample}
            navigation={navigation}
            defaultQueryId="dmv.overview"
            toolbar={toolbar}
            summary={
                <>
                    <Text weight="semibold">{pageLoc.evidence}</Text>
                    <Text size={200}>
                        {dmvReadinessBusy
                            ? pageLoc.dmvReadiness.checking
                            : pageLoc.available(available)}
                    </Text>
                    {needsAttention > 0 && (
                        <Text size={200}>{pageLoc.unavailable(needsAttention)}</Text>
                    )}
                    {dmvReadiness && (
                        <div>
                            {Object.entries(dmvReadiness.collectors).map(([id, collector]) => {
                                const label =
                                    pageLoc.dmvReadiness[
                                        id as
                                            | "overview"
                                            | "requests"
                                            | "workload"
                                            | "waits"
                                            | "storage"
                                            | "indexes"
                                    ];
                                return (
                                    <Text key={id} size={200} style={{ display: "block" }}>
                                        {label}:{" "}
                                        {collector.status === "denied"
                                            ? pageLoc.dmvReadiness.denied(
                                                  collector.permission ?? "VIEW SERVER STATE",
                                              )
                                            : collector.status === "unsupported"
                                              ? pageLoc.dmvReadiness.unsupported
                                              : collector.status === "unknown"
                                                ? pageLoc.dmvReadiness.unknown
                                                : collector.status === "failed"
                                                  ? pageLoc.dmvReadiness.failed
                                                  : pageLoc.dmvReadiness.ready}
                                    </Text>
                                );
                            })}
                        </div>
                    )}
                    {deniedCollector?.permission && (
                        <>
                            <Text size={200}>{pageLoc.dmvReadiness.accessResolution}</Text>
                            {copyStatus === "copied" && (
                                <MessageBar intent="success">
                                    {pageLoc.dmvReadiness.adminRequestCopied}
                                </MessageBar>
                            )}
                            {copyStatus === "failed" && (
                                <MessageBar intent="error">
                                    {pageLoc.dmvReadiness.adminRequestCopyFailed}
                                </MessageBar>
                            )}
                            <Button onClick={() => void copyAdminRequest()}>
                                {pageLoc.dmvReadiness.copyAdminRequest}
                            </Button>
                        </>
                    )}
                    <MessageBar>{loc.sqlWaits.context}</MessageBar>
                    <DmvFindingsPanel result={result} />
                    <DmvBlockingTree result={result} />
                </>
            }
        />
    );
}

function DmvBlockingTree({ result }: { result: DiagnosticsResult | undefined }) {
    const styles = useStyles();
    const loc = LocConstants.getInstance().sqlFeaturePage.dmvBlockingTree;
    if (!result || result.queryId !== "dmv.blockingChain" || result.rows.length === 0) return <></>;
    const tree = dmvBlockingTree(result.rows as readonly Record<string, unknown>[]);
    const renderNode = (node: (typeof tree)[number]): React.ReactNode => {
        const session = node.sessionId === undefined ? "unknown" : String(node.sessionId);
        const blocker = node.blockerId === undefined ? "unknown" : String(node.blockerId);
        const status =
            node.status === "cycle"
                ? loc.cycle
                : node.status === "invisible"
                  ? loc.invisible
                  : node.status === "special"
                    ? loc.special
                    : loc.visible;
        return (
            <li key={`${node.rowIndex}:${node.level}`} className={styles.treeNode}>
                {node.children.length > 0 ? (
                    <details open>
                        <summary className={styles.treeSummary}>
                            {loc.node(session, blocker)}
                        </summary>
                        <Text size={200}>{status}</Text>
                        <ul className={styles.tree}>{node.children.map(renderNode)}</ul>
                    </details>
                ) : (
                    <Text>
                        {loc.node(session, blocker)}
                        <Text size={200} as="span">
                            {" "}
                            {status}
                        </Text>
                    </Text>
                )}
            </li>
        );
    };
    return (
        <section className={styles.findings} aria-label={loc.title}>
            <Text weight="semibold">{loc.title}</Text>
            <ul className={styles.tree} role="tree" aria-label={loc.title}>
                {tree.map(renderNode)}
            </ul>
            <Text size={200}>{loc.limitation}</Text>
        </section>
    );
}

function DmvFindingsPanel({ result }: { result: DiagnosticsResult | undefined }) {
    const styles = useStyles();
    const pageLoc = LocConstants.getInstance().sqlFeaturePage;
    const findings = result
        ? dmvFindings(result.queryId, result.rows as readonly Record<string, unknown>[])
        : [];
    if (findings.length === 0) return <></>;

    const messageFor = (finding: (typeof findings)[number]): string => {
        const metrics = finding.metrics;
        switch (finding.id) {
            case "dmv.overview.activity-observed":
                return pageLoc.dmvFindings.activity(metrics.activeRequests ?? 0);
            case "dmv.overview.blocking-observed":
                return pageLoc.dmvFindings.blocking(
                    metrics.blockedRequests ?? 0,
                    metrics.maxDepth ?? 0,
                );
            case "dmv.blocking.relationships-observed":
                return pageLoc.dmvFindings.blocking(
                    metrics.relationships ?? 0,
                    metrics.maxDepth ?? 0,
                );
            case "dmv.blocking.cycle-observed":
                return pageLoc.dmvFindings.cycle(metrics.rows ?? 0);
            case "dmv.blocking.invisible-parent":
                return pageLoc.dmvFindings.invisibleParent(metrics.rows ?? 0);
            case "dmv.blocking.special-identifier":
                return pageLoc.dmvFindings.specialIdentifier(metrics.rows ?? 0);
            case "dmv.workload.cache-observation":
                return pageLoc.dmvFindings.workload(metrics.rows ?? 0);
            case "dmv.storage.read-not-measured":
                return pageLoc.dmvFindings.readNotMeasured(metrics.files ?? 0);
            case "dmv.storage.write-not-measured":
                return pageLoc.dmvFindings.writeNotMeasured(metrics.files ?? 0);
            case "dmv.index.candidate":
                return pageLoc.dmvFindings.index(metrics.candidates ?? 0);
            case "dmv.wait.category.locking":
                return pageLoc.dmvFindings.wait.locking(metrics.rows ?? 0, metrics.waitTimeMs ?? 0);
            case "dmv.wait.category.dataIo":
                return pageLoc.dmvFindings.wait.dataIo(metrics.rows ?? 0, metrics.waitTimeMs ?? 0);
            case "dmv.wait.category.logIo":
                return pageLoc.dmvFindings.wait.logIo(metrics.rows ?? 0, metrics.waitTimeMs ?? 0);
            case "dmv.wait.category.client":
                return pageLoc.dmvFindings.wait.client(metrics.rows ?? 0, metrics.waitTimeMs ?? 0);
            case "dmv.wait.category.cpu":
                return pageLoc.dmvFindings.wait.cpu(metrics.rows ?? 0, metrics.waitTimeMs ?? 0);
            case "dmv.wait.category.parallelism":
                return pageLoc.dmvFindings.wait.parallelism(
                    metrics.rows ?? 0,
                    metrics.waitTimeMs ?? 0,
                );
            case "dmv.wait.category.workers":
                return pageLoc.dmvFindings.wait.workers(metrics.rows ?? 0, metrics.waitTimeMs ?? 0);
            case "dmv.wait.category.memory":
                return pageLoc.dmvFindings.wait.memory(metrics.rows ?? 0, metrics.waitTimeMs ?? 0);
            case "dmv.wait.category.unknown":
                return pageLoc.dmvFindings.wait.unknown(metrics.rows ?? 0, metrics.waitTimeMs ?? 0);
        }
    };

    return (
        <section className={styles.findings} aria-label={pageLoc.dmvFindings.title}>
            <Text weight="semibold">{pageLoc.dmvFindings.title}</Text>
            {findings.map((finding) => (
                <div className={styles.finding} key={`${finding.id}:${finding.version}`}>
                    <Text>{messageFor(finding)}</Text>
                    <Text size={200}>
                        {pageLoc.dmvFindings.evidence(finding.evidence.length)}
                        {finding.applicability === "limited"
                            ? ` · ${pageLoc.dmvFindings.limited}`
                            : ""}
                    </Text>
                </div>
            ))}
        </section>
    );
}
