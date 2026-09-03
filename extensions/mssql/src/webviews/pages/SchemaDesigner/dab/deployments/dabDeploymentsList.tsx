/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    Input,
    makeStyles,
    mergeClasses,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    Spinner,
    Text,
    tokens,
    Tooltip,
} from "@fluentui/react-components";
import {
    Add16Regular,
    ArrowClockwise16Regular,
    ArrowSync16Regular,
    ChevronDown16Regular,
    ChevronRight16Regular,
    Delete16Regular,
    MoreHorizontal20Regular,
    Play16Regular,
    Stop16Regular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useState } from "react";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { ApiStatus } from "../../../../../sharedInterfaces/webview";
import { useDabContext } from "../dabContext";
import { DabLogoIcon } from "../../../../common/icons/dabLogo";
import { DockerIcon } from "../../../../common/icons/docker";
import { DabDeploymentEndpoints } from "./dabDeploymentEndpoints";
import { DabDialogContent, DabDialogTitle } from "./dabDialogLayout";

const useStyles = makeStyles({
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        // Fill the dialog frame and let only the row list scroll.
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
    },
    description: {
        color: tokens.colorNeutralForeground2,
    },
    toolbar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
    },
    list: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
    },
    row: {
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "12px",
        borderRadius: "6px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    /** Where the deployment runs, shown as its mark rather than a word. */
    /** Status and platform read together at the start of the row. */
    rowIdentity: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexShrink: 0,
        // Aligns with the first line of the body rather than the whole block.
        paddingTop: "2px",
    },
    statusDot: {
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        flexShrink: 0,
    },
    statusDotRunning: {
        backgroundColor: tokens.colorStatusSuccessForeground1,
    },
    statusDotStopped: {
        backgroundColor: tokens.colorStatusDangerForeground1,
    },
    targetIconGlyph: {
        width: "24px",
        height: "24px",
    },
    targetIcon: {
        width: "28px",
        height: "28px",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    rowBody: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        flex: 1,
        minWidth: 0,
    },
    rowHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
    },
    statusBar: {
        // The bar owns a line of its own so the action it asks for sits next to
        // the reason, rather than being hunted for in the menu.
        width: "100%",
    },
    endpointsToggle: {
        alignSelf: "flex-start",
    },
    containerName: {
        fontWeight: 600,
    },
    metaText: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
    },

    spacer: {
        flex: 1,
    },
    centered: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        textAlign: "center",
        flex: 1,
        minHeight: 0,
    },
    errorText: {
        color: tokens.colorStatusDangerForeground1,
        fontSize: "12px",
    },
    deleteConfirmBody: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
});

function getStatusLabel(
    status: Dab.DabDeploymentContainerStatus,
    target: Dab.DabDeploymentTarget,
): string {
    switch (status) {
        case Dab.DabDeploymentContainerStatus.Running:
            return locConstants.schemaDesigner.deploymentStatusRunning;
        case Dab.DabDeploymentContainerStatus.Stopped:
            return locConstants.schemaDesigner.deploymentStatusStopped;
        case Dab.DabDeploymentContainerStatus.Missing:
            // A CLI deployment has no container; what is gone is the generated
            // config that would let it be started again.
            return target === Dab.DabDeploymentTarget.DabCli
                ? locConstants.schemaDesigner.deploymentStatusMissingCli
                : locConstants.schemaDesigner.deploymentStatusMissing;
        default:
            return locConstants.schemaDesigner.deploymentStatusUnknown;
    }
}

/** Largest whole unit that fits, so ages read the way people say them. */
const RELATIVE_TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 60 * 60],
    ["month", 30 * 24 * 60 * 60],
    ["week", 7 * 24 * 60 * 60],
    ["day", 24 * 60 * 60],
    ["hour", 60 * 60],
    ["minute", 60],
];

/**
 * Renders how long ago a deployment happened, in the viewer's locale.
 *
 * The exact timestamp stays available in a tooltip: the age answers "is this
 * current?" at a glance, while the precise time is what someone correlating
 * with a log needs.
 */
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

interface DabDeploymentsListProps {
    onCreateNew: () => void;
    onClose: () => void;
}

export const DabDeploymentsList = ({ onCreateNew, onClose }: DabDeploymentsListProps) => {
    const classes = useStyles();
    const {
        dabDeployments,
        dabDeploymentsStatus,
        dabDeploymentsError,
        loadDabDeployments,
        deleteDabDeployment,
        startDabDeploymentContainer,
        stopDabDeploymentContainer,
        redeployDabDeployment,
    } = useDabContext();

    const [busyDeploymentId, setBusyDeploymentId] = useState<string | undefined>();
    const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | undefined>();
    const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
    const [expandedIds, setExpandedIds] = useState<string[]>([]);
    const [rowErrors, setRowErrors] = useState<Record<string, string | undefined>>({});

    useEffect(() => {
        void loadDabDeployments();
    }, [loadDabDeployments]);

    const runAction = useCallback(
        async (
            deploymentId: string,
            action: (id: string) => Promise<Dab.DeploymentActionResponse>,
        ) => {
            setBusyDeploymentId(deploymentId);
            setRowErrors((prev) => ({ ...prev, [deploymentId]: undefined }));
            try {
                const result = await action(deploymentId);
                if (!result.success) {
                    setRowErrors((prev) => ({ ...prev, [deploymentId]: result.error }));
                }
            } finally {
                setBusyDeploymentId(undefined);
            }
        },
        [],
    );

    const toggleExpanded = useCallback((deploymentId: string) => {
        setExpandedIds((prev) =>
            prev.includes(deploymentId)
                ? prev.filter((id) => id !== deploymentId)
                : [...prev, deploymentId],
        );
    }, []);

    const isLoading = dabDeploymentsStatus === ApiStatus.Loading && dabDeployments.length === 0;
    const isEmpty = dabDeploymentsStatus === ApiStatus.Loaded && dabDeployments.length === 0;

    /** The mark of the platform a deployment runs on. */
    const renderTargetIcon = (target: Dab.DabDeploymentTarget) =>
        target === Dab.DabDeploymentTarget.DabCli ? (
            <DabLogoIcon className={classes.targetIconGlyph} role="img" aria-hidden />
        ) : (
            <DockerIcon className={classes.targetIconGlyph} role="img" aria-hidden />
        );

    /**
     * The one thing this deployment needs the reader to know, and the actions
     * that resolve it. A deployment that is serving the current configuration
     * needs no bar at all.
     */
    const renderStatusBar = (deployment: Dab.DabDeploymentListItem, isBusy: boolean) => {
        const isMissing = deployment.status === Dab.DabDeploymentContainerStatus.Missing;
        const isRunning = deployment.status === Dab.DabDeploymentContainerStatus.Running;
        const isCli = deployment.target === Dab.DabDeploymentTarget.DabCli;

        if (isRunning && !deployment.isConfigOutdated) {
            return undefined;
        }

        const redeployButton = (label: string) => (
            <Button
                size="small"
                appearance="primary"
                icon={<ArrowSync16Regular />}
                disabled={isBusy}
                onClick={() => void runAction(deployment.id, redeployDabDeployment)}>
                {label}
            </Button>
        );

        // Nothing survives to start, so redeploying is the only way back.
        if (isMissing) {
            return (
                <MessageBar intent="error" layout="multiline" className={classes.statusBar}>
                    <MessageBarBody>
                        <MessageBarTitle>
                            {locConstants.schemaDesigner.deploymentMissingTitle}
                        </MessageBarTitle>
                        {isCli
                            ? locConstants.schemaDesigner.deploymentMissingBodyCli
                            : locConstants.schemaDesigner.deploymentMissingBodyDocker}
                    </MessageBarBody>
                    <MessageBarActions>
                        {redeployButton(locConstants.schemaDesigner.redeploy)}
                    </MessageBarActions>
                </MessageBar>
            );
        }

        // Stopped: it can be started as it is, or brought up to date on the way.
        if (!isRunning) {
            return (
                <MessageBar intent="error" layout="multiline" className={classes.statusBar}>
                    <MessageBarBody>
                        <MessageBarTitle>
                            {locConstants.schemaDesigner.deploymentNotRunningTitle}
                        </MessageBarTitle>
                        {deployment.isConfigOutdated
                            ? locConstants.schemaDesigner.deploymentNotRunningOutdatedBody
                            : locConstants.schemaDesigner.deploymentNotRunningBody}
                    </MessageBarBody>
                    <MessageBarActions>
                        {deployment.isConfigOutdated &&
                            redeployButton(locConstants.schemaDesigner.updateAndStart)}
                        <Button
                            size="small"
                            appearance={deployment.isConfigOutdated ? "secondary" : "primary"}
                            icon={<Play16Regular />}
                            disabled={isBusy}
                            onClick={() =>
                                void runAction(deployment.id, startDabDeploymentContainer)
                            }>
                            {locConstants.schemaDesigner.startContainer}
                        </Button>
                    </MessageBarActions>
                </MessageBar>
            );
        }

        // Running, but not what the designer currently describes.
        return (
            <MessageBar intent="warning" layout="multiline" className={classes.statusBar}>
                <MessageBarBody>
                    <MessageBarTitle>
                        {locConstants.schemaDesigner.deploymentConfigOutdatedTitle}
                    </MessageBarTitle>
                    {locConstants.schemaDesigner.deploymentConfigOutdatedBody}
                </MessageBarBody>
                <MessageBarActions>
                    {redeployButton(locConstants.schemaDesigner.redeploy)}
                </MessageBarActions>
            </MessageBar>
        );
    };

    const renderRow = (deployment: Dab.DabDeploymentListItem) => {
        const isBusy = busyDeploymentId === deployment.id;
        const isExpanded = expandedIds.includes(deployment.id);
        const isMissing = deployment.status === Dab.DabDeploymentContainerStatus.Missing;
        const isRunning = deployment.status === Dab.DabDeploymentContainerStatus.Running;
        const isStopped = deployment.status === Dab.DabDeploymentContainerStatus.Stopped;
        const rowError = rowErrors[deployment.id];

        return (
            <div key={deployment.id} className={classes.row}>
                <Tooltip
                    content={getStatusLabel(deployment.status, deployment.target)}
                    relationship="description">
                    <div className={classes.rowIdentity}>
                        <div
                            className={mergeClasses(
                                classes.statusDot,
                                isRunning ? classes.statusDotRunning : classes.statusDotStopped,
                            )}
                            role="img"
                            aria-label={getStatusLabel(deployment.status, deployment.target)}
                        />
                        <div className={classes.targetIcon}>
                            {renderTargetIcon(deployment.target)}
                        </div>
                    </div>
                </Tooltip>

                <div className={classes.rowBody}>
                    <div className={classes.rowHeader}>
                        <Text className={classes.containerName}>{deployment.name}</Text>
                        <Text className={classes.metaText}>
                            {locConstants.schemaDesigner.deploymentPort(deployment.port)}
                        </Text>
                        {!deployment.isConfigOutdated && (
                            <Badge appearance="tint" color="brand">
                                {locConstants.schemaDesigner.deploymentConfigUpToDate}
                            </Badge>
                        )}
                        <div className={classes.spacer} />
                        <Tooltip
                            content={locConstants.schemaDesigner.deployedAt(
                                new Date(deployment.deployedUtc).toLocaleString(),
                            )}
                            relationship="description">
                            <Text className={classes.metaText}>
                                {locConstants.schemaDesigner.deployedOn(
                                    formatTimeAgo(deployment.deployedUtc),
                                )}
                            </Text>
                        </Tooltip>
                    </div>

                    {renderStatusBar(deployment, isBusy)}

                    {!isMissing && (
                        <Button
                            size="small"
                            appearance="subtle"
                            className={classes.endpointsToggle}
                            icon={isExpanded ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                            onClick={() => toggleExpanded(deployment.id)}>
                            {isExpanded
                                ? locConstants.schemaDesigner.hideEndpoints
                                : locConstants.schemaDesigner.showEndpoints}
                        </Button>
                    )}

                    {isExpanded && !isMissing && (
                        <DabDeploymentEndpoints
                            apiUrl={deployment.apiUrl}
                            apiTypes={deployment.apiTypes}
                            isDisabled={!isRunning}
                        />
                    )}

                    {rowError && <Text className={classes.errorText}>{rowError}</Text>}
                </div>

                {isBusy ? (
                    <Spinner size="tiny" />
                ) : (
                    <Menu>
                        <MenuTrigger disableButtonEnhancement>
                            <Button
                                appearance="subtle"
                                icon={<MoreHorizontal20Regular />}
                                aria-label={locConstants.schemaDesigner.deploymentActions}
                                title={locConstants.schemaDesigner.deploymentActions}
                            />
                        </MenuTrigger>
                        <MenuPopover>
                            <MenuList>
                                {isStopped && (
                                    <MenuItem
                                        icon={<Play16Regular />}
                                        onClick={() =>
                                            void runAction(
                                                deployment.id,
                                                startDabDeploymentContainer,
                                            )
                                        }>
                                        {locConstants.schemaDesigner.startContainer}
                                    </MenuItem>
                                )}
                                {isRunning && (
                                    <MenuItem
                                        icon={<Stop16Regular />}
                                        onClick={() =>
                                            void runAction(
                                                deployment.id,
                                                stopDabDeploymentContainer,
                                            )
                                        }>
                                        {locConstants.schemaDesigner.stopContainer}
                                    </MenuItem>
                                )}
                                <MenuItem
                                    icon={<ArrowSync16Regular />}
                                    onClick={() =>
                                        void runAction(deployment.id, redeployDabDeployment)
                                    }>
                                    {locConstants.schemaDesigner.redeploy}
                                </MenuItem>
                                <MenuItem
                                    icon={<Delete16Regular />}
                                    onClick={() => {
                                        setDeleteConfirmationText("");
                                        setConfirmingDeleteId(deployment.id);
                                    }}>
                                    {locConstants.schemaDesigner.deleteDeployment}
                                </MenuItem>
                            </MenuList>
                        </MenuPopover>
                    </Menu>
                )}
            </div>
        );
    };

    const confirmDelete = async () => {
        const deploymentId = confirmingDeleteId;
        if (!deploymentId) {
            return;
        }

        setConfirmingDeleteId(undefined);
        await runAction(deploymentId, deleteDabDeployment);
    };

    const deploymentAwaitingDelete = dabDeployments.find(
        (deployment) => deployment.id === confirmingDeleteId,
    );
    // Deleting stops a running API and, for the CLI, removes its generated
    // config. Typing the name makes that a deliberate act rather than one
    // stray click in a menu.
    const canConfirmDelete =
        !!deploymentAwaitingDelete && deleteConfirmationText === deploymentAwaitingDelete.name;

    return (
        <>
            <DabDialogTitle>{locConstants.schemaDesigner.deployments}</DabDialogTitle>
            <DabDialogContent>
                <div className={classes.toolbar}>
                    <Button appearance="primary" icon={<Add16Regular />} onClick={onCreateNew}>
                        {locConstants.schemaDesigner.createNewDeployment}
                    </Button>
                    <Button
                        appearance="subtle"
                        icon={<ArrowClockwise16Regular />}
                        disabled={dabDeploymentsStatus === ApiStatus.Loading}
                        onClick={() => void loadDabDeployments()}>
                        {locConstants.schemaDesigner.refreshDeployments}
                    </Button>
                </div>

                {isLoading && (
                    <div className={classes.centered}>
                        <Spinner
                            size="small"
                            label={locConstants.schemaDesigner.loadingDeployments}
                        />
                    </div>
                )}

                {dabDeploymentsError && (
                    <Text className={classes.errorText}>{dabDeploymentsError}</Text>
                )}

                {isEmpty && (
                    <div className={classes.centered}>
                        <Text weight="semibold">{locConstants.schemaDesigner.noDeployments}</Text>
                    </div>
                )}

                {dabDeployments.length > 0 && (
                    <div className={classes.list}>{dabDeployments.map(renderRow)}</div>
                )}
            </DabDialogContent>
            <Dialog
                open={!!deploymentAwaitingDelete}
                modalType="alert"
                onOpenChange={(_, data) => {
                    if (!data.open) {
                        setConfirmingDeleteId(undefined);
                    }
                }}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {locConstants.schemaDesigner.deleteDeploymentConfirmTitle}
                        </DialogTitle>
                        <DialogContent className={classes.deleteConfirmBody}>
                            <Text>
                                {deploymentAwaitingDelete?.target === Dab.DabDeploymentTarget.DabCli
                                    ? locConstants.schemaDesigner.deleteCliDeploymentConfirmMessage(
                                          deploymentAwaitingDelete?.name ?? "",
                                      )
                                    : locConstants.schemaDesigner.deleteDeploymentConfirmMessage(
                                          deploymentAwaitingDelete?.name ?? "",
                                      )}
                            </Text>
                            <Field
                                label={locConstants.schemaDesigner.deleteDeploymentNameLabel}
                                hint={locConstants.schemaDesigner.deleteDeploymentTypeToConfirm(
                                    deploymentAwaitingDelete?.name ?? "",
                                )}>
                                <Input
                                    value={deleteConfirmationText}
                                    autoFocus
                                    onChange={(_, data) => setDeleteConfirmationText(data.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" && canConfirmDelete) {
                                            event.preventDefault();
                                            void confirmDelete();
                                        }
                                    }}
                                />
                            </Field>
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                onClick={() => setConfirmingDeleteId(undefined)}>
                                {locConstants.common.cancel}
                            </Button>
                            <Button
                                appearance="primary"
                                disabled={!canConfirmDelete}
                                icon={<Delete16Regular />}
                                onClick={() => void confirmDelete()}>
                                {locConstants.schemaDesigner.deleteDeployment}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            <DialogActions>
                <Button appearance="secondary" onClick={onClose}>
                    {locConstants.common.close}
                </Button>
            </DialogActions>
        </>
    );
};
