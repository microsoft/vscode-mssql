/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    makeStyles,
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
    Play16Regular,
    Stop16Regular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useState } from "react";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { ApiStatus } from "../../../../../sharedInterfaces/webview";
import { useDabContext } from "../dabContext";
import { DabDeploymentEndpoints } from "./dabDeploymentEndpoints";

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
        flexDirection: "column",
        gap: "8px",
        padding: "10px 12px",
        borderRadius: "6px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    rowHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
    },
    containerName: {
        fontWeight: 600,
    },
    metaText: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
    },
    rowActions: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        flexWrap: "wrap",
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
        padding: "24px",
        textAlign: "center",
        flex: 1,
    },
    errorText: {
        color: tokens.colorStatusDangerForeground1,
        fontSize: "12px",
    },
    confirmRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
    },
});

/** Status badge colors, so a row's state reads at a glance. */
const statusBadgeColor: Record<
    Dab.DabDeploymentContainerStatus,
    "success" | "informative" | "danger" | "warning"
> = {
    [Dab.DabDeploymentContainerStatus.Running]: "success",
    [Dab.DabDeploymentContainerStatus.Stopped]: "informative",
    [Dab.DabDeploymentContainerStatus.Missing]: "danger",
    [Dab.DabDeploymentContainerStatus.Unknown]: "warning",
};

/** Short label naming where a deployment runs. */
function getTargetLabel(target: Dab.DabDeploymentTarget): string {
    return target === Dab.DabDeploymentTarget.DabCli
        ? locConstants.schemaDesigner.deploymentTargetLabelDabCli
        : locConstants.schemaDesigner.deploymentTargetLabelDocker;
}

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

    const renderRow = (deployment: Dab.DabDeploymentListItem) => {
        const isBusy = busyDeploymentId === deployment.id;
        const isExpanded = expandedIds.includes(deployment.id);
        const isMissing = deployment.status === Dab.DabDeploymentContainerStatus.Missing;
        const isRunning = deployment.status === Dab.DabDeploymentContainerStatus.Running;
        const isStopped = deployment.status === Dab.DabDeploymentContainerStatus.Stopped;
        const rowError = rowErrors[deployment.id];

        return (
            <div key={deployment.id} className={classes.row}>
                <div className={classes.rowHeader}>
                    <Text className={classes.containerName}>{deployment.name}</Text>
                    <Text className={classes.metaText}>
                        {locConstants.schemaDesigner.deploymentPort(deployment.port)}
                    </Text>
                    <Badge appearance="outline" color="informative">
                        {getTargetLabel(deployment.target)}
                    </Badge>
                    <Badge appearance="tint" color={statusBadgeColor[deployment.status]}>
                        {getStatusLabel(deployment.status, deployment.target)}
                    </Badge>
                    {deployment.isConfigOutdated ? (
                        <Tooltip
                            content={locConstants.schemaDesigner.deploymentConfigOutdatedTooltip}
                            relationship="label">
                            <Badge appearance="tint" color="warning">
                                {locConstants.schemaDesigner.deploymentConfigOutdated}
                            </Badge>
                        </Tooltip>
                    ) : (
                        <Badge appearance="tint" color="brand">
                            {locConstants.schemaDesigner.deploymentConfigUpToDate}
                        </Badge>
                    )}
                    <div className={classes.spacer} />
                    <Text className={classes.metaText}>
                        {locConstants.schemaDesigner.deployedOn(
                            new Date(deployment.deployedUtc).toLocaleString(),
                        )}
                    </Text>
                </div>

                {confirmingDeleteId === deployment.id ? (
                    <div className={classes.confirmRow}>
                        <Text className={classes.metaText}>
                            {deployment.target === Dab.DabDeploymentTarget.DabCli
                                ? locConstants.schemaDesigner.deleteCliDeploymentConfirmMessage(
                                      deployment.name,
                                  )
                                : locConstants.schemaDesigner.deleteDeploymentConfirmMessage(
                                      deployment.name,
                                  )}
                        </Text>
                        <div className={classes.spacer} />
                        <Button
                            size="small"
                            appearance="secondary"
                            disabled={isBusy}
                            onClick={() => setConfirmingDeleteId(undefined)}>
                            {locConstants.common.cancel}
                        </Button>
                        <Button
                            size="small"
                            appearance="primary"
                            disabled={isBusy}
                            icon={isBusy ? <Spinner size="tiny" /> : undefined}
                            onClick={async () => {
                                await runAction(deployment.id, deleteDabDeployment);
                                setConfirmingDeleteId(undefined);
                            }}>
                            {locConstants.schemaDesigner.deleteDeployment}
                        </Button>
                    </div>
                ) : (
                    <div className={classes.rowActions}>
                        {!isMissing && (
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={
                                    isExpanded ? (
                                        <ChevronDown16Regular />
                                    ) : (
                                        <ChevronRight16Regular />
                                    )
                                }
                                onClick={() => toggleExpanded(deployment.id)}>
                                {isExpanded
                                    ? locConstants.schemaDesigner.hideEndpoints
                                    : locConstants.schemaDesigner.showEndpoints}
                            </Button>
                        )}
                        <div className={classes.spacer} />
                        {isStopped && (
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<Play16Regular />}
                                disabled={isBusy}
                                onClick={() =>
                                    void runAction(deployment.id, startDabDeploymentContainer)
                                }>
                                {locConstants.schemaDesigner.startContainer}
                            </Button>
                        )}
                        {isRunning && (
                            <Button
                                size="small"
                                appearance="subtle"
                                icon={<Stop16Regular />}
                                disabled={isBusy}
                                onClick={() =>
                                    void runAction(deployment.id, stopDabDeploymentContainer)
                                }>
                                {locConstants.schemaDesigner.stopContainer}
                            </Button>
                        )}
                        <Tooltip
                            content={locConstants.schemaDesigner.redeployTooltip}
                            relationship="label">
                            <Button
                                size="small"
                                appearance={deployment.isConfigOutdated ? "primary" : "secondary"}
                                icon={<ArrowSync16Regular />}
                                disabled={isBusy}
                                onClick={() =>
                                    void runAction(deployment.id, redeployDabDeployment)
                                }>
                                {locConstants.schemaDesigner.redeploy}
                            </Button>
                        </Tooltip>
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<Delete16Regular />}
                            disabled={isBusy}
                            onClick={() => setConfirmingDeleteId(deployment.id)}>
                            {locConstants.schemaDesigner.deleteDeployment}
                        </Button>
                    </div>
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
        );
    };

    return (
        <>
            <DialogTitle>{locConstants.schemaDesigner.deployments}</DialogTitle>
            <DialogContent className={classes.content}>
                <Text className={classes.description}>
                    {locConstants.schemaDesigner.deploymentsDescription}
                </Text>
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
                        <Text className={classes.metaText}>
                            {locConstants.schemaDesigner.noDeploymentsDescription}
                        </Text>
                    </div>
                )}

                {dabDeployments.length > 0 && (
                    <div className={classes.list}>{dabDeployments.map(renderRow)}</div>
                )}
            </DialogContent>
            <DialogActions>
                <Button appearance="secondary" onClick={onClose}>
                    {locConstants.common.close}
                </Button>
            </DialogActions>
        </>
    );
};
