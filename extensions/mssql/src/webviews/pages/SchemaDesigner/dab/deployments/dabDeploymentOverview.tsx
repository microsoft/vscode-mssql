/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Link,
    makeStyles,
    mergeClasses,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    Spinner,
    Text,
    tokens,
    Tooltip,
} from "@fluentui/react-components";
import { ArrowSync16Regular, Delete16Regular, Stop16Regular } from "@fluentui/react-icons";
import { DiffOnMount } from "@monaco-editor/react";
// Monaco's JSON support needs a web worker; the JavaScript tokenizer colors a
// config file just as well and runs without one.
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { locConstants } from "../../../../common/locConstants";
import { VscodeDiffEditor } from "../../../../common/vscodeMonaco";
import { useVscodeWebview } from "../../../../common/vscodeWebviewProvider";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { SchemaDesigner } from "../../../../../sharedInterfaces/schemaDesigner";
import { useDabContext } from "../dabContext";
import { DabDeploymentEndpoints } from "./dabDeploymentEndpoints";
import { DabDialogContent } from "./dabDialogLayout";

const useStyles = makeStyles({
    header: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
    },
    titleRow: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        flexWrap: "wrap",
    },
    title: {
        fontSize: tokens.fontSizeBase500,
        lineHeight: tokens.lineHeightBase500,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
        overflowWrap: "anywhere",
    },
    meta: {
        color: tokens.colorNeutralForeground3,
    },
    pill: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "2px 10px",
        borderRadius: tokens.borderRadiusCircular,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        fontWeight: tokens.fontWeightSemibold,
        "::before": {
            content: '""',
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: "currentColor",
        },
    },
    pillRunning: {
        color: tokens.colorPaletteGreenForeground1,
        backgroundColor: tokens.colorPaletteGreenBackground1,
    },
    pillStopped: {
        color: tokens.colorPaletteRedForeground1,
        backgroundColor: tokens.colorPaletteRedBackground1,
    },
    pillUnknown: {
        color: tokens.colorNeutralForeground2,
        backgroundColor: tokens.colorNeutralBackground3,
    },
    content: {
        gap: "16px",
        overflowY: "auto",
    },
    footerSpacer: {
        flex: 1,
    },
    actionError: {
        color: tokens.colorStatusDangerForeground1,
        fontSize: tokens.fontSizeBase200,
    },
    // Changes view
    fileRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
    },
    fileName: {
        fontFamily: "var(--vscode-editor-font-family)",
        fontWeight: tokens.fontWeightSemibold,
    },
    summary: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    additions: {
        color: tokens.colorPaletteGreenForeground1,
        fontWeight: tokens.fontWeightSemibold,
    },
    deletions: {
        color: tokens.colorPaletteRedForeground1,
        fontWeight: tokens.fontWeightSemibold,
    },
    diff: {
        flex: 1,
        minHeight: "240px",
        borderRadius: tokens.borderRadiusXLarge,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        overflow: "hidden",
    },
    centered: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        color: tokens.colorNeutralForeground3,
    },
});

/** Largest whole unit that fits, so ages read the way people say them. */
const RELATIVE_TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 60 * 60],
    ["month", 30 * 24 * 60 * 60],
    ["week", 7 * 24 * 60 * 60],
    ["day", 24 * 60 * 60],
    ["hour", 60 * 60],
    ["minute", 60],
];

/** How long ago a deployment happened, in the viewer's locale. */
function formatTimeAgo(isoTimestamp: string): string {
    const elapsedSeconds = (Date.now() - new Date(isoTimestamp).getTime()) / 1000;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 60) {
        return locConstants.schemaDesigner.justNow;
    }

    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    for (const [unit, unitSeconds] of RELATIVE_TIME_UNITS) {
        if (elapsedSeconds >= unitSeconds) {
            return formatter.format(-Math.floor(elapsedSeconds / unitSeconds), unit);
        }
    }

    return locConstants.schemaDesigner.justNow;
}

interface DabDeploymentOverviewProps {
    deployment: Dab.DabDeploymentListItem;
    /** Opens on the configuration changes instead of the deployment itself. */
    initialShowChanges?: boolean;
    /** Redeploys with the current config: applies changes, or restarts a stopped deployment. */
    onRedeploy: () => void;
    /** Stops the running container or engine, leaving the deployment in place. */
    onStop: () => Promise<Dab.DeploymentActionResponse>;
    /** Stops the deployment and removes it. */
    onDelete: () => Promise<Dab.DeploymentActionResponse>;
    onClose: () => void;
}

/**
 * The database's one deployment. Every way back to a running, current
 * deployment is a redeploy with the latest config, so the view offers a single
 * action: Apply changes when the config has moved on, Restart when the
 * deployment is not running. The changes can be reviewed as a diff first.
 */
export const DabDeploymentOverview = ({
    deployment,
    initialShowChanges = false,
    onRedeploy,
    onStop,
    onDelete,
    onClose,
}: DabDeploymentOverviewProps) => {
    const classes = useStyles();
    const [isShowingChanges, setIsShowingChanges] = useState(
        initialShowChanges && deployment.hasConfigSnapshot,
    );
    const [isBusy, setIsBusy] = useState(false);
    const [actionError, setActionError] = useState<string | undefined>();
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

    const runAction = async (action: () => Promise<Dab.DeploymentActionResponse>) => {
        setIsBusy(true);
        setActionError(undefined);
        try {
            const result = await action();
            if (!result.success) {
                setActionError(result.error);
            }
        } finally {
            setIsBusy(false);
        }
    };

    const isCli = deployment.target === Dab.DabDeploymentTarget.DabCli;
    const isRunning = deployment.status === Dab.DabDeploymentContainerStatus.Running;
    const isMissing = deployment.status === Dab.DabDeploymentContainerStatus.Missing;

    const renderPill = () => {
        switch (deployment.status) {
            case Dab.DabDeploymentContainerStatus.Running:
                return (
                    <span className={mergeClasses(classes.pill, classes.pillRunning)}>
                        {locConstants.schemaDesigner.deploymentStatusRunning}
                    </span>
                );
            case Dab.DabDeploymentContainerStatus.Stopped:
                return (
                    <span className={mergeClasses(classes.pill, classes.pillStopped)}>
                        {locConstants.schemaDesigner.deploymentStatusStopped}
                    </span>
                );
            case Dab.DabDeploymentContainerStatus.Missing:
                return (
                    <span className={mergeClasses(classes.pill, classes.pillStopped)}>
                        {locConstants.schemaDesigner.deploymentStatusPillMissing}
                    </span>
                );
            default:
                return (
                    <span className={mergeClasses(classes.pill, classes.pillUnknown)}>
                        {locConstants.schemaDesigner.deploymentStatusUnknown}
                    </span>
                );
        }
    };

    const header = (
        <div className={classes.header}>
            <div className={classes.titleRow}>
                <DialogTitle className={classes.title}>{deployment.name}</DialogTitle>
                {renderPill()}
            </div>
            <Tooltip
                content={locConstants.schemaDesigner.deployedAt(
                    new Date(deployment.deployedUtc).toLocaleString(),
                )}
                relationship="description">
                <Text className={classes.meta}>
                    {locConstants.schemaDesigner.deploymentMeta(
                        isCli
                            ? locConstants.schemaDesigner.deploymentTargetShortCli
                            : locConstants.schemaDesigner.deploymentTargetShortDocker,
                        deployment.port,
                        locConstants.schemaDesigner.deployedOn(
                            formatTimeAgo(deployment.deployedUtc),
                        ),
                    )}
                </Text>
            </Tooltip>
        </div>
    );

    if (isShowingChanges) {
        return (
            <DabDeploymentChanges
                header={header}
                deploymentId={deployment.id}
                onBack={() => setIsShowingChanges(false)}
                onApply={() => {
                    // The run takes over the dialog, and when it finishes the
                    // deployment view should show the deployment, not the diff.
                    setIsShowingChanges(false);
                    onRedeploy();
                }}
            />
        );
    }

    const viewChangesLink = deployment.isConfigOutdated && deployment.hasConfigSnapshot && (
        <Link onClick={() => setIsShowingChanges(true)}>
            {locConstants.schemaDesigner.viewChanges}
        </Link>
    );

    const renderBanner = () => {
        if (isRunning && !deployment.isConfigOutdated) {
            return undefined;
        }

        return (
            <MessageBar intent={isRunning ? "warning" : "error"}>
                <MessageBarBody>
                    {isRunning
                        ? locConstants.schemaDesigner.deploymentConfigChangedBanner
                        : isMissing
                          ? locConstants.schemaDesigner.deploymentMissingBanner
                          : locConstants.schemaDesigner.deploymentNotRunningBanner}
                </MessageBarBody>
                <MessageBarActions>
                    {viewChangesLink}
                    <Button appearance="primary" size="small" onClick={onRedeploy}>
                        {isRunning
                            ? locConstants.schemaDesigner.applyDeploymentChanges
                            : locConstants.schemaDesigner.restartDeployment}
                    </Button>
                </MessageBarActions>
            </MessageBar>
        );
    };

    return (
        <>
            {header}
            <DabDialogContent className={classes.content}>
                {renderBanner()}
                {!isMissing && (
                    <DabDeploymentEndpoints
                        apiUrl={deployment.apiUrl}
                        apiTypes={deployment.apiTypes}
                        isDisabled={!isRunning}
                    />
                )}
                {actionError && <Text className={classes.actionError}>{actionError}</Text>}
            </DabDialogContent>

            <Dialog
                open={isConfirmingDelete}
                modalType="alert"
                onOpenChange={(_, data) => {
                    if (!data.open) {
                        setIsConfirmingDelete(false);
                    }
                }}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {locConstants.schemaDesigner.deleteDeploymentConfirmTitle}
                        </DialogTitle>
                        <DialogContent>
                            {isCli
                                ? locConstants.schemaDesigner.deleteCliDeploymentConfirmMessage(
                                      deployment.name,
                                  )
                                : locConstants.schemaDesigner.deleteDeploymentConfirmMessage(
                                      deployment.name,
                                  )}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                onClick={() => setIsConfirmingDelete(false)}>
                                {locConstants.common.cancel}
                            </Button>
                            <Button
                                appearance="primary"
                                icon={<Delete16Regular />}
                                onClick={() => {
                                    setIsConfirmingDelete(false);
                                    void runAction(onDelete);
                                }}>
                                {locConstants.schemaDesigner.deleteDeployment}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            <DialogActions fluid>
                {isRunning && (
                    <Button
                        appearance="secondary"
                        icon={<Stop16Regular />}
                        disabled={isBusy}
                        onClick={() => void runAction(onStop)}>
                        {locConstants.schemaDesigner.stopDeployment}
                    </Button>
                )}
                <Button
                    appearance="secondary"
                    icon={<Delete16Regular />}
                    disabled={isBusy}
                    onClick={() => setIsConfirmingDelete(true)}>
                    {locConstants.schemaDesigner.deleteDeployment}
                </Button>
                {isBusy && <Spinner size="tiny" />}
                <div className={classes.footerSpacer} />
                <Button appearance="secondary" onClick={onClose}>
                    {locConstants.common.close}
                </Button>
            </DialogActions>
        </>
    );
};

interface DabDeploymentChangesProps {
    header: ReactNode;
    deploymentId: string;
    onBack: () => void;
    onApply: () => void;
}

/** What applying the changes would change, as a diff of the two config files. */
const DabDeploymentChanges = ({
    header,
    deploymentId,
    onBack,
    onApply,
}: DabDeploymentChangesProps) => {
    const classes = useStyles();
    const { getDabDeploymentChanges } = useDabContext();
    const [changes, setChanges] = useState<Dab.GetDeploymentChangesResponse | undefined>();

    useEffect(() => {
        let isCurrent = true;
        void getDabDeploymentChanges(deploymentId).then((response) => {
            if (isCurrent) {
                setChanges(response);
            }
        });
        return () => {
            isCurrent = false;
        };
    }, [deploymentId, getDabDeploymentChanges]);

    const { themeKind } = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();
    const [counts, setCounts] = useState<{ additions: number; deletions: number }>();

    // Monaco computes the diff off the main thread; the counts follow it.
    const handleMount = useCallback<DiffOnMount>((editor) => {
        const updateCounts = () => {
            let additions = 0;
            let deletions = 0;
            for (const change of editor.getLineChanges() ?? []) {
                if (change.modifiedEndLineNumber > 0) {
                    additions += change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
                }
                if (change.originalEndLineNumber > 0) {
                    deletions += change.originalEndLineNumber - change.originalStartLineNumber + 1;
                }
            }
            setCounts({ additions, deletions });
        };
        editor.onDidUpdateDiff(updateCounts);
    }, []);

    const renderDiff = () => {
        if (!changes) {
            return (
                <div className={classes.centered}>
                    <Spinner size="small" label={locConstants.schemaDesigner.loadingChanges} />
                </div>
            );
        }
        if (
            changes.deployedConfig === undefined ||
            changes.deployedConfig === changes.currentConfig
        ) {
            return (
                <div className={classes.centered}>
                    <Text>{locConstants.schemaDesigner.noConfigChanges}</Text>
                </div>
            );
        }

        return (
            <div className={classes.diff}>
                <VscodeDiffEditor
                    height="100%"
                    language="javascript"
                    original={changes.deployedConfig}
                    modified={changes.currentConfig}
                    themeKind={themeKind}
                    onMount={handleMount}
                    options={{
                        readOnly: true,
                        originalEditable: false,
                        // One column with removed lines above added ones, like a
                        // unified diff, which suits the dialog's width better
                        // than two half-width columns.
                        renderSideBySide: false,
                        hideUnchangedRegions: {
                            enabled: true,
                            contextLineCount: 3,
                            minimumLineCount: 3,
                            revealLineCount: 20,
                        },
                        renderOverviewRuler: false,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                    }}
                />
            </div>
        );
    };

    return (
        <>
            {header}
            <DabDialogContent className={classes.content}>
                <div className={classes.fileRow}>
                    <Text className={classes.fileName}>dab-config.json</Text>
                    {counts && (
                        <Text className={classes.summary}>
                            {locConstants.schemaDesigner.deployedToCurrent} ·{" "}
                            <span className={classes.additions}>+{counts.additions}</span>{" "}
                            <span className={classes.deletions}>−{counts.deletions}</span>
                        </Text>
                    )}
                </div>
                {renderDiff()}
            </DabDialogContent>
            <DialogActions fluid>
                <Button appearance="secondary" onClick={onBack}>
                    {locConstants.common.back}
                </Button>
                <div className={classes.footerSpacer} />
                <Button appearance="primary" icon={<ArrowSync16Regular />} onClick={onApply}>
                    {locConstants.schemaDesigner.applyDeploymentChanges}
                </Button>
            </DialogActions>
        </>
    );
};
