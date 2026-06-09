/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, makeStyles, Text, tokens } from "@fluentui/react-components";
import { ChevronDownRegular, ChevronRightRegular } from "@fluentui/react-icons";
import * as React from "react";
import { RunStatus } from "../../../../cloudDeploy/runs/types";
import { locConstants } from "../../../common/locConstants";
import { StatusBadge } from "./statusBadge";
import { validationTypeLabel } from "./humanize";

// Mirrors the structural shapes from `cloudDeploy/runs/types.ts`. We keep a
// local structural duplicate here so this file does not import the host-only
// runtime module (the webview's tsconfig excludes most of `cloudDeploy/`).
type Severity = "info" | "warning" | "error";

type ConnectivityFindingShape = {
    readonly kind: "connectivity";
    readonly outcome: string;
    readonly severity: Severity;
    readonly message: string;
};

type StaticAnalysisFindingShape = {
    readonly kind: "static-analysis";
    readonly ruleId: string;
    readonly severity: Severity;
    readonly message: string;
    readonly location?: {
        readonly file: string;
        readonly line?: number;
        readonly column?: number;
    };
};

type UnitTestFindingShape = {
    readonly kind: "unit-tests";
    readonly testName: string;
    readonly outcome: "passed" | "failed" | "skipped" | "errored";
    readonly message?: string;
    readonly durationMs?: number;
};

type WorkloadFindingShape = {
    readonly kind: "workload-playback";
    readonly stepId: string;
    readonly regression: string;
    readonly delta: number;
    readonly message: string;
};

type FindingShape =
    | ConnectivityFindingShape
    | StaticAnalysisFindingShape
    | UnitTestFindingShape
    | WorkloadFindingShape;

type PayloadShape = {
    readonly validationType: string;
    readonly findings: readonly FindingShape[];
    readonly summary?: Record<string, unknown>;
};

interface ValidationLike {
    readonly validationId: string;
    readonly displayName: string;
    readonly status: string;
    readonly startedAtMs: number;
    readonly endedAtMs: number;
    readonly payload: PayloadShape;
    readonly errorMessage?: string;
}

const useStyles = makeStyles({
    card: {
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "4px",
        padding: "10px 12px",
        marginBottom: "10px",
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        marginBottom: "8px",
        cursor: "pointer",
    },
    chevron: {
        display: "flex",
        alignItems: "center",
        color: tokens.colorNeutralForeground3,
        flexShrink: 0,
    },
    title: {
        fontWeight: 600,
    },
    typeTag: {
        color: tokens.colorNeutralForeground3,
        fontFamily: "var(--vscode-editor-font-family), monospace",
        fontSize: "11px",
    },
    summaryRow: {
        display: "flex",
        gap: "10px",
        flexWrap: "wrap",
        marginBottom: "8px",
        fontSize: "12px",
        color: tokens.colorNeutralForeground2,
    },
    findingsTable: {
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "12px",
    },
    th: {
        textAlign: "left",
        padding: "4px 8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        fontSize: "10px",
        color: tokens.colorNeutralForeground3,
    },
    td: {
        padding: "4px 8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
        verticalAlign: "top",
    },
    location: {
        fontFamily: "var(--vscode-editor-font-family), monospace",
        fontSize: "11px",
        color: tokens.colorNeutralForeground3,
    },
    error: {
        color: tokens.colorPaletteRedForeground1,
        fontSize: "12px",
        marginTop: "6px",
    },
    empty: {
        color: tokens.colorNeutralForeground3,
        fontSize: "12px",
        fontStyle: "italic",
    },
    metricRow: {
        display: "flex",
        gap: "8px",
        marginBottom: "10px",
        flexWrap: "wrap",
    },
    metricPill: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        padding: "5px 10px",
        minWidth: "52px",
        borderRadius: "4px",
        backgroundColor: tokens.colorNeutralBackground3,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    metricLabel: {
        fontSize: "9px",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: tokens.colorNeutralForeground3,
    },
    metricValue: {
        fontSize: "16px",
        fontWeight: 700,
    },
    findingsToolbar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        marginBottom: "8px",
        flexWrap: "wrap",
    },
    toolbarGroup: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
    },
    toolbarLabel: {
        fontSize: "10px",
        color: tokens.colorNeutralForeground3,
    },
});

const SEVERITY_COLOR: Record<
    Severity,
    "informative" | "warning" | "danger" | "subtle" | "success"
> = {
    info: "informative",
    warning: "warning",
    error: "danger",
};

interface ValidationCardProps {
    readonly validation: ValidationLike;
}

/**
 * Whether a validation card should start expanded. Passing/skipped/cancelled
 * results collapse by default to keep the run summary scannable; outcomes that
 * need attention (warning / failed / errored) open automatically so their
 * findings are visible without a click.
 */
function shouldExpandByDefault(status: string): boolean {
    return (
        status === RunStatus.Warning || status === RunStatus.Failed || status === RunStatus.Errored
    );
}

export const ValidationCard: React.FC<ValidationCardProps> = ({ validation }) => {
    const classes = useStyles();
    const findings = validation.payload?.findings ?? [];
    const [expanded, setExpanded] = React.useState(shouldExpandByDefault(validation.status));

    return (
        <div className={classes.card}>
            <div
                className={classes.header}
                role="button"
                tabIndex={0}
                onClick={() => setExpanded((e) => !e)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpanded((prev) => !prev);
                    }
                }}>
                <span className={classes.chevron}>
                    {expanded ? (
                        <ChevronDownRegular fontSize={16} />
                    ) : (
                        <ChevronRightRegular fontSize={16} />
                    )}
                </span>
                <Text className={classes.title}>{validation.displayName}</Text>
                <StatusBadge status={validation.status as RunStatus} />
                <span className={classes.typeTag}>
                    {validationTypeLabel(validation.payload?.validationType)}
                </span>
                <span
                    style={{
                        marginLeft: "auto",
                        fontSize: "11px",
                        color: tokens.colorNeutralForeground3,
                    }}>
                    {formatDuration(validation.startedAtMs, validation.endedAtMs)}
                </span>
            </div>

            {expanded ? (
                <>
                    <SummaryRow validation={validation} />

                    {validation.errorMessage ? (
                        <div className={classes.error}>{validation.errorMessage}</div>
                    ) : null}

                    {findings.length === 0 ? (
                        <Text className={classes.empty}>
                            {noFindingsText(validation.payload?.validationType)}
                        </Text>
                    ) : (
                        <FindingsTable findings={findings} classes={classes} />
                    )}
                </>
            ) : null}
        </div>
    );
};

function formatDuration(startedAtMs: number, endedAtMs: number): string {
    const seconds = Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000));
    return locConstants.cloudDeployHub.durationSeconds(seconds);
}

function noFindingsText(validationType: string | undefined): string {
    const strings = locConstants.cloudDeployHub;
    switch (validationType) {
        case "connectivity":
            return strings.findingsNoneConnectivity;
        case "static-analysis":
            return strings.findingsNoneStaticAnalysis;
        case "unit-tests":
            return strings.findingsNoneUnitTests;
        case "workload-playback":
            return strings.findingsNoneWorkload;
        default:
            return strings.findingsNone;
    }
}

const SummaryRow: React.FC<{ validation: ValidationLike }> = ({ validation }) => {
    const classes = useStyles();
    const summary = validation.payload?.summary as Record<string, unknown> | undefined;
    const strings = locConstants.cloudDeployHub;
    if (!summary) {
        return null;
    }
    const chips: Array<{ label: string; value: string | number }> = [];
    switch (validation.payload?.validationType) {
        case "connectivity": {
            const reachable = Boolean((summary as { reachable?: boolean }).reachable);
            chips.push({ label: strings.summaryReachable, value: reachable ? "yes" : "no" });
            const sv = (summary as { serverVersion?: string }).serverVersion;
            if (sv) {
                chips.push({ label: strings.summaryServerVersion, value: sv });
            }
            break;
        }
        case "static-analysis": {
            const s = summary as { info?: number; warning?: number; error?: number };
            chips.push({ label: strings.summaryError, value: s.error ?? 0 });
            chips.push({ label: strings.summaryWarning, value: s.warning ?? 0 });
            chips.push({ label: strings.summaryInfo, value: s.info ?? 0 });
            break;
        }
        case "unit-tests": {
            const s = summary as {
                total?: number;
                passed?: number;
                failed?: number;
                skipped?: number;
                errored?: number;
            };
            chips.push({ label: strings.summaryPassed, value: s.passed ?? 0 });
            chips.push({ label: strings.summaryFailed, value: s.failed ?? 0 });
            chips.push({ label: strings.summarySkipped, value: s.skipped ?? 0 });
            if ((s.errored ?? 0) > 0) {
                chips.push({ label: strings.summaryErrored, value: s.errored ?? 0 });
            }
            chips.push({ label: strings.summaryTotal, value: s.total ?? 0 });
            break;
        }
        case "workload-playback": {
            const s = summary as { steps?: number; regressions?: number };
            chips.push({ label: strings.summarySteps, value: s.steps ?? 0 });
            chips.push({ label: strings.summaryRegressions, value: s.regressions ?? 0 });
            break;
        }
    }
    if (chips.length === 0) {
        return null;
    }
    return (
        <div className={classes.summaryRow}>
            {chips.map((c) => (
                <span key={c.label}>
                    <strong>{c.label}:</strong> {c.value}
                </span>
            ))}
        </div>
    );
};

type SeverityFilter = "all" | Severity;
type StaticSortKey = "severity" | "rule" | "location";

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function locationLabel(location: StaticAnalysisFindingShape["location"]): string {
    if (!location) {
        return "";
    }
    const line = location.line !== undefined ? `:${location.line}` : "";
    const column = location.column !== undefined ? `:${location.column}` : "";
    return `${location.file}${line}${column}`;
}

const MetricPill: React.FC<{
    label: string;
    value: number;
    color?: "danger" | "warning";
    classes: ReturnType<typeof useStyles>;
}> = ({ label, value, color, classes }) => {
    const valueColor =
        color === "danger"
            ? tokens.colorPaletteRedForeground1
            : color === "warning"
              ? tokens.colorPaletteYellowForeground1
              : tokens.colorNeutralForeground1;
    return (
        <div className={classes.metricPill}>
            <span className={classes.metricLabel}>{label}</span>
            <span className={classes.metricValue} style={{ color: valueColor }}>
                {value}
            </span>
        </div>
    );
};

/**
 * Static-analysis findings with metric pills (errors / warnings / info / total),
 * a severity filter, and a sort control. Findings can run long on a real build,
 * so the controls let the reader focus on what matters (e.g. errors first, or
 * grouped by rule / file) instead of scrolling a flat list.
 */
const StaticAnalysisFindings: React.FC<{
    findings: readonly StaticAnalysisFindingShape[];
    classes: ReturnType<typeof useStyles>;
}> = ({ findings, classes }) => {
    const strings = locConstants.cloudDeployHub;
    const [severityFilter, setSeverityFilter] = React.useState<SeverityFilter>("all");
    const [sortKey, setSortKey] = React.useState<StaticSortKey>("severity");

    const counts = React.useMemo(() => {
        let error = 0;
        let warning = 0;
        let info = 0;
        for (const f of findings) {
            if (f.severity === "error") {
                error++;
            } else if (f.severity === "warning") {
                warning++;
            } else {
                info++;
            }
        }
        return { error, warning, info, total: findings.length };
    }, [findings]);

    const visible = React.useMemo(() => {
        const filtered =
            severityFilter === "all"
                ? findings
                : findings.filter((f) => f.severity === severityFilter);
        return [...filtered].sort((a, b) => {
            if (sortKey === "severity") {
                return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
            }
            if (sortKey === "rule") {
                return a.ruleId.localeCompare(b.ruleId);
            }
            return locationLabel(a.location).localeCompare(locationLabel(b.location));
        });
    }, [findings, severityFilter, sortKey]);

    const filterButtons: Array<{ key: SeverityFilter; label: string; count: number }> = [
        { key: "all", label: strings.filterAll, count: counts.total },
        { key: "error", label: strings.filterErrors, count: counts.error },
        { key: "warning", label: strings.filterWarnings, count: counts.warning },
        { key: "info", label: strings.filterInfo, count: counts.info },
    ];

    const sortButtons: Array<{ key: StaticSortKey; label: string }> = [
        { key: "severity", label: strings.sortBySeverity },
        { key: "rule", label: strings.sortByRule },
        { key: "location", label: strings.sortByLocation },
    ];

    return (
        <div>
            <div className={classes.metricRow}>
                <MetricPill
                    label={strings.summaryError}
                    value={counts.error}
                    color={counts.error > 0 ? "danger" : undefined}
                    classes={classes}
                />
                <MetricPill
                    label={strings.summaryWarning}
                    value={counts.warning}
                    color={counts.warning > 0 ? "warning" : undefined}
                    classes={classes}
                />
                <MetricPill label={strings.summaryInfo} value={counts.info} classes={classes} />
                <MetricPill label={strings.summaryTotal} value={counts.total} classes={classes} />
            </div>

            <div className={classes.findingsToolbar}>
                <div className={classes.toolbarGroup}>
                    {filterButtons.map((b) => (
                        <Button
                            key={b.key}
                            size="small"
                            appearance={severityFilter === b.key ? "primary" : "subtle"}
                            onClick={() => setSeverityFilter(b.key)}>
                            {`${b.label} (${b.count})`}
                        </Button>
                    ))}
                </div>
                <div className={classes.toolbarGroup}>
                    <span className={classes.toolbarLabel}>{strings.sortLabel}:</span>
                    {sortButtons.map((b) => (
                        <Button
                            key={b.key}
                            size="small"
                            appearance={sortKey === b.key ? "primary" : "subtle"}
                            onClick={() => setSortKey(b.key)}>
                            {b.label}
                        </Button>
                    ))}
                </div>
            </div>

            {visible.length === 0 ? (
                <Text className={classes.empty}>{strings.findingsNoneForFilter}</Text>
            ) : (
                <table className={classes.findingsTable}>
                    <thead>
                        <tr>
                            <th className={classes.th}>{strings.colSeverity}</th>
                            <th className={classes.th}>{strings.colRule}</th>
                            <th className={classes.th}>{strings.colMessage}</th>
                            <th className={classes.th}>{strings.colLocation}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map((f, idx) => (
                            <tr key={idx}>
                                <td className={classes.td}>
                                    <Badge appearance="filled" color={SEVERITY_COLOR[f.severity]}>
                                        {f.severity}
                                    </Badge>
                                </td>
                                <td className={classes.td}>{f.ruleId}</td>
                                <td className={classes.td}>{f.message}</td>
                                <td className={classes.td}>
                                    {f.location ? (
                                        <span className={classes.location}>
                                            {locationLabel(f.location)}
                                        </span>
                                    ) : (
                                        "—"
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};

const FindingsTable: React.FC<{
    findings: readonly FindingShape[];
    classes: ReturnType<typeof useStyles>;
}> = ({ findings, classes }) => {
    const strings = locConstants.cloudDeployHub;
    const kind = findings[0]?.kind;
    if (kind === "connectivity") {
        return (
            <table className={classes.findingsTable}>
                <thead>
                    <tr>
                        <th className={classes.th}>{strings.colSeverity}</th>
                        <th className={classes.th}>{strings.colOutcome}</th>
                        <th className={classes.th}>{strings.colMessage}</th>
                    </tr>
                </thead>
                <tbody>
                    {(findings as readonly ConnectivityFindingShape[]).map((f, idx) => (
                        <tr key={idx}>
                            <td className={classes.td}>
                                <Badge appearance="filled" color={SEVERITY_COLOR[f.severity]}>
                                    {f.severity}
                                </Badge>
                            </td>
                            <td className={classes.td}>{f.outcome}</td>
                            <td className={classes.td}>{f.message}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    }
    if (kind === "static-analysis") {
        return (
            <StaticAnalysisFindings
                findings={findings as readonly StaticAnalysisFindingShape[]}
                classes={classes}
            />
        );
    }
    if (kind === "unit-tests") {
        return (
            <table className={classes.findingsTable}>
                <thead>
                    <tr>
                        <th className={classes.th}>{strings.colOutcome}</th>
                        <th className={classes.th}>{strings.colTestName}</th>
                        <th className={classes.th}>{strings.colMessage}</th>
                        <th className={classes.th}>{strings.colDuration}</th>
                    </tr>
                </thead>
                <tbody>
                    {(findings as readonly UnitTestFindingShape[]).map((f, idx) => (
                        <tr key={idx}>
                            <td className={classes.td}>
                                <Badge
                                    appearance="filled"
                                    color={
                                        f.outcome === "passed"
                                            ? "success"
                                            : f.outcome === "failed" || f.outcome === "errored"
                                              ? "danger"
                                              : "subtle"
                                    }>
                                    {f.outcome}
                                </Badge>
                            </td>
                            <td className={classes.td}>{f.testName}</td>
                            <td className={classes.td}>{f.message ?? "—"}</td>
                            <td className={classes.td}>
                                {f.durationMs !== undefined ? `${f.durationMs}ms` : "—"}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    }
    if (kind === "workload-playback") {
        return (
            <table className={classes.findingsTable}>
                <thead>
                    <tr>
                        <th className={classes.th}>{strings.colStep}</th>
                        <th className={classes.th}>{strings.colRegression}</th>
                        <th className={classes.th}>{strings.colDelta}</th>
                        <th className={classes.th}>{strings.colMessage}</th>
                    </tr>
                </thead>
                <tbody>
                    {(findings as readonly WorkloadFindingShape[]).map((f, idx) => (
                        <tr key={idx}>
                            <td className={classes.td}>{f.stepId}</td>
                            <td className={classes.td}>{f.regression}</td>
                            <td className={classes.td}>
                                {f.delta > 0 ? "+" : ""}
                                {f.delta}
                            </td>
                            <td className={classes.td}>{f.message}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    }
    return null;
};
