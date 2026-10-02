/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, MessageBar, MessageBarBody, Text } from "@fluentui/react-components";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Wizard, WizardPageDefinition } from "../../../common/wizard";
import azureSqlContainerIcon from "../../../media/azureSqlContainer.svg";
import { locConstants } from "../../../common/locConstants";
import { DeploymentContext } from "../deploymentStateProvider";
import { AzureSqlDatabaseLocalContainerInfoPage } from "./azureSqlDatabaseLocalContainerInfoPage";
import {
    AzureSqlDatabaseContainerEnginePage,
    getContainerEngineDisplayName,
} from "./azureSqlDatabaseContainerEnginePage";
import {
    AzureSqlContainerForm,
    AzureSqlContainerFormErrors,
    AzureSqlDatabaseRequests,
    ContainerEngine,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import {
    DeploymentReducers,
    DeploymentWebviewState,
} from "../../../../sharedInterfaces/deployment";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { useDeploymentSelector } from "../deploymentSelector";
import { AzureSqlDatabaseContainerFormPage } from "./azureSqlDatabaseContainerFormPage";
import { getSqlPasswordValidationError } from "../../../../utils/sqlStringUtils";
import { AzureSqlDatabaseContainerProvisioningPage } from "./azureSqlDatabaseContainerProvisioningPage";
import { ContainerDeploymentError } from "./containerDeploymentError";
import { ApiStatus } from "../../../../sharedInterfaces/webview";

const useStyles = makeStyles({
    placeholder: {
        minHeight: "240px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
});

interface AzureSqlDatabaseLocalContainerWizardProps {
    onBackToDeploymentType: () => void;
}

export const AzureSqlDatabaseLocalContainerWizard: React.FC<
    AzureSqlDatabaseLocalContainerWizardProps
> = ({ onBackToDeploymentType }) => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const { extensionRpc } = useVscodeWebview<DeploymentWebviewState, DeploymentReducers>();
    const groups = useDeploymentSelector((s) => s.connectionGroupOptions);
    const initialGroupId = useDeploymentSelector((s) => s.formState.groupId);
    const [form, setForm] = useState<AzureSqlContainerForm>(() => ({
        password: "",
        savePassword: false,
        profileName: "",
        groupId: initialGroupId ?? groups[0]?.value ?? "",
        containerName: "",
        port: "",
        hostname: "",
        acceptEula: false,
    }));
    const [formErrors, setFormErrors] = useState<AzureSqlContainerFormErrors>({});
    const [isValidating, setIsValidating] = useState(false);
    const [validationError, setValidationError] = useState<string>();
    const [containerEngine, setContainerEngine] = useState<ContainerEngine>();
    const [detectedEngineCount, setDetectedEngineCount] = useState<number>();
    const [arePrerequisitesReady, setArePrerequisitesReady] = useState(false);
    const [provisioningStatus, setProvisioningStatus] = useState(ApiStatus.NotStarted);
    const [isPortValidating, setIsPortValidating] = useState(false);
    const [isLoadingDefaults, setIsLoadingDefaults] = useState(false);
    const [isCancelling, setIsCancelling] = useState(false);
    const portEditedRef = useRef(false);
    const handlePrerequisitesReadyChange = useCallback((isReady: boolean) => {
        setArePrerequisitesReady(isReady);
    }, []);
    const handleCancel = useCallback(async () => {
        if (isCancelling) {
            return;
        }
        setIsCancelling(true);
        try {
            await extensionRpc.sendRequest(AzureSqlDatabaseRequests.CancelContainerProvisioning);
        } catch (error) {
            extensionRpc.log.error("Failed to cancel Azure SQL container provisioning", error);
        } finally {
            context?.dispose();
        }
    }, [context, extensionRpc, isCancelling]);

    useEffect(() => {
        if (!arePrerequisitesReady || !containerEngine) {
            return;
        }

        let cancelled = false;
        setIsLoadingDefaults(true);

        const generateContainerDefaults = async () => {
            try {
                await Promise.all([
                    extensionRpc
                        .sendRequest(AzureSqlDatabaseRequests.GenerateContainerName)
                        .then((containerName) => {
                            if (!cancelled) {
                                setForm((current) => ({
                                    ...current,
                                    containerName: current.containerName || containerName,
                                }));
                            }
                        }),
                    extensionRpc
                        .sendRequest(AzureSqlDatabaseRequests.GenerateContainerPort, {
                            engine: containerEngine,
                            startPort: 1433,
                        })
                        .then((port) => {
                            if (!cancelled && !portEditedRef.current) {
                                setForm((current) => ({ ...current, port: String(port) }));
                            }
                        }),
                ]);
            } catch (error) {
                extensionRpc.log.error("Failed to generate Azure SQL container defaults", error);
                if (!cancelled) {
                    setValidationError(error instanceof Error ? error.message : String(error));
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingDefaults(false);
                }
            }
        };

        void generateContainerDefaults();
        return () => {
            cancelled = true;
        };
    }, [arePrerequisitesReady, containerEngine, extensionRpc]);

    useEffect(() => {
        if (!arePrerequisitesReady || !containerEngine) {
            return;
        }

        let cancelled = false;
        setIsPortValidating(true);
        const timeout = setTimeout(() => {
            void extensionRpc
                .sendRequest(AzureSqlDatabaseRequests.ValidateContainerPort, {
                    engine: containerEngine,
                    port: form.port,
                })
                .then((portError) => {
                    if (!cancelled) {
                        setFormErrors((current) => ({
                            ...current,
                            port: portError,
                        }));
                    }
                })
                .catch((error) => {
                    extensionRpc.log.error("Failed to validate Azure SQL container port", error);
                })
                .finally(() => {
                    if (!cancelled) {
                        setIsPortValidating(false);
                    }
                });
        }, 300);

        return () => {
            cancelled = true;
            clearTimeout(timeout);
        };
    }, [arePrerequisitesReady, containerEngine, extensionRpc, form.port]);

    if (!context) {
        return undefined;
    }

    const placeholderPage = () => (
        <div className={classes.placeholder}>
            <Text size={500}>{locConstants.azureSqlDatabase.localContainerTbd}</Text>
        </div>
    );

    const pages: WizardPageDefinition[] = [
        {
            id: "local-container-info",
            title: locConstants.azureSqlDatabase.developerContainer,
            render: () => <AzureSqlDatabaseLocalContainerInfoPage />,
            nextLabel: locConstants.common.next,
            onPrevious: () => {
                onBackToDeploymentType();
                return false;
            },
        },
        {
            id: "local-container-prerequisites",
            title:
                detectedEngineCount === 0
                    ? locConstants.azureSqlDatabase.noContainerEngineFound
                    : locConstants.azureSqlDatabase.gettingContainerEngineReady(
                          containerEngine
                              ? getContainerEngineDisplayName(containerEngine)
                              : locConstants.azureSqlDatabase.containerEngine,
                      ),
            render: () => (
                <AzureSqlDatabaseContainerEnginePage
                    engine={containerEngine}
                    onEngineChange={setContainerEngine}
                    onDetectionComplete={setDetectedEngineCount}
                    onReadyChange={handlePrerequisitesReadyChange}
                />
            ),
            canGoNext: arePrerequisitesReady,
        },
        {
            id: "local-container-configuration",
            title: locConstants.azureSqlDatabase.developerContainer,
            render: () => (
                <>
                    {validationError && (
                        <MessageBar intent="error">
                            <MessageBarBody>
                                <ContainerDeploymentError
                                    message={locConstants.azureSqlContainer.validationFailed}
                                    fullErrorText={validationError}
                                />
                            </MessageBarBody>
                        </MessageBar>
                    )}
                    <AzureSqlDatabaseContainerFormPage
                        form={form}
                        errors={formErrors}
                        disabled={isValidating}
                        onChange={(nextForm) => {
                            if (nextForm.port !== form.port) {
                                portEditedRef.current = true;
                            }
                            setForm(nextForm);
                            setFormErrors((current) => ({ port: current.port }));
                            setValidationError(undefined);
                        }}
                    />
                </>
            ),
            canGoBack: !isValidating,
            canGoNext:
                !isValidating &&
                !isLoadingDefaults &&
                !isPortValidating &&
                !formErrors.port &&
                !getSqlPasswordValidationError(form.password) &&
                form.acceptEula,
            onNext: async () => {
                setIsValidating(true);
                setValidationError(undefined);
                try {
                    const { form: preparedForm, errors } = await extensionRpc.sendRequest(
                        AzureSqlDatabaseRequests.PrepareContainerForm,
                        form,
                    );
                    setForm(preparedForm);
                    setFormErrors(errors);
                    return Object.keys(errors).length === 0;
                } catch (error) {
                    setValidationError(error instanceof Error ? error.message : String(error));
                    return false;
                } finally {
                    setIsValidating(false);
                }
            },
        },
        {
            id: "local-container-provisioning",
            title: locConstants.localContainers.settingUp,
            render: () =>
                containerEngine ? (
                    <AzureSqlDatabaseContainerProvisioningPage
                        engine={containerEngine}
                        form={form}
                        onStatusChange={setProvisioningStatus}
                    />
                ) : (
                    placeholderPage()
                ),
            canGoBack: provisioningStatus === ApiStatus.Error,
            canGoNext: provisioningStatus === ApiStatus.Loaded,
            onPrevious: () => setProvisioningStatus(ApiStatus.NotStarted),
            onNext: () => {
                context.dispose();
                return false;
            },
        },
    ];

    return (
        <Wizard
            icon={<img src={azureSqlContainerIcon} alt="" aria-hidden="true" />}
            title={locConstants.azureSqlDatabase.localContainerWizardTitle}
            pages={pages}
            onCancel={() => void handleCancel()}
            isCancelling={isCancelling}
            maxContentWidth="wide"
        />
    );
};
