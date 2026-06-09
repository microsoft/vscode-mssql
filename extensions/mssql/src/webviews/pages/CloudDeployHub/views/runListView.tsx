/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Link,
    makeStyles,
    Spinner,
    Text,
    tokens,
} from "@fluentui/react-components";
import { ChevronDownRegular, ChevronRightRegular } from "@fluentui/react-icons";
import * as React from "react";
import { RunStatus } from "../../../../cloudDeploy/runs/types";
import { locConstants } from "../../../common/locConstants";
import { useCloudDeployHubContext } from "../cloudDeployHubStateProvider";
import { useCloudDeployHubSelector } from "../cloudDeployHubSelector";
import { StatusBadge } from "../components/statusBadge";
import { StatusSparkline } from "../components/statusSparkline";
import { formatDurationSeconds, formatStartedShort } from "./formatUtils";

const useStyles = makeStyles({
    heading: {
        fontSize: "16px",
        fontWeight: 600,
        marginBottom: "12px",
    },
    liveSection: {
        marginBottom: "16px",
        padding: "10px 12px",
        borderRadius: "4px",
        backgroundColor: tokens.colorNeutralBackground2,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    liveHeading: {
        display: "block",
        fontSize: "11px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: tokens.colorNeutralForeground3,
        marginBottom: "6px",
    },
    liveRow: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "4px 0",
        fontSize: "13px",
    },
    group: {
        marginBottom: "12px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "4px",
        overflow: "hidden",
    },
    groupHeader: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 10px",
        backgroundColor: tokens.colorNeutralBackground2,
        cursor: "pointer",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    groupChevron: {
        display: "flex",
        alignItems: "center",
        color: tokens.colorNeutralForeground3,
        flexShrink: 0,
    },
    groupName: {
        fontSize: "13px",
        fontWeight: 600,
        flex: "1 1 auto",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    groupMeta: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        flexShrink: 0,
    },
    trendLabel: {
        fontSize: "10px",
        color: tokens.colorNeutralForeground3,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
    },
    runCount: {
        fontSize: "11px",
        color: tokens.colorNeutralForeground3,
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
    },
    th: {
        textAlign: "left",
        padding: "5px 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        fontSize: "10px",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: tokens.colorNeutralForeground3,
    },
    td: {
        padding: "6px 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
        fontSize: "13px",
        verticalAlign: "middle",
    },
    runIdCell: {
        fontFamily: "var(--vscode-editor-font-family), monospace",
    },
    empty: {
        padding: "24px",
        textAlign: "center",
        color: tokens.colorNeutralForeground3,
    },
    headingRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "12px",
        gap: "12px",
    },
    compareHint: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
    },
    showMoreRow: {
        padding: "6px 12px",
        borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
        fontSize: "12px",
    },
});

interface RunEntry {
    readonly runId: string;
    readonly envId: string;
    readonly envDisplayName: string;
    readonly status: RunStatus;
    readonly startedAtMs: number;
    readonly endedAtMs?: number;
}

interface RunGroup {
    readonly envId: string;
    readonly envDisplayName: string;
    readonly runs: readonly RunEntry[];
}

/**
 * The number of runs shown per environment group before a "Show more" toggle.
 * Keeps every group consistently short on first paint; the toggle reveals the
 * rest for that one environment.
 */
const RUNS_PER_GROUP = 5;

/**
 * Buckets runs by environment, newest-first within each group, and orders the
 * groups so the default environment leads, then by most-recent activity.
 */
function groupRunsByEnvironment(
    runs: readonly RunEntry[],
    defaultEnvId: string | undefined,
): readonly RunGroup[] {
    const byEnv = new Map<string, RunEntry[]>();
    for (const run of runs) {
        const bucket = byEnv.get(run.envId);
        if (bucket) {
            bucket.push(run);
        } else {
            byEnv.set(run.envId, [run]);
        }
    }
    const groups: RunGroup[] = [];
    for (const [envId, envRuns] of byEnv) {
        groups.push({ envId, envDisplayName: envRuns[0].envDisplayName, runs: envRuns });
    }
    groups.sort((a, b) => {
        if (a.envId === defaultEnvId) {
            return b.envId === defaultEnvId ? 0 : -1;
        }
        if (b.envId === defaultEnvId) {
            return 1;
        }
        return b.runs[0].startedAtMs - a.runs[0].startedAtMs;
    });
    return groups;
}

export const RunListView: React.FC = () => {
    const classes = useStyles();
    const { navigate, compareRuns } = useCloudDeployHubContext();
    const runs = useCloudDeployHubSelector((s) => s.runs) as readonly RunEntry[];
    const liveRuns = useCloudDeployHubSelector((s) => s.liveRuns);
    const defaultEnvId = useCloudDeployHubSelector((s) => s.defaultEnvId);
    const strings = locConstants.cloudDeployHub;
    const [selectedForCompare, setSelectedForCompare] = React.useState<readonly string[]>([]);
    const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
    const [expandedGroups, setExpandedGroups] = React.useState<ReadonlySet<string>>(new Set());

    // Drop selections that no longer exist (e.g. a run was deleted) so the
    // compare action never sends a stale run id.
    React.useEffect(() => {
        setSelectedForCompare((prev) => prev.filter((id) => runs.some((r) => r.runId === id)));
    }, [runs]);

    const toggleCompare = (runId: string, checked: boolean): void => {
        setSelectedForCompare((prev) => {
            if (checked) {
                if (prev.includes(runId)) {
                    return prev;
                }
                // Keep at most two; dropping the oldest keeps the most recent picks.
                return [...prev, runId].slice(-2);
            }
            return prev.filter((id) => id !== runId);
        });
    };

    const toggleGroup = (envId: string): void => {
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(envId)) {
                next.delete(envId);
            } else {
                next.add(envId);
            }
            return next;
        });
    };

    const toggleShowMore = (envId: string): void => {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(envId)) {
                next.delete(envId);
            } else {
                next.add(envId);
            }
            return next;
        });
    };

    const onCompare = (): void => {
        if (selectedForCompare.length === 2) {
            compareRuns(selectedForCompare[0], selectedForCompare[1]);
        }
    };

    const groups = groupRunsByEnvironment(runs, defaultEnvId);

    const liveBanner =
        liveRuns.length > 0 ? (
            <div className={classes.liveSection}>
                <span className={classes.liveHeading}>{strings.liveRunsHeading}</span>
                {liveRuns.map((live) => (
                    <div key={live.runId} className={classes.liveRow}>
                        <Spinner size="tiny" />
                        <span>
                            {strings.liveRunRow(live.environmentName ?? live.environmentId)}
                        </span>
                        <span style={{ color: tokens.colorNeutralForeground3 }}>
                            {formatStartedShort(live.startedAtMs)}
                        </span>
                    </div>
                ))}
            </div>
        ) : null;

    if (runs.length === 0) {
        return (
            <div>
                {liveBanner}
                <div className={classes.empty}>
                    <Text>{strings.runListEmpty}</Text>
                </div>
            </div>
        );
    }

    return (
        <div>
            {liveBanner}
            <div className={classes.headingRow}>
                <Text as="h2" className={classes.heading}>
                    {strings.runListHeading}
                </Text>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span className={classes.compareHint}>{strings.compareSelectHint}</span>
                    <Button
                        size="small"
                        appearance="primary"
                        disabled={selectedForCompare.length !== 2}
                        onClick={onCompare}>
                        {strings.compareSelectedCount(selectedForCompare.length)}
                    </Button>
                </div>
            </div>

            {groups.map((group) => {
                const isCollapsed = collapsed.has(group.envId);
                const isExpanded = expandedGroups.has(group.envId);
                // Sparkline reads oldest-to-newest; runs are newest-first.
                const trend = group.runs.map((r) => r.status).reverse();
                const latestStatus = group.runs[0].status;
                const hasMore = group.runs.length > RUNS_PER_GROUP;
                const visibleRuns =
                    hasMore && !isExpanded ? group.runs.slice(0, RUNS_PER_GROUP) : group.runs;
                const hiddenCount = group.runs.length - visibleRuns.length;
                return (
                    <div key={group.envId} className={classes.group}>
                        <div
                            className={classes.groupHeader}
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleGroup(group.envId)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggleGroup(group.envId);
                                }
                            }}>
                            <span className={classes.groupChevron}>
                                {isCollapsed ? (
                                    <ChevronRightRegular fontSize={16} />
                                ) : (
                                    <ChevronDownRegular fontSize={16} />
                                )}
                            </span>
                            <Link
                                className={classes.groupName}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    navigate("environment", { envId: group.envId });
                                }}>
                                {group.envDisplayName}
                            </Link>
                            <div className={classes.groupMeta}>
                                <span className={classes.runCount}>
                                    {strings.runCountLabel(group.runs.length)}
                                </span>
                                <span className={classes.trendLabel}>
                                    {strings.recentTrendLabel}
                                </span>
                                <StatusSparkline statuses={trend} />
                                <StatusBadge status={latestStatus} />
                            </div>
                        </div>

                        {isCollapsed ? null : (
                            <table className={classes.table}>
                                <thead>
                                    <tr>
                                        <th className={classes.th}></th>
                                        <th className={classes.th}>{strings.columnRunId}</th>
                                        <th className={classes.th}>{strings.columnStatus}</th>
                                        <th className={classes.th}>{strings.columnStarted}</th>
                                        <th className={classes.th}>{strings.columnDuration}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleRuns.map((run) => {
                                        const checked = selectedForCompare.includes(run.runId);
                                        return (
                                            <tr key={run.runId}>
                                                <td className={classes.td}>
                                                    <Checkbox
                                                        checked={checked}
                                                        disabled={
                                                            !checked &&
                                                            selectedForCompare.length >= 2
                                                        }
                                                        onChange={(_e, data) =>
                                                            toggleCompare(
                                                                run.runId,
                                                                data.checked === true,
                                                            )
                                                        }
                                                    />
                                                </td>
                                                <td
                                                    className={`${classes.td} ${classes.runIdCell}`}>
                                                    <Link
                                                        onClick={() =>
                                                            navigate("run", { runId: run.runId })
                                                        }>
                                                        {run.runId.slice(0, 8)}
                                                    </Link>
                                                </td>
                                                <td className={classes.td}>
                                                    <StatusBadge status={run.status} />
                                                </td>
                                                <td className={classes.td}>
                                                    {formatStartedShort(run.startedAtMs)}
                                                </td>
                                                <td className={classes.td}>
                                                    {formatDurationSeconds(
                                                        run.startedAtMs,
                                                        run.endedAtMs,
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}

                        {!isCollapsed && hasMore ? (
                            <div className={classes.showMoreRow}>
                                <Link onClick={() => toggleShowMore(group.envId)}>
                                    {isExpanded
                                        ? strings.showFewerRuns
                                        : strings.showMoreRuns(hiddenCount)}
                                </Link>
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
};
