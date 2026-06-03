/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Link, makeStyles, Text, tokens } from "@fluentui/react-components";
import { ArrowLeftRegular, StarFilled, StarRegular } from "@fluentui/react-icons";
import * as React from "react";
import { RunStatus } from "../../../../cloudDeploy/runs/types";
import { locConstants } from "../../../common/locConstants";
import { useCloudDeployHubContext } from "../cloudDeployHubStateProvider";
import { useCloudDeployHubSelector } from "../cloudDeployHubSelector";
import { StatusBadge } from "../components/statusBadge";

const useStyles = makeStyles({
    backRow: {
        marginBottom: "12px",
    },
    heading: {
        display: "block",
        fontSize: "18px",
        fontWeight: 600,
        marginBottom: "4px",
    },
    titleRow: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        marginBottom: "4px",
    },
    statRow: {
        display: "flex",
        gap: "12px",
        marginBottom: "20px",
        flexWrap: "wrap",
    },
    statCard: {
        flex: "1 1 140px",
        minWidth: "140px",
        padding: "10px 12px",
        borderRadius: "4px",
        backgroundColor: tokens.colorNeutralBackground2,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    statLabel: {
        display: "block",
        fontSize: "11px",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: tokens.colorNeutralForeground3,
        marginBottom: "6px",
    },
    statValue: {
        display: "block",
        fontSize: "16px",
        fontWeight: 600,
    },
    description: {
        display: "block",
        color: tokens.colorNeutralForeground3,
        marginBottom: "16px",
    },
    metaGrid: {
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        columnGap: "16px",
        rowGap: "6px",
        marginBottom: "20px",
        fontSize: "13px",
    },
    metaLabel: {
        color: tokens.colorNeutralForeground3,
    },
    sectionHeading: {
        fontSize: "13px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: tokens.colorNeutralForeground3,
        marginTop: "20px",
        marginBottom: "8px",
    },
    list: {
        margin: 0,
        paddingLeft: "18px",
        fontSize: "13px",
    },
    runRow: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "6px 0",
        borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
        fontSize: "13px",
    },
    runId: {
        fontFamily: "var(--vscode-editor-font-family), monospace",
    },
    empty: {
        color: tokens.colorNeutralForeground3,
        fontSize: "13px",
    },
    notFound: {
        padding: "24px",
        textAlign: "center",
        color: tokens.colorNeutralForeground3,
    },
});

export const EnvironmentView: React.FC = () => {
    const classes = useStyles();
    const { navigate, setDefaultEnvironment } = useCloudDeployHubContext();
    const env = useCloudDeployHubSelector((s) => s.selectedEnvironment);
    const selectedEnvId = useCloudDeployHubSelector((s) => s.selectedEnvId);
    const allRuns = useCloudDeployHubSelector((s) => s.runs);
    const liveRuns = useCloudDeployHubSelector((s) => s.liveRuns);
    const defaultEnvId = useCloudDeployHubSelector((s) => s.defaultEnvId);
    const strings = locConstants.cloudDeployHub;

    if (!env) {
        return (
            <div className={classes.notFound}>
                <Text>{strings.environmentNotFound(selectedEnvId ?? "")}</Text>
                <div style={{ marginTop: "12px" }}>
                    <Link onClick={() => navigate("runList")}>{strings.backToList}</Link>
                </div>
            </div>
        );
    }

    const envRuns = allRuns.filter((r) => r.envId === env.id);
    const isDefault = defaultEnvId === env.id;
    const pendingCount = liveRuns.filter((r) => r.environmentId === env.id).length;
    const latestStatus = envRuns.length > 0 ? envRuns[0].status : undefined;
    const passedCount = envRuns.filter((r) => r.status === RunStatus.Passed).length;
    const passRate =
        envRuns.length > 0 ? Math.round((passedCount / envRuns.length) * 100) : undefined;

    return (
        <div>
            <div className={classes.backRow}>
                <Button
                    appearance="subtle"
                    icon={<ArrowLeftRegular />}
                    size="small"
                    onClick={() => navigate("runList")}>
                    {strings.backToList}
                </Button>
            </div>
            <div className={classes.titleRow}>
                <Text as="h2" className={classes.heading}>
                    {env.name}
                </Text>
                {isDefault ? (
                    <Badge appearance="filled" color="brand" icon={<StarFilled />}>
                        {strings.defaultBadge}
                    </Badge>
                ) : null}
                <Button
                    appearance="subtle"
                    size="small"
                    icon={isDefault ? <StarFilled /> : <StarRegular />}
                    onClick={() => setDefaultEnvironment(isDefault ? undefined : env.id)}>
                    {isDefault ? strings.clearDefault : strings.setAsDefault}
                </Button>
            </div>
            {env.description ? (
                <Text className={classes.description}>{env.description}</Text>
            ) : null}

            <div className={classes.statRow}>
                <div className={classes.statCard}>
                    <span className={classes.statLabel}>{strings.statCardCurrent}</span>
                    <span className={classes.statValue}>
                        {latestStatus !== undefined ? (
                            <StatusBadge status={latestStatus} />
                        ) : (
                            strings.statCardNoRuns
                        )}
                    </span>
                </div>
                <div className={classes.statCard}>
                    <span className={classes.statLabel}>{strings.statCardPending}</span>
                    <span className={classes.statValue}>
                        {strings.statCardPendingCount(pendingCount)}
                    </span>
                </div>
                <div className={classes.statCard}>
                    <span className={classes.statLabel}>{strings.statCardHealth}</span>
                    <span className={classes.statValue}>
                        {passRate !== undefined
                            ? strings.statCardHealthValue(passRate, envRuns.length)
                            : strings.statCardNoRuns}
                    </span>
                </div>
            </div>

            <div className={classes.metaGrid}>
                <span className={classes.metaLabel}>{strings.environmentSourceLabel}</span>
                <span>{env.sourceOfTruth.kind}</span>
            </div>

            <div className={classes.sectionHeading}>{strings.environmentValidationsLabel}</div>
            {env.validations.length === 0 ? (
                <Text className={classes.empty}>{strings.environmentNoValidations}</Text>
            ) : (
                <ul className={classes.list}>
                    {env.validations.map((v, idx) => (
                        <li key={`${v.type}-${idx}`}>
                            {v.type}
                            {v.enabled ? "" : " (disabled)"}
                        </li>
                    ))}
                </ul>
            )}

            <div className={classes.sectionHeading}>{strings.environmentRecentRunsLabel}</div>
            {envRuns.length === 0 ? (
                <Text className={classes.empty}>{strings.environmentNoRuns}</Text>
            ) : (
                <div>
                    {envRuns.map((run) => (
                        <div key={run.runId} className={classes.runRow}>
                            <Link
                                className={classes.runId}
                                onClick={() => navigate("run", { runId: run.runId })}>
                                {run.runId.slice(0, 8)}
                            </Link>
                            <StatusBadge status={run.status} />
                            <span style={{ color: tokens.colorNeutralForeground3 }}>
                                {new Date(run.startedAtMs).toLocaleString()}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
