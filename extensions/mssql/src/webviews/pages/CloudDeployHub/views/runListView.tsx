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
import * as React from "react";
import { locConstants } from "../../../common/locConstants";
import { useCloudDeployHubContext } from "../cloudDeployHubStateProvider";
import { useCloudDeployHubSelector } from "../cloudDeployHubSelector";
import { StatusBadge } from "../components/statusBadge";

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
    table: {
        width: "100%",
        borderCollapse: "collapse",
    },
    th: {
        textAlign: "left",
        padding: "6px 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        fontSize: "11px",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: tokens.colorNeutralForeground3,
    },
    td: {
        padding: "8px 10px",
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
});
function formatDuration(startedAtMs: number, endedAtMs?: number): string {
    if (!endedAtMs || endedAtMs < startedAtMs) {
        return "—";
    }
    const seconds = Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000));
    return locConstants.cloudDeployHub.durationSeconds(seconds);
}

function formatStarted(ms: number): string {
    return new Date(ms).toLocaleString();
}

export const RunListView: React.FC = () => {
    const classes = useStyles();
    const { navigate, compareRuns } = useCloudDeployHubContext();
    const runs = useCloudDeployHubSelector((s) => s.runs);
    const liveRuns = useCloudDeployHubSelector((s) => s.liveRuns);
    const strings = locConstants.cloudDeployHub;
    const [selectedForCompare, setSelectedForCompare] = React.useState<readonly string[]>([]);

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

    const onCompare = (): void => {
        if (selectedForCompare.length === 2) {
            compareRuns(selectedForCompare[0], selectedForCompare[1]);
        }
    };

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
                            {formatStarted(live.startedAtMs)}
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
            <table className={classes.table}>
                <thead>
                    <tr>
                        <th className={classes.th}></th>
                        <th className={classes.th}>{strings.columnRunId}</th>
                        <th className={classes.th}>{strings.columnEnvironment}</th>
                        <th className={classes.th}>{strings.columnStatus}</th>
                        <th className={classes.th}>{strings.columnStarted}</th>
                        <th className={classes.th}>{strings.columnDuration}</th>
                    </tr>
                </thead>
                <tbody>
                    {runs.map((run) => {
                        const checked = selectedForCompare.includes(run.runId);
                        return (
                            <tr key={run.runId}>
                                <td className={classes.td}>
                                    <Checkbox
                                        checked={checked}
                                        disabled={!checked && selectedForCompare.length >= 2}
                                        onChange={(_e, data) =>
                                            toggleCompare(run.runId, data.checked === true)
                                        }
                                    />
                                </td>
                                <td className={`${classes.td} ${classes.runIdCell}`}>
                                    <Link onClick={() => navigate("run", { runId: run.runId })}>
                                        {run.runId.slice(0, 8)}
                                    </Link>
                                </td>
                                <td className={classes.td}>
                                    <Link
                                        onClick={() =>
                                            navigate("environment", { envId: run.envId })
                                        }>
                                        {run.envDisplayName}
                                    </Link>
                                </td>
                                <td className={classes.td}>
                                    <StatusBadge status={run.status} />
                                </td>
                                <td className={classes.td}>{formatStarted(run.startedAtMs)}</td>
                                <td className={classes.td}>
                                    {formatDuration(run.startedAtMs, run.endedAtMs)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};
