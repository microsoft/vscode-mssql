/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, MessageBar, MessageBarBody, Text } from "@fluentui/react-components";
import { useCallback, useContext, useEffect, useState } from "react";
import { Wizard, WizardPageDefinition } from "../../../common/wizard";
import { DockerIcon } from "../../../common/icons/docker";
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
import { getSqlPasswordValidationError } from "../../../../sharedInterfaces/sqlPassword";
import { AzureSqlDatabaseContainerProvisioningPage } from "./azureSqlDatabaseContainerProvisioningPage";

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
        port: "1433",
        hostname: "",
        acceptEula: false,
    }));
    const [formErrors, setFormErrors] = useState<AzureSqlContainerFormErrors>({});
    const [isValidating, setIsValidating] = useState(false);
    const [validationError, setValidationError] = useState<string>();
    const [containerEngine, setContainerEngine] = useState<ContainerEngine>();
    const [detectedEngineCount, setDetectedEngineCount] = useState<number>();
    const [arePrerequisitesReady, setArePrerequisitesReady] = useState(false);
    const [isProvisioningComplete, setIsProvisioningComplete] = useState(false);
    const handlePrerequisitesReadyChange = useCallback((isReady: boolean) => {
        setArePrerequisitesReady(isReady);
    }, []);
    const handleCancel = useCallback(async () => {
        try {
            await extensionRpc.sendRequest(AzureSqlDatabaseRequests.CancelContainerProvisioning);
        } catch (error) {
            extensionRpc.log.error("Failed to cancel Azure SQL container provisioning", error);
        } finally {
            context?.dispose();
        }
    }, [context, extensionRpc]);

    useEffect(() => {
        if (!arePrerequisitesReady) {
            return;
        }

        let cancelled = false;

        const generateContainerName = async () => {
            try {
                const containerName = await extensionRpc.sendRequest(
                    AzureSqlDatabaseRequests.GenerateContainerName,
                );
                if (!cancelled && containerName) {
                    setForm((current) =>
                        current.containerName ? current : { ...current, containerName },
                    );
                }
            } catch (error) {
                extensionRpc.log.error("Failed to generate an Azure SQL container name", error);
            }
        };

        void generateContainerName();
        return () => {
            cancelled = true;
        };
    }, [arePrerequisitesReady, extensionRpc]);

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
                                {locConstants.azureSqlContainer.validationFailed} {validationError}
                            </MessageBarBody>
                        </MessageBar>
                    )}
                    <AzureSqlDatabaseContainerFormPage
                        form={form}
                        errors={formErrors}
                        disabled={isValidating}
                        onChange={(nextForm) => {
                            setForm(nextForm);
                            setFormErrors({});
                            setValidationError(undefined);
                        }}
                    />
                </>
            ),
            canGoBack: !isValidating,
            canGoNext:
                !isValidating && !getSqlPasswordValidationError(form.password) && form.acceptEula,
            onNext: async () => {
                setIsValidating(true);
                setValidationError(undefined);
                try {
                    const errors = await extensionRpc.sendRequest(
                        AzureSqlDatabaseRequests.ValidateContainerForm,
                        form,
                    );
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
            title: locConstants.azureSqlDatabase.developerContainer,
            render: () =>
                containerEngine ? (
                    <AzureSqlDatabaseContainerProvisioningPage
                        engine={containerEngine}
                        form={form}
                        onComplete={setIsProvisioningComplete}
                    />
                ) : (
                    placeholderPage()
                ),
            canGoBack: false,
            canGoNext: isProvisioningComplete,
            onNext: () => {
                context.dispose();
                return false;
            },
        },
    ];

    return (
        <Wizard
            icon={<DockerIcon aria-hidden="true" />}
            title={locConstants.azureSqlDatabase.localContainerWizardTitle}
            pages={pages}
            onCancel={() => void handleCancel()}
            maxContentWidth="wide"
        />
    );
};
