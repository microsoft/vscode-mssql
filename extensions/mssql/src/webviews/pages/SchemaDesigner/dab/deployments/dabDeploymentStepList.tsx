/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Avatar,
    Button,
    Link,
    makeStyles,
    mergeClasses,
    ProgressBar,
    Spinner,
    Text,
    tokens,
} from "@fluentui/react-components";
import {
    CheckmarkCircle20Filled,
    Copy16Regular,
    DismissCircle20Filled,
    Open16Regular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { ApiStatus } from "../../../../../sharedInterfaces/webview";
import { useDabContext } from "../dabContext";

const useStyles = makeStyles({
    list: {
        display: "flex",
        flexDirection: "column",
        borderRadius: tokens.borderRadiusXLarge,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        // Rows keep their natural height; the dialog content scrolls instead,
        // so a long log never squeezes or clips the rows around it.
        flexShrink: 0,
        overflow: "hidden",
    },
    row: {
        display: "grid",
        gridTemplateColumns: "20px minmax(0, 1fr)",
        columnGap: "12px",
        padding: "14px 16px",
        flexShrink: 0,
        ":not(:last-child)": {
            borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        },
    },
    icon: {
        width: "20px",
        height: "20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginTop: "1px",
    },
    iconDone: {
        color: tokens.colorPaletteGreenForeground1,
    },
    iconError: {
        color: tokens.colorPaletteRedForeground1,
    },
    /** A pending step: an empty ring. */
    ring: {
        width: "16px",
        height: "16px",
        borderRadius: "50%",
        border: `1.5px solid ${tokens.colorNeutralStrokeAccessible}`,
        boxSizing: "border-box",
    },
    /** A step waiting for the user: an accent ring with a dot. */
    ringWaiting: {
        border: "1.5px solid var(--vscode-focusBorder)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        "::after": {
            content: '""',
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: "var(--vscode-focusBorder)",
        },
    },
    body: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        minWidth: 0,
    },
    title: {
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    titlePending: {
        fontWeight: tokens.fontWeightRegular,
        color: tokens.colorNeutralForeground3,
    },
    subtitle: {
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        color: tokens.colorNeutralForeground3,
        overflowWrap: "anywhere",
    },
    progress: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        marginTop: "8px",
        maxWidth: "480px",
    },
    panel: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        marginTop: "12px",
        padding: "16px",
        borderRadius: tokens.borderRadiusLarge,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
    },
    panelError: {
        border: `1px solid ${tokens.colorPaletteRedBorder1}`,
    },
    panelText: {
        color: tokens.colorNeutralForeground1,
        overflowWrap: "anywhere",
    },
    panelNote: {
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        color: tokens.colorNeutralForeground3,
    },
    actions: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
    },
    account: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
    },
    accountText: {
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
    },
    accountName: {
        fontWeight: tokens.fontWeightSemibold,
        overflowWrap: "anywhere",
    },
    code: {
        alignSelf: "flex-start",
        padding: "8px 14px",
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: tokens.fontSizeBase500,
        letterSpacing: "0.12em",
        userSelect: "all",
    },
    details: {
        margin: 0,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        color: tokens.colorNeutralForeground2,
    },
    logs: {
        display: "flex",
        flexDirection: "column",
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        overflow: "hidden",
    },
    logsHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "4px 4px 4px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    logsBody: {
        margin: 0,
        padding: "8px 12px",
        maxHeight: "160px",
        overflow: "auto",
        whiteSpace: "pre",
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
        color: tokens.colorNeutralForeground2,
    },
});

/** Title of each step, and what its row says while it runs. */
function getStepText(step: Dab.DabDeploymentStepOrder): { title: string; running: string } {
    const loc = locConstants.schemaDesigner;
    switch (step) {
        case Dab.DabDeploymentStepOrder.dockerInstallation:
            return { title: loc.dabStepCheckDocker, running: loc.dabStepCheckDockerRunning };
        case Dab.DabDeploymentStepOrder.startDockerDesktop:
            return { title: loc.dabStepStartDocker, running: loc.dabStepStartDockerRunning };
        case Dab.DabDeploymentStepOrder.checkDockerEngine:
            return { title: loc.dabStepDockerEngine, running: loc.dabStepDockerEngineRunning };
        case Dab.DabDeploymentStepOrder.pullImage:
            return { title: loc.dabStepPullImage, running: loc.dabStepPullImageRunning };
        case Dab.DabDeploymentStepOrder.startContainer:
            return { title: loc.dabStepStartApi, running: loc.dabStepStartContainerRunning };
        case Dab.DabDeploymentStepOrder.checkContainer:
        case Dab.DabDeploymentStepOrder.checkCliEngine:
            return { title: loc.dabStepWaitForApi, running: loc.dabStepWaitForApiRunning };
        case Dab.DabDeploymentStepOrder.acquireDabCli:
            return { title: loc.dabStepPrepareCli, running: loc.dabStepPrepareCliRunning };
        case Dab.DabDeploymentStepOrder.checkDotnetRuntime:
            return { title: loc.dabStepCheckDotnet, running: loc.dabStepCheckDotnetRunning };
        case Dab.DabDeploymentStepOrder.acquireAzureCli:
            return { title: loc.dabStepGetAzureCli, running: loc.dabStepGetAzureCliRunning };
        case Dab.DabDeploymentStepOrder.signInEntra:
            return { title: loc.dabStepSignInEntra, running: loc.dabStepSignInEntraRunning };
        case Dab.DabDeploymentStepOrder.validateCliConfig:
            return {
                title: loc.dabStepValidateConfig,
                running: loc.dabStepValidateConfigRunning,
            };
        case Dab.DabDeploymentStepOrder.startCliEngine:
            return { title: loc.dabStepStartApi, running: loc.dabStepStartApiRunning };
    }
}

/** What the row says while the step works on an answer the user gave. */
function getActionText(action: Dab.DabDeploymentStepAction | undefined): string | undefined {
    const loc = locConstants.schemaDesigner;
    switch (action) {
        case Dab.DabDeploymentStepAction.SignIn:
            return loc.dabStepSigningInBrowser;
        case Dab.DabDeploymentStepAction.SignInWithCode:
        case Dab.DabDeploymentStepAction.AwaitSignIn:
            return loc.dabStepSigningInCode;
        default:
            return undefined;
    }
}

const BYTES_PER_MEGABYTE = 1024 * 1024;

/** Elapsed time as m:ss, the way a stopwatch reads. */
function formatElapsed(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** What the row says about a step that reports how far it has got. */
function getProgressText(progress: Dab.DabDeploymentStepProgress, entityCount: number): string {
    const loc = locConstants.schemaDesigner;
    switch (progress.phase) {
        case "download": {
            const completed = Math.round(progress.completed / BYTES_PER_MEGABYTE);
            return progress.total
                ? loc.dabProgressDownloading(
                      completed,
                      Math.round(progress.total / BYTES_PER_MEGABYTE),
                  )
                : loc.dabProgressDownloadingUnknownSize(completed);
        }
        case "unpack":
            return loc.dabProgressUnpacking(progress.completed, progress.total);
        case "install":
            return loc.dabProgressInstalling(progress.percent);
        case "starting":
            // The engine loads every entity before it answers, so the wait
            // grows with the number of entities.
            return loc.dabProgressLoadingEntities(
                entityCount,
                formatElapsed(progress.elapsedSeconds),
            );
    }
}

/** How full the progress bar is, or undefined for a phase with no measure. */
function getProgressValue(progress: Dab.DabDeploymentStepProgress): number | undefined {
    if (progress.phase === "install") {
        return progress.percent / 100;
    }
    if (progress.phase === "starting" || !progress.total) {
        return undefined;
    }

    return Math.min(progress.completed / progress.total, 1);
}

/** Collects every step's outcome and output into one log for a new editor tab. */
export function buildDeploymentLog(stepStatuses: Dab.DabDeploymentStepStatus[]): string {
    return stepStatuses
        .map((stepStatus) => {
            const lines = [`${getStepText(stepStatus.step).title}: ${stepStatus.status}`];
            for (const text of [
                stepStatus.detail,
                stepStatus.message,
                stepStatus.fullErrorText,
                stepStatus.containerLogs,
            ]) {
                if (text?.trim()) {
                    lines.push(text.trim());
                }
            }
            return lines.join("\n");
        })
        .join("\n\n");
}

interface DabDeploymentStepListProps {
    stepStatuses: Dab.DabDeploymentStepStatus[];
}

export const DabDeploymentStepList = ({ stepStatuses }: DabDeploymentStepListProps) => {
    const classes = useStyles();

    return (
        <div className={classes.list} role="list">
            {stepStatuses.map((stepStatus) => (
                <DabDeploymentStepRow key={stepStatus.step} stepStatus={stepStatus} />
            ))}
        </div>
    );
};

const DabDeploymentStepRow = ({ stepStatus }: { stepStatus: Dab.DabDeploymentStepStatus }) => {
    const classes = useStyles();
    const { respondToDabDeploymentStep, dabConfig } = useDabContext();
    const { status, prompt, action, detail, message, progress } = stepStatus;
    const text = getStepText(stepStatus.step);
    const isPending = status === ApiStatus.NotStarted;
    const isRunning = status === ApiStatus.Loading;
    const isDone = status === ApiStatus.Loaded;
    const isError = status === ApiStatus.Error;
    // A device code stays on screen while the sign-in waits for it, so the row
    // keeps reading as waiting for the user rather than as busy.
    const isWaiting =
        isRunning && !!prompt && (!action || action === Dab.DabDeploymentStepAction.AwaitSignIn);

    const renderIcon = () => {
        if (isDone) {
            return <CheckmarkCircle20Filled className={classes.iconDone} />;
        }
        if (isError) {
            return <DismissCircle20Filled className={classes.iconError} />;
        }
        if (isWaiting) {
            return <span className={mergeClasses(classes.ring, classes.ringWaiting)} />;
        }
        if (isRunning) {
            return <Spinner size="extra-tiny" />;
        }
        return <span className={classes.ring} />;
    };

    const getSubtitle = (): string | undefined => {
        if (isDone) {
            return detail || locConstants.schemaDesigner.dabStepDone;
        }
        if (isWaiting) {
            return locConstants.schemaDesigner.dabStepWaitingForYou;
        }
        if (isRunning) {
            return (
                (progress && getProgressText(progress, Dab.getExposedDabEntityCount(dabConfig))) ??
                getActionText(action) ??
                text.running
            );
        }
        return undefined;
    };
    const subtitle = getSubtitle();

    return (
        <div className={classes.row} role="listitem">
            <span className={classes.icon} aria-hidden>
                {renderIcon()}
            </span>
            <div className={classes.body}>
                <Text className={mergeClasses(classes.title, isPending && classes.titlePending)}>
                    {text.title}
                </Text>
                {subtitle && <Text className={classes.subtitle}>{subtitle}</Text>}
                {isRunning && progress && (
                    <div className={classes.progress}>
                        <ProgressBar
                            thickness="medium"
                            value={getProgressValue(progress)}
                            aria-label={subtitle}
                        />
                    </div>
                )}
                {isRunning && action === Dab.DabDeploymentStepAction.SignIn && (
                    <div className={classes.panel}>
                        {prompt?.account && <EntraAccount account={prompt.account} />}
                        {/* A browser that never opens would leave the step
                            waiting with no way forward, so the code sign-in
                            stays one click away. */}
                        <div className={classes.actions}>
                            <Text className={classes.panelNote}>
                                {locConstants.schemaDesigner.browserDidNotOpen}
                            </Text>
                            <Link
                                onClick={() =>
                                    respondToDabDeploymentStep(
                                        stepStatus.step,
                                        Dab.DabDeploymentStepAction.SignInWithCode,
                                    )
                                }>
                                {locConstants.schemaDesigner.useCodeInstead}
                            </Link>
                        </div>
                    </div>
                )}
                {isWaiting && prompt && <StepPrompt step={stepStatus.step} prompt={prompt} />}
                {isError && <StepError stepStatus={stepStatus} message={message} />}
            </div>
        </div>
    );
};

const StepPrompt = ({
    step,
    prompt,
}: {
    step: Dab.DabDeploymentStepOrder;
    prompt: Dab.DabDeploymentStepPrompt;
}) => {
    const classes = useStyles();
    const { respondToDabDeploymentStep } = useDabContext();
    const [isCopied, setIsCopied] = useState(false);
    const respond = (stepAction: Dab.DabDeploymentStepAction) =>
        respondToDabDeploymentStep(step, stepAction);

    switch (prompt.kind) {
        case "entraSignIn":
            return (
                <div className={classes.panel}>
                    {prompt.account && <EntraAccount account={prompt.account} />}
                    <div className={classes.actions}>
                        <Button
                            appearance="primary"
                            onClick={() => respond(Dab.DabDeploymentStepAction.SignIn)}>
                            {locConstants.schemaDesigner.signIn}
                        </Button>
                        <Link onClick={() => respond(Dab.DabDeploymentStepAction.SignInWithCode)}>
                            {locConstants.schemaDesigner.useCodeInstead}
                        </Link>
                    </div>
                </div>
            );

        case "entraDeviceCode":
            return (
                <div className={classes.panel}>
                    {prompt.account && <EntraAccount account={prompt.account} />}
                    <Text className={classes.panelText}>
                        {locConstants.schemaDesigner.deviceCodeInstructions}
                    </Text>
                    <Text className={classes.code}>{prompt.userCode}</Text>
                    <div className={classes.actions}>
                        <Button
                            appearance="primary"
                            icon={<Open16Regular />}
                            as="a"
                            href={prompt.verificationUri}
                            target="_blank"
                            rel="noopener noreferrer">
                            {locConstants.schemaDesigner.openSignInPage}
                        </Button>
                        <Button
                            appearance="secondary"
                            icon={<Copy16Regular />}
                            onClick={() => {
                                void navigator.clipboard
                                    ?.writeText(prompt.userCode)
                                    .then(() => setIsCopied(true));
                            }}>
                            {isCopied
                                ? locConstants.common.copied
                                : locConstants.schemaDesigner.copyCode}
                        </Button>
                    </div>
                </div>
            );
    }
};

const EntraAccount = ({ account }: { account: string }) => {
    const classes = useStyles();
    return (
        <div className={classes.account}>
            <Avatar name={account} size={32} color="colorful" />
            <div className={classes.accountText}>
                <Text className={classes.accountName}>{account}</Text>
                <Text className={classes.panelNote}>
                    {locConstants.schemaDesigner.entraAccountCaption}
                </Text>
            </div>
        </div>
    );
};

const StepError = ({
    stepStatus,
    message,
}: {
    stepStatus: Dab.DabDeploymentStepStatus;
    message: string | undefined;
}) => {
    const classes = useStyles();
    const { copyToClipboard, openLogsInNewTab } = useDabContext();
    const [showDetails, setShowDetails] = useState(false);
    const logs = stepStatus.containerLogs?.trim();
    // The summary names the kind of failure; the underlying error names the
    // cause. Only offer it when it adds something the summary does not.
    const fullErrorText = stepStatus.fullErrorText?.trim();
    const hasDetails = !!fullErrorText && fullErrorText !== message?.trim();

    // A retry that fails differently deserves to be read from the top.
    useEffect(() => setShowDetails(false), [fullErrorText]);

    return (
        <div className={mergeClasses(classes.panel, classes.panelError)}>
            {message && <Text className={classes.panelText}>{message}</Text>}
            {(stepStatus.errorLink || hasDetails) && (
                <div className={classes.actions}>
                    {stepStatus.errorLink && (
                        <Link href={stepStatus.errorLink} target="_blank" rel="noopener noreferrer">
                            {stepStatus.errorLinkText}
                        </Link>
                    )}
                    {hasDetails && (
                        <Link onClick={() => setShowDetails(!showDetails)}>
                            {showDetails
                                ? locConstants.schemaDesigner.hideErrorDetails
                                : locConstants.schemaDesigner.showErrorDetails}
                        </Link>
                    )}
                </div>
            )}
            {showDetails && fullErrorText && <pre className={classes.details}>{fullErrorText}</pre>}
            {logs && (
                <div className={classes.logs}>
                    <div className={classes.logsHeader}>
                        <Text size={200} weight="semibold">
                            {locConstants.schemaDesigner.engineLogs}
                        </Text>
                        <div className={classes.actions}>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<Copy16Regular />}
                                onClick={() => copyToClipboard(logs, Dab.CopyTextType.Logs)}>
                                {locConstants.common.copy}
                            </Button>
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<Open16Regular />}
                                onClick={() => openLogsInNewTab(logs)}>
                                {locConstants.queryResult.openResultInNewTab}
                            </Button>
                        </div>
                    </div>
                    <pre className={classes.logsBody}>{logs}</pre>
                </div>
            )}
        </div>
    );
};
