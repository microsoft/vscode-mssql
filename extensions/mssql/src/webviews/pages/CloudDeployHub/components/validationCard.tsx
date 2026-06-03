/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, makeStyles, Text, tokens } from "@fluentui/react-components";
import * as React from "react";
import { RunStatus } from "../../../../cloudDeploy/runs/types";
import { locConstants } from "../../../common/locConstants";
import { StatusBadge } from "./statusBadge";

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

export const ValidationCard: React.FC<ValidationCardProps> = ({ validation }) => {
    const classes = useStyles();
    const findings = validation.payload?.findings ?? [];

    return (
        <div className={classes.card}>
            <div className={classes.header}>
                <Text className={classes.title}>{validation.displayName}</Text>
                <StatusBadge status={validation.status as RunStatus} />
                <span className={classes.typeTag}>{validation.payload?.validationType}</span>
                <span
                    style={{
                        marginLeft: "auto",
                        fontSize: "11px",
                        color: tokens.colorNeutralForeground3,
                    }}>
                    {formatDuration(validation.startedAtMs, validation.endedAtMs)}
                </span>
            </div>

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
                    {(findings as readonly StaticAnalysisFindingShape[]).map((f, idx) => (
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
                                        {f.location.file}
                                        {f.location.line !== undefined ? `:${f.location.line}` : ""}
                                        {f.location.column !== undefined
                                            ? `:${f.location.column}`
                                            : ""}
                                    </span>
                                ) : (
                                    "—"
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
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
