/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Dropdown,
    Field,
    makeStyles,
    MessageBar,
    MessageBarBody,
    mergeClasses,
    Option,
    Spinner,
    Text,
    tokens,
} from "@fluentui/react-components";
import { Warning20Regular } from "@fluentui/react-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    AzureSqlDatabaseRequests,
    ContainerEngine,
    ContainerEnginePrerequisite,
    ContainerEnginePrerequisiteResult,
    getContainerEnginePrerequisites,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import {
    DeploymentReducers,
    DeploymentWebviewState,
} from "../../../../sharedInterfaces/deployment";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { DeploymentStepCard } from "../deploymentStepCard";
import { ContainerEngineInstallOptions } from "./containerEngineInstallOptions";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        width: "100%",
    },
    dropdown: {
        maxWidth: "360px",
    },
    detectionStatus: {
        minHeight: "64px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    optionContent: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
    },
    unavailableOption: {
        color: tokens.colorNeutralForegroundDisabled,
    },
    warning: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        whiteSpace: "nowrap",
    },
    prerequisiteSection: {
        display: "flex",
        flexDirection: "column",
        gap: "0",
        width: "100%",
    },
    sectionTitle: {
        fontSize: "14px",
        fontWeight: 600,
        paddingBottom: "16px",
    },
});

export function getContainerEngineDisplayName(engine: ContainerEngine): string {
    switch (engine) {
        case ContainerEngine.Docker:
            return locConstants.azureSqlDatabase.docker;
        case ContainerEngine.Podman:
            return locConstants.azureSqlDatabase.podman;
        case ContainerEngine.Containerd:
            return locConstants.azureSqlDatabase.containerd;
        case ContainerEngine.AppleContainer:
            return locConstants.azureSqlDatabase.appleContainer;
        case ContainerEngine.WslContainer:
            return locConstants.azureSqlDatabase.wslContainer;
    }
}

function isContainerEngine(value: string): value is ContainerEngine {
    return Object.values(ContainerEngine).includes(value as ContainerEngine);
}

interface AzureSqlDatabaseContainerEnginePageProps {
    engine?: ContainerEngine;
    onEngineChange: (engine?: ContainerEngine) => void;
    onDetectionComplete: (detectedEngineCount: number) => void;
    onReadyChange: (isReady: boolean) => void;
}

export const AzureSqlDatabaseContainerEnginePage: React.FC<
    AzureSqlDatabaseContainerEnginePageProps
> = ({ engine, onEngineChange, onDetectionComplete, onReadyChange }) => {
    const classes = useStyles();
    const { extensionRpc } = useVscodeWebview<DeploymentWebviewState, DeploymentReducers>();
    const prerequisites = useMemo(
        () => (engine ? getContainerEnginePrerequisites(engine) : []),
        [engine],
    );
    const [detectionResults, setDetectionResults] =
        useState<Record<ContainerEngine, ContainerEnginePrerequisiteResult>>();
    const [detectionError, setDetectionError] = useState<string>();
    const [statuses, setStatuses] = useState<
        Partial<Record<ContainerEnginePrerequisite, ApiStatus>>
    >({});
    const [errors, setErrors] = useState<Partial<Record<ContainerEnginePrerequisite, string>>>({});
    const selectedEngineRef = useRef(engine);
    selectedEngineRef.current = engine;

    useEffect(() => {
        let cancelled = false;

        const detectEngines = async () => {
            try {
                const results = await extensionRpc.sendRequest(
                    AzureSqlDatabaseRequests.DetectContainerEngines,
                );
                if (cancelled) {
                    return;
                }

                setDetectionResults(results);
                const currentEngine = selectedEngineRef.current;
                const firstDetectedEngine = Object.values(ContainerEngine).find(
                    (candidate) => results[candidate].success,
                );
                const detectedEngineCount = Object.values(results).filter(
                    (result) => result.success,
                ).length;
                onDetectionComplete(detectedEngineCount);
                onEngineChange(
                    currentEngine && results[currentEngine].success
                        ? currentEngine
                        : firstDetectedEngine,
                );
            } catch (error) {
                if (!cancelled) {
                    setDetectionError(error instanceof Error ? error.message : String(error));
                }
            }
        };

        void detectEngines();
        return () => {
            cancelled = true;
        };
    }, [extensionRpc, onDetectionComplete, onEngineChange]);

    useEffect(() => {
        if (!engine || !detectionResults?.[engine].success) {
            setStatuses({});
            setErrors({});
            onReadyChange(false);
            return;
        }

        let cancelled = false;
        setStatuses({
            [ContainerEnginePrerequisite.Installation]: ApiStatus.Loaded,
        });
        setErrors({});
        onReadyChange(false);

        const runChecks = async () => {
            for (const prerequisite of prerequisites.slice(1)) {
                if (cancelled) {
                    return;
                }

                setStatuses((current) => ({
                    ...current,
                    [prerequisite]: ApiStatus.Loading,
                }));

                try {
                    const result = await extensionRpc.sendRequest(
                        AzureSqlDatabaseRequests.CheckContainerEnginePrerequisite,
                        { engine, prerequisite },
                    );

                    if (cancelled) {
                        return;
                    }

                    setStatuses((current) => ({
                        ...current,
                        [prerequisite]: result.success ? ApiStatus.Loaded : ApiStatus.Error,
                    }));
                    if (!result.success) {
                        setErrors((current) => ({
                            ...current,
                            [prerequisite]: result.error,
                        }));
                        return;
                    }
                } catch (error) {
                    if (cancelled) {
                        return;
                    }

                    setStatuses((current) => ({
                        ...current,
                        [prerequisite]: ApiStatus.Error,
                    }));
                    setErrors((current) => ({
                        ...current,
                        [prerequisite]: error instanceof Error ? error.message : String(error),
                    }));
                    return;
                }
            }

            onReadyChange(true);
        };

        void runChecks();
        return () => {
            cancelled = true;
        };
    }, [detectionResults, engine, extensionRpc, onReadyChange, prerequisites]);

    const engineName = engine ? getContainerEngineDisplayName(engine) : "";
    const detectedEngineCount = detectionResults
        ? Object.values(detectionResults).filter((result) => result.success).length
        : 0;
    const getStepTitle = (prerequisite: ContainerEnginePrerequisite) => {
        switch (prerequisite) {
            case ContainerEnginePrerequisite.Installation:
                return locConstants.azureSqlDatabase.checkingIfContainerEngineIsInstalled(
                    engineName,
                );
            case ContainerEnginePrerequisite.Running:
                return locConstants.azureSqlDatabase.checkingIfContainerEngineIsStarted(engineName);
            case ContainerEnginePrerequisite.Configuration:
                return locConstants.azureSqlDatabase.checkingContainerEngineConfiguration(
                    engineName,
                );
        }
    };

    if (detectionError) {
        return (
            <MessageBar intent="error">
                <MessageBarBody>
                    {locConstants.azureSqlDatabase.containerEngineDetectionFailed} {detectionError}
                </MessageBarBody>
            </MessageBar>
        );
    }

    if (!detectionResults) {
        return (
            <div className={classes.detectionStatus}>
                <Spinner
                    label={locConstants.azureSqlDatabase.detectingContainerEngines}
                    labelPosition="below"
                />
            </div>
        );
    }

    if (detectedEngineCount === 0 || detectedEngineCount !== 0) {
        return <ContainerEngineInstallOptions />;
    }

    return (
        <div className={classes.outerDiv}>
            <Field label={locConstants.azureSqlDatabase.enginesDetected(detectedEngineCount)}>
                <Dropdown
                    className={classes.dropdown}
                    value={engineName}
                    selectedOptions={engine ? [engine] : []}
                    placeholder={locConstants.azureSqlDatabase.selectContainerEngine}
                    onOptionSelect={(_event, data) => {
                        if (data.optionValue && isContainerEngine(data.optionValue)) {
                            onEngineChange(data.optionValue);
                        }
                    }}>
                    {Object.values(ContainerEngine).map((option) => {
                        const isDetected = detectionResults[option].success;
                        const displayName = getContainerEngineDisplayName(option);
                        return (
                            <Option
                                key={option}
                                value={option}
                                text={displayName}
                                disabled={!isDetected}>
                                <div
                                    className={mergeClasses(
                                        classes.optionContent,
                                        !isDetected && classes.unavailableOption,
                                    )}>
                                    <span>{displayName}</span>
                                    {!isDetected && (
                                        <span className={classes.warning}>
                                            <Warning20Regular aria-hidden="true" />
                                            <Text>
                                                {locConstants.azureSqlDatabase.engineNotDetected}
                                            </Text>
                                        </span>
                                    )}
                                </div>
                            </Option>
                        );
                    })}
                </Dropdown>
            </Field>
            {engine && (
                <section className={classes.prerequisiteSection}>
                    <div className={classes.sectionTitle}>
                        {locConstants.azureSqlDatabase.checkingPrerequisites}
                    </div>
                    {prerequisites.map((prerequisite) => (
                        <DeploymentStepCard
                            key={prerequisite}
                            status={statuses[prerequisite] ?? ApiStatus.NotStarted}
                            title={getStepTitle(prerequisite)}>
                            {errors[prerequisite]}
                        </DeploymentStepCard>
                    ))}
                </section>
            )}
        </div>
    );
};
