/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Link, makeStyles } from "@fluentui/react-components";
import { Desktop20Regular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import {
    AzureSqlContainerForm,
    AzureSqlContainerProvisioningResult,
    AzureSqlContainerProvisioningStep,
    AzureSqlDatabaseRequests,
    ContainerEngine,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import {
    DeploymentReducers,
    DeploymentWebviewState,
} from "../../../../sharedInterfaces/deployment";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { ConnectToDatabaseCard } from "../connectToDatabaseCard";
import { DeploymentStepCard } from "../deploymentStepCard";
import { WhatsNextCard } from "../whatsNextCard";
import { getContainerEngineDisplayName } from "./azureSqlDatabaseContainerEnginePage";

const provisioningSteps = [
    AzureSqlContainerProvisioningStep.PullImage,
    AzureSqlContainerProvisioningStep.CreateContainer,
    AzureSqlContainerProvisioningStep.WaitForReady,
    AzureSqlContainerProvisioningStep.Connect,
] as const;

const useStyles = makeStyles({
    outer: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        paddingBottom: "24px",
    },
    detailsRow: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "8px 0 16px",
    },
    heading: {
        fontSize: "24px",
        fontWeight: 600,
    },
    errorDetails: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        paddingTop: "8px",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
    },
    retryButton: {
        alignSelf: "flex-start",
        marginTop: "16px",
    },
    postDeploymentCard: {
        marginTop: "24px",
    },
});

interface ProvisioningPageProps {
    engine: ContainerEngine;
    form: AzureSqlContainerForm;
    onComplete: (complete: boolean) => void;
}

export const AzureSqlDatabaseContainerProvisioningPage: React.FC<ProvisioningPageProps> = ({
    engine,
    form,
    onComplete,
}) => {
    const classes = useStyles();
    const { extensionRpc } = useVscodeWebview<DeploymentWebviewState, DeploymentReducers>();
    const [statuses, setStatuses] = useState<Record<AzureSqlContainerProvisioningStep, ApiStatus>>(
        () => ({
            [AzureSqlContainerProvisioningStep.PullImage]: ApiStatus.NotStarted,
            [AzureSqlContainerProvisioningStep.CreateContainer]: ApiStatus.NotStarted,
            [AzureSqlContainerProvisioningStep.WaitForReady]: ApiStatus.NotStarted,
            [AzureSqlContainerProvisioningStep.Connect]: ApiStatus.NotStarted,
        }),
    );
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [attempt, setAttempt] = useState(0);
    const [error, setError] = useState<string>();
    const [fullErrorText, setFullErrorText] = useState<string>();
    const [showErrorDetails, setShowErrorDetails] = useState(false);
    const [connectionString, setConnectionString] = useState<string>();
    const runs = useRef(new Map<string, Promise<AzureSqlContainerProvisioningResult>>());
    const statusesRef = useRef(statuses);
    statusesRef.current = statuses;

    useEffect(() => {
        if (currentStepIndex >= provisioningSteps.length) {
            onComplete(true);
            return;
        }

        const step = provisioningSteps[currentStepIndex];
        const runKey = `${currentStepIndex}:${attempt}`;
        let run = runs.current.get(runKey);
        if (!run) {
            run = extensionRpc.sendRequest(AzureSqlDatabaseRequests.RunContainerProvisioningStep, {
                engine,
                step,
                form,
                retry: statusesRef.current[step] === ApiStatus.Error,
            });
            runs.current.set(runKey, run);
        }
        let cancelled = false;

        setStatuses((current) => ({ ...current, [step]: ApiStatus.Loading }));
        setError(undefined);
        setFullErrorText(undefined);
        setShowErrorDetails(false);
        onComplete(false);

        const runStep = async () => {
            try {
                const result = await run;
                if (cancelled) {
                    return;
                }
                if (!result.success) {
                    setStatuses((current) => ({ ...current, [step]: ApiStatus.Error }));
                    setError(result.error);
                    setFullErrorText(result.fullErrorText);
                    return;
                }
                setStatuses((current) => ({ ...current, [step]: ApiStatus.Loaded }));
                if (result.connectionString) {
                    setConnectionString(result.connectionString);
                }
                setCurrentStepIndex((index) => index + 1);
            } catch (requestError) {
                if (!cancelled) {
                    setStatuses((current) => ({ ...current, [step]: ApiStatus.Error }));
                    setError(
                        requestError instanceof Error ? requestError.message : String(requestError),
                    );
                }
            }
        };

        void runStep();
        return () => {
            cancelled = true;
        };
    }, [attempt, currentStepIndex, engine, extensionRpc, form, onComplete]);

    const failedStep = provisioningSteps.find((step) => statuses[step] === ApiStatus.Error);
    const stepContent = {
        [AzureSqlContainerProvisioningStep.PullImage]: {
            title: locConstants.azureSqlContainer.pullingContainerImage,
            description: locConstants.azureSqlContainer.pullingContainerImageDescription,
        },
        [AzureSqlContainerProvisioningStep.CreateContainer]: {
            title: locConstants.azureSqlContainer.creatingContainer,
            description: locConstants.azureSqlContainer.creatingContainerDescription,
        },
        [AzureSqlContainerProvisioningStep.WaitForReady]: {
            title: locConstants.azureSqlContainer.settingUpContainerStep,
            description: locConstants.azureSqlContainer.settingUpContainerDescription,
        },
        [AzureSqlContainerProvisioningStep.Connect]: {
            title: locConstants.azureSqlContainer.connectingToContainer,
            description: locConstants.azureSqlContainer.connectingToContainerDescription,
        },
    };

    return (
        <div className={classes.outer}>
            <span className={classes.heading}>
                {locConstants.azureSqlContainer.settingUpContainer(form.containerName)}
            </span>
            <div className={classes.detailsRow}>
                <span>{locConstants.azureSqlContainer.gettingContainerReady}</span>
                <Badge appearance="tint" icon={<Desktop20Regular />}>
                    {getContainerEngineDisplayName(engine)}
                </Badge>
            </div>
            {provisioningSteps.map((step) => (
                <DeploymentStepCard
                    key={step}
                    status={statuses[step]}
                    title={stepContent[step].title}>
                    {stepContent[step].description}
                    {step === failedStep && error && (
                        <div className={classes.errorDetails}>
                            <span>{error}</span>
                            {fullErrorText && (
                                <>
                                    <Link onClick={() => setShowErrorDetails((shown) => !shown)}>
                                        {showErrorDetails
                                            ? locConstants.azureSqlContainer.hideErrorDetails
                                            : locConstants.azureSqlContainer.showErrorDetails}
                                    </Link>
                                    {showErrorDetails && <span>{fullErrorText}</span>}
                                </>
                            )}
                        </div>
                    )}
                </DeploymentStepCard>
            ))}
            {failedStep && (
                <Button
                    className={classes.retryButton}
                    appearance="secondary"
                    onClick={() => setAttempt((value) => value + 1)}>
                    {locConstants.common.retry}
                </Button>
            )}
            {currentStepIndex >= provisioningSteps.length && (
                <>
                    {connectionString && (
                        <ConnectToDatabaseCard
                            className={classes.postDeploymentCard}
                            connectionString={connectionString}
                        />
                    )}
                    <WhatsNextCard className={classes.postDeploymentCard} />
                </>
            )}
        </div>
    );
};
