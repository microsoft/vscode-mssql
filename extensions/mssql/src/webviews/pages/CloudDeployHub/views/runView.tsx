/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Link, makeStyles, Tab, TabList, Text, tokens } from "@fluentui/react-components";
import { ArrowLeftRegular, DeleteRegular, FolderOpenRegular } from "@fluentui/react-icons";
import * as React from "react";
import { locConstants } from "../../../common/locConstants";
import { useCloudDeployHubContext } from "../cloudDeployHubStateProvider";
import { useCloudDeployHubSelector } from "../cloudDeployHubSelector";
import { StatusBadge } from "../components/statusBadge";
import { ValidationCard } from "../components/validationCard";
import { EventTimeline } from "../components/eventTimeline";
import { sourceKindLabel } from "../components/humanize";

const useStyles = makeStyles({
    backRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "12px",
    },
    headerRow: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        marginBottom: "16px",
    },
    runId: {
        fontFamily: "var(--vscode-editor-font-family), monospace",
        fontSize: "16px",
        fontWeight: 600,
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
    validationRow: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "6px 0",
        borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
        fontSize: "13px",
    },
    validationName: {
        flex: 1,
    },
    validationStatus: {
        color: tokens.colorNeutralForeground3,
        fontFamily: "var(--vscode-editor-font-family), monospace",
        fontSize: "12px",
    },
    empty: {
        color: tokens.colorNeutralForeground3,
        fontSize: "13px",
    },
    artifactPath: {
        fontFamily: "var(--vscode-editor-font-family), monospace",
        fontSize: "12px",
        wordBreak: "break-all",
    },
    loading: {
        padding: "24px",
        textAlign: "center",
        color: tokens.colorNeutralForeground3,
    },
    tabPanel: {
        marginTop: "12px",
    },
});

function formatDuration(startedAtMs: number, endedAtMs: number): string {
    const seconds = Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000));
    return locConstants.cloudDeployHub.durationSeconds(seconds);
}

/**
 * Detail text for a source of truth: the file path for sqlproj / dacpac
 * sources, the connection profile id for a live-database source, or the inner
 * source's detail for a shadow (decomposed) source. Reads fields defensively so
 * a future additive source kind without any of them renders cleanly (just the
 * kind label, no detail).
 */
function sourceOfTruthDetail(sourceOfTruth: {
    readonly path?: string;
    readonly connectionProfileId?: string;
    readonly source?: { readonly path?: string; readonly connectionProfileId?: string };
}): string {
    return (
        sourceOfTruth.path ??
        sourceOfTruth.connectionProfileId ??
        sourceOfTruth.source?.path ??
        sourceOfTruth.source?.connectionProfileId ??
        ""
    );
}

export const RunView: React.FC = () => {
    const classes = useStyles();
    const { navigate, revealArtifact, deleteRun } = useCloudDeployHubContext();
    const run = useCloudDeployHubSelector((s) => s.selectedRun);
    const artifactPath = useCloudDeployHubSelector((s) => s.selectedRunArtifactPath);
    const events = useCloudDeployHubSelector((s) => s.selectedRunEvents);
    const strings = locConstants.cloudDeployHub;
    const [selectedTab, setSelectedTab] = React.useState<"summary" | "logs">("summary");

    if (!run) {
        return (
            <div className={classes.loading}>
                <Text>{strings.runNotLoaded}</Text>
                <div style={{ marginTop: "12px" }}>
                    <Link onClick={() => navigate("runList")}>{strings.backToRuns}</Link>
                </div>
            </div>
        );
    }

    return (
        <div>
            <div className={classes.backRow}>
                <Button
                    appearance="subtle"
                    icon={<ArrowLeftRegular />}
                    size="small"
                    onClick={() => navigate("runList")}>
                    {strings.backToRuns}
                </Button>
                <Button
                    appearance="subtle"
                    icon={<DeleteRegular />}
                    size="small"
                    onClick={() => deleteRun(run.runId)}>
                    {strings.deleteRun}
                </Button>
            </div>
            <div className={classes.headerRow}>
                <Text className={classes.runId}>{run.runId.slice(0, 8)}</Text>
                <StatusBadge status={run.status} />
            </div>

            <div className={classes.metaGrid}>
                <span className={classes.metaLabel}>{strings.runIdLabel}</span>
                <span className={classes.artifactPath}>{run.runId}</span>
                <span className={classes.metaLabel}>{strings.environmentValidationsLabel}</span>
                <Link
                    onClick={() => navigate("environment", { envId: run.environmentSnapshot.id })}>
                    {run.environmentSnapshot.name}
                </Link>
                <span className={classes.metaLabel}>{strings.runStartedLabel}</span>
                <span>{new Date(run.startedAtMs).toLocaleString()}</span>
                <span className={classes.metaLabel}>{strings.runDurationLabel}</span>
                <span>{formatDuration(run.startedAtMs, run.endedAtMs)}</span>
                <span className={classes.metaLabel}>{strings.runRunnerLabel}</span>
                <span>
                    {run.runner.displayName} ({run.runner.hostKind})
                </span>
                <span className={classes.metaLabel}>{strings.runSourceOfTruthLabel}</span>
                <span className={classes.artifactPath}>
                    {sourceKindLabel(run.environmentSnapshot.sourceOfTruth.kind)}
                    {sourceOfTruthDetail(run.environmentSnapshot.sourceOfTruth)
                        ? ` · ${sourceOfTruthDetail(run.environmentSnapshot.sourceOfTruth)}`
                        : ""}
                </span>
                {run.sourceVersion ? (
                    <>
                        <span className={classes.metaLabel}>{strings.runSchemaVersionLabel}</span>
                        <span className={classes.artifactPath}>
                            {run.sourceVersion.commitId ?? run.sourceVersion.hash}
                        </span>
                    </>
                ) : null}
                {artifactPath ? (
                    <>
                        <span className={classes.metaLabel}>{strings.runArtifactLabel}</span>
                        <span>
                            <Button
                                appearance="subtle"
                                icon={<FolderOpenRegular />}
                                size="small"
                                onClick={() => revealArtifact(run.runId)}>
                                {strings.revealArtifact}
                            </Button>
                            <span className={classes.artifactPath} style={{ marginLeft: "8px" }}>
                                {artifactPath}
                            </span>
                        </span>
                    </>
                ) : null}
            </div>

            <TabList
                selectedValue={selectedTab}
                onTabSelect={(_e, data) => setSelectedTab(data.value as "summary" | "logs")}>
                <Tab value="summary">{strings.tabSummary}</Tab>
                <Tab value="logs">{strings.tabLogs}</Tab>
            </TabList>

            {selectedTab === "summary" ? (
                <div className={classes.tabPanel}>
                    <div className={classes.sectionHeading}>{strings.runValidationsLabel}</div>
                    {run.validations.length === 0 ? (
                        <Text className={classes.empty}>{strings.runNoValidations}</Text>
                    ) : (
                        <div>
                            {run.validations.map((v) => (
                                <ValidationCard key={v.validationId} validation={v} />
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className={classes.tabPanel}>
                    <div className={classes.sectionHeading}>{strings.timelineHeading}</div>
                    <EventTimeline events={events ?? []} />
                </div>
            )}
        </div>
    );
};
