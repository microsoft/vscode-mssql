/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    BadgeProps,
    Button,
    Menu,
    MenuButtonProps,
    MenuDivider,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Spinner,
    SplitButton,
    Tooltip,
} from "@fluentui/react-components";
import {
    ArrowSync16Regular,
    Copy16Regular,
    Open16Regular,
    Play16Filled,
    Stop16Regular,
} from "@fluentui/react-icons";
import { useEffect, useMemo, useRef } from "react";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { useDabContext } from "../dabContext";
import { getDabEndpoints } from "./dabEndpoints";

/** How often the deployment's state is checked while the designer is open. */
const STATUS_POLL_INTERVAL_MS = 15_000;

/** Quiet time after a config edit before "config changed" is worked out again. */
const CONFIG_CHANGE_DEBOUNCE_MS = 1000;

/** A plain status dot. */
const statusDot = (color: BadgeProps["color"]) => <Badge size="extra-small" color={color} />;

/**
 * The toolbar's deploy control. With no deployment it is a Deploy button. Once
 * the database has a deployment it is a split button: the main part shows
 * whether the API is live and opens the deployment, and the menu holds the
 * deployment's endpoints and actions. The port, and whether the configuration
 * changed since it was deployed, are in the tooltip.
 */
export const DabDeployStatusButton = () => {
    const {
        dabConfig,
        dabDeployments,
        dabDeploymentRun,
        loadDabDeployments,
        loadDabDeploymentRun,
        openDabDeploymentsDialog,
        startDabDeployment,
        openUrl,
        copyToClipboard,
        stopDabDeploymentContainer,
    } = useDabContext();

    const deployment = dabDeployments[0];
    const runStatus = dabDeploymentRun?.status;
    const isRunActive =
        runStatus === Dab.DabDeploymentRunStatus.Running ||
        runStatus === Dab.DabDeploymentRunStatus.Waiting;

    // The loader changes with every config edit, since it compares the
    // deployment with the current config. Polling uses the latest one without
    // restarting on each edit.
    const loadDeploymentsRef = useRef(loadDabDeployments);
    loadDeploymentsRef.current = loadDabDeployments;

    // A deployment can stop on its own, so its state is checked regularly
    // while the designer is open, not only when the dialog opens.
    useEffect(() => {
        void loadDabDeploymentRun();
        void loadDeploymentsRef.current({ quiet: true });
        const interval = setInterval(
            () => void loadDeploymentsRef.current({ quiet: true }),
            STATUS_POLL_INTERVAL_MS,
        );
        return () => clearInterval(interval);
    }, [loadDabDeploymentRun]);

    // Whether the deployment runs the current config depends on the config,
    // so it is worked out again once edits settle.
    useEffect(() => {
        const timeout = setTimeout(
            () => void loadDeploymentsRef.current({ quiet: true }),
            CONFIG_CHANGE_DEBOUNCE_MS,
        );
        return () => clearTimeout(timeout);
    }, [dabConfig]);

    // A run that just finished changed the deployment, so it is reloaded.
    useEffect(() => {
        if (runStatus === Dab.DabDeploymentRunStatus.Succeeded) {
            void loadDeploymentsRef.current({ quiet: true });
        }
    }, [runStatus]);

    const endpoints = useMemo(
        () => getDabEndpoints(deployment?.apiUrl, deployment?.apiTypes),
        [deployment?.apiUrl, deployment?.apiTypes],
    );

    // A run in progress takes over the button: it is what the user is waiting on.
    if (isRunActive && dabDeploymentRun) {
        const isWaiting = runStatus === Dab.DabDeploymentRunStatus.Waiting;
        return (
            <Button
                appearance="secondary"
                size="small"
                icon={isWaiting ? statusDot("warning") : <Spinner size="extra-tiny" />}
                onClick={openDabDeploymentsDialog}>
                {isWaiting
                    ? locConstants.schemaDesigner.dabStatusSignInNeeded
                    : dabDeploymentRun.mode === Dab.DabDeploymentMode.Redeploy
                      ? locConstants.schemaDesigner.dabStatusUpdating
                      : locConstants.schemaDesigner.dabStatusDeploying}
            </Button>
        );
    }

    if (runStatus === Dab.DabDeploymentRunStatus.Failed) {
        return (
            <Button
                appearance="secondary"
                size="small"
                icon={statusDot("danger")}
                onClick={openDabDeploymentsDialog}>
                {locConstants.schemaDesigner.dabStatusDeployFailed}
            </Button>
        );
    }

    if (!deployment) {
        return (
            <Button
                appearance="primary"
                icon={<Play16Filled />}
                size="small"
                title={locConstants.schemaDesigner.deploy}
                onClick={openDabDeploymentsDialog}>
                {locConstants.schemaDesigner.deploy}
            </Button>
        );
    }

    const isRunning = deployment.status === Dab.DabDeploymentContainerStatus.Running;
    const isUnknown = deployment.status === Dab.DabDeploymentContainerStatus.Unknown;
    const label = isRunning
        ? locConstants.schemaDesigner.dabStatusLive
        : isUnknown
          ? locConstants.schemaDesigner.dabStatusUnavailable
          : locConstants.schemaDesigner.dabStatusStopped;
    const dotColor: BadgeProps["color"] = isRunning
        ? "success"
        : isUnknown
          ? "informative"
          : "danger";
    const statusTooltip = isRunning
        ? locConstants.schemaDesigner.dabStatusLiveTooltip(deployment.port)
        : locConstants.schemaDesigner.dabStatusNotLiveTooltip(deployment.port);
    const tooltip = deployment.isConfigOutdated
        ? `${statusTooltip} ${locConstants.schemaDesigner.dabStatusChangesTooltip}`
        : statusTooltip;

    /** Redeploys with the current config and shows the run in the dialog. */
    const redeploy = async () => {
        await startDabDeployment(deployment.target, deployment.id);
        openDabDeploymentsDialog();
    };

    return (
        <Menu positioning="below-end">
            <MenuTrigger disableButtonEnhancement>
                {(triggerProps: MenuButtonProps) => (
                    <Tooltip content={tooltip} relationship="description">
                        <SplitButton
                            appearance="secondary"
                            size="small"
                            icon={statusDot(dotColor)}
                            menuButton={{
                                ...triggerProps,
                                "aria-label": locConstants.schemaDesigner.dabDeploymentActions,
                            }}
                            primaryActionButton={{ onClick: openDabDeploymentsDialog }}>
                            {label}
                        </SplitButton>
                    </Tooltip>
                )}
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    {(deployment.isConfigOutdated || !isRunning) && (
                        <MenuItem icon={<ArrowSync16Regular />} onClick={() => void redeploy()}>
                            {isRunning
                                ? locConstants.schemaDesigner.applyDeploymentChanges
                                : locConstants.schemaDesigner.restartDeployment}
                        </MenuItem>
                    )}
                    {isRunning &&
                        endpoints
                            .filter((endpoint) => endpoint.openUrlConfig)
                            .map((endpoint) => (
                                <MenuItem
                                    key={endpoint.type}
                                    icon={<Open16Regular />}
                                    onClick={() =>
                                        openUrl(endpoint.openUrlConfig!.url, endpoint.type)
                                    }>
                                    {endpoint.openUrlConfig!.label}
                                </MenuItem>
                            ))}
                    <MenuItem
                        icon={<Copy16Regular />}
                        onClick={() => copyToClipboard(deployment.apiUrl, Dab.CopyTextType.Url)}>
                        {locConstants.schemaDesigner.copyApiUrl}
                    </MenuItem>
                    {isRunning && (
                        <>
                            <MenuDivider />
                            <MenuItem
                                icon={<Stop16Regular />}
                                onClick={() => void stopDabDeploymentContainer(deployment.id)}>
                                {locConstants.schemaDesigner.stopDeployment}
                            </MenuItem>
                        </>
                    )}
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
