/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureSqlDatabaseRequests,
    ContainerEngine,
    ContainerEnginePrerequisite,
    ContainerEnginePrerequisiteResult,
    AzureSqlContainerForm,
    AzureSqlContainerFormErrors,
    AzureSqlContainerProvisioningResult,
    AzureSqlContainerProvisioningStep,
    getAzureSqlContainerProvisioningSteps,
    ContainerCertificateFiles,
    isAzureSqlContainerEntraAuthentication,
} from "../sharedInterfaces/azureSqlDatabase";
import { getErrorMessage } from "../utils/utils";
import { DeploymentWebviewController } from "./deploymentWebviewController";
import { validateSqlServerPassword } from "./sqlServerContainer";
import { Accounts, AzureSqlContainer, ConnectionDialog } from "../constants/locConstants";
import * as dockerUtils from "../docker/dockerUtils";
import { defaultPortNumber, localhost, sa, sqlAuthentication } from "../constants/constants";
import { ConnectionProfile } from "../models/connectionProfile";
import MainController from "../controllers/mainController";
import { Deferred } from "../protocol";
import {
    completeProvisioningTask,
    startProvisioningTask,
    updateProvisioningTask,
} from "./deploymentBackgroundTasks";
import { DeploymentType } from "../sharedInterfaces/deployment";
import { BackgroundTaskState } from "../backgroundTasks/backgroundTasksService";
import {
    isValidPortNumber,
    validatePort,
    waitForContainerConnection,
    waitForContainerDelay,
} from "./localContainersHelpers";
import {
    executeContainerEngineCommand,
    getContainerEngineExecutable,
} from "../docker/containerEngine";
import { AuthenticationType } from "../sharedInterfaces/connectionDialog";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import { graphClient } from "../azure/graphClient";
import * as vscode from "vscode";
import * as path from "node:path";
import { createPrivateKey, KeyObject, randomBytes, X509Certificate } from "node:crypto";
import * as fs from "node:fs/promises";
import * as asn1 from "asn1js";
import {
    Attribute,
    AttributeTypeAndValue,
    AuthenticatedSafe,
    BasicConstraints,
    CertBag,
    Certificate,
    ContentInfo,
    CryptoEngine,
    EncryptedContentInfo,
    EncryptedData,
    Extension,
    ExtKeyUsage,
    PFX,
    PKCS8ShroudedKeyBag,
    PrivateKeyInfo,
    SafeBag,
    SafeContents,
} from "pkijs";
export { executeContainerEngineCommand } from "../docker/containerEngine";

export const defaultAzureSqlContainerName = "azure_sql_db_container";
export const azureSqlContainerImage =
    // "sqldbpreview-dpgaeqhmgphzd4bk.azurecr.io/azure-sql/db-dev:latest";
    // "sqlbuilds.azurecr.io/mssql-p-sqldbdev-daily/azure-sql/db-dev:latest";
    "sqlbuilds.azurecr.io/mssql-p-adhoc/azure-sql/db-dev:18.0.343.0_322-preview";
const containerReadyTimeoutMs = 300_000;
const containerReadyPollIntervalMs = 2_000;
const containerEntraCertificatePath = "/var/opt/mssql/mssql-entra-id.pfx";

interface ContainerEntraAdministrator {
    id: string;
    name: string;
}

interface ContainerEntraState {
    administrator?: ContainerEntraAdministrator;
    certificateThumbprint?: string;
    identity?: string;
}

interface AzureSqlContainerDeployment {
    entraState: ContainerEntraState;
    abortController: AbortController;
    promise: Promise<void>;
    stepResults: Map<AzureSqlContainerProvisioningStep, AzureSqlContainerProvisioningResult>;
    stepCompletions: Map<
        AzureSqlContainerProvisioningStep,
        Deferred<AzureSqlContainerProvisioningResult>
    >;
}

const azureSqlContainerDeployments = new WeakMap<
    DeploymentWebviewController,
    AzureSqlContainerDeployment
>();

interface PrerequisiteCommand {
    executable: string;
    args: string[];
    env?: NodeJS.ProcessEnv;
}

const prerequisiteCommands: Record<
    ContainerEngine,
    Partial<Record<ContainerEnginePrerequisite, PrerequisiteCommand>>
> = {
    [ContainerEngine.Docker]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "docker",
            args: ["--version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "docker",
            args: ["info"],
        },
        [ContainerEnginePrerequisite.Configuration]: {
            executable: "docker",
            args: ["info", "--format", "{{.OSType}}"],
        },
    },
    [ContainerEngine.Podman]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "podman",
            args: ["--version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "podman",
            args: ["info"],
        },
    },
    [ContainerEngine.Containerd]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "nerdctl",
            args: ["--version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "nerdctl",
            args: ["info"],
        },
    },
    [ContainerEngine.AppleContainer]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "container",
            args: ["--version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "container",
            args: ["system", "status"],
        },
    },
    [ContainerEngine.WslContainer]: {
        [ContainerEnginePrerequisite.Installation]: {
            executable: "wslc",
            args: ["version"],
        },
        [ContainerEnginePrerequisite.Running]: {
            executable: "wslc",
            args: ["container", "list"],
        },
    },
};

export function registerAzureSqlRpcHandlers(
    deploymentController: DeploymentWebviewController,
): void {
    const getEntraAccount = async (accountId: string, tenantId: string) => {
        if (!tenantId) {
            throw new Error(ConnectionDialog.tenantIdIsRequired);
        }
        const account = await VsCodeAzureHelper.getAccountById(accountId);
        if (!account) {
            throw new Error(Accounts.accountNotAvailableThroughVsCode(accountId, tenantId));
        }
        return account;
    };
    const validateForm = (form: AzureSqlContainerForm) => {
        const errors = validateAzureSqlContainerForm(form);
        if (
            !deploymentController.state.connectionGroupOptions.some(
                (group) => group.value === form.groupId,
            )
        ) {
            errors.groupId = AzureSqlContainer.selectConnectionGroup;
        }
        return errors;
    };
    deploymentController.onRequest(AzureSqlDatabaseRequests.ValidateContainerForm, validateForm);
    deploymentController.onRequest(
        AzureSqlDatabaseRequests.ContainerEntraAccounts,
        async ({ signIn }) => {
            if (signIn) {
                await VsCodeAzureHelper.signIn(true);
            }
            const accounts = await VsCodeAzureHelper.getAccounts();
            return accounts.map((account) => ({
                value: account.id,
                displayName: account.label,
            }));
        },
    );
    deploymentController.onRequest(
        AzureSqlDatabaseRequests.ContainerEntraTenants,
        async ({ accountId }) => {
            const tenants = await VsCodeAzureHelper.getTenantsForAccount(accountId);
            return tenants.map((tenant) => ({
                value: tenant.tenantId,
                displayName: tenant.displayName,
            }));
        },
    );
    deploymentController.onRequest(AzureSqlDatabaseRequests.PrepareContainerForm, async (form) => {
        const result = await prepareAzureSqlContainerForm(form);
        return {
            form: result.form,
            errors: { ...validateForm(result.form), ...result.errors },
        };
    });

    deploymentController.onRequest(AzureSqlDatabaseRequests.SelectContainerPfxFile, async () => {
        const selection = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: AzureSqlContainer.selectPfxFile,
            filters: { [AzureSqlContainer.pfxFiles]: ["pfx"] },
        });
        return selection?.[0]?.fsPath;
    });
    deploymentController.onRequest(
        AzureSqlDatabaseRequests.GenerateContainerCertificateFiles,
        async () => {
            const target = await vscode.window.showSaveDialog({
                saveLabel: AzureSqlContainer.savePfxFile,
                filters: { [AzureSqlContainer.pfxFiles]: ["pfx"] },
            });
            if (!target) {
                return undefined;
            }
            if (target.scheme !== "file") {
                throw new Error(AzureSqlContainer.localCertificateLocationRequired);
            }
            const pfxFilePath = path.extname(target.fsPath)
                ? target.fsPath
                : `${target.fsPath}.pfx`;
            const files = await generateContainerCertificateFiles(pfxFilePath);
            void vscode.window.showInformationMessage(
                AzureSqlContainer.certificateFilesSaved(
                    files.pfxFilePath,
                    files.privateKeyFilePath,
                    files.publicCertificateFilePath,
                ),
            );
            return files;
        },
    );
    deploymentController.onRequest(
        AzureSqlDatabaseRequests.ContainerEntraApplications,
        async ({ accountId, tenantId }) => {
            const account = await getEntraAccount(accountId, tenantId);
            const applications = await graphClient.fetchAppRegistrations(account, tenantId);
            return applications.map((application) => ({
                value: application.appId,
                displayName: application.displayName || application.appId,
            }));
        },
    );
    deploymentController.onRequest(
        AzureSqlDatabaseRequests.CreateContainerEntraApplication,
        async ({ accountId, tenantId, displayName }) => {
            const account = await getEntraAccount(accountId, tenantId);
            const application = await graphClient.createAppRegistration(
                displayName,
                account,
                tenantId,
            );
            return {
                value: application.appId,
                displayName: application.displayName || application.appId,
            };
        },
    );

    deploymentController.onRequest(
        AzureSqlDatabaseRequests.ValidateContainerPort,
        async ({ port }) => {
            if (port && !isValidPortNumber(port)) {
                return AzureSqlContainer.invalidPort;
            }
            return (await validatePort(port)) ? undefined : AzureSqlContainer.portInUse;
        },
    );

    deploymentController.onRequest(
        AzureSqlDatabaseRequests.GenerateContainerPort,
        async ({ startPort = defaultPortNumber }) => {
            const port = await dockerUtils.findAvailablePort(startPort);
            if (port <= 0) {
                throw new Error(AzureSqlContainer.portDetectionFailed);
            }
            return port;
        },
    );

    deploymentController.onRequest(AzureSqlDatabaseRequests.GenerateContainerName, async () =>
        generateAzureSqlContainerName(),
    );

    deploymentController.onRequest(AzureSqlDatabaseRequests.DetectContainerEngines, async () =>
        detectContainerEngines(),
    );

    deploymentController.onRequest(
        AzureSqlDatabaseRequests.CheckContainerEnginePrerequisite,
        async (payload) => checkContainerEnginePrerequisite(payload.engine, payload.prerequisite),
    );

    deploymentController.onRequest(
        AzureSqlDatabaseRequests.RunContainerProvisioningStep,
        async (payload) => {
            if (
                !getAzureSqlContainerProvisioningSteps(payload.form.authenticationType).includes(
                    payload.step,
                )
            ) {
                return { success: false, error: AzureSqlContainer.invalidProvisioningStep };
            }
            let deployment = azureSqlContainerDeployments.get(deploymentController);
            if (payload.retry && deployment) {
                await deployment.promise;
                deployment = startAzureSqlContainerDeployment(
                    deploymentController,
                    payload.engine,
                    payload.form,
                    payload.step,
                    deployment.stepResults,
                    deployment.entraState,
                );
            } else if (!deployment) {
                deployment = startAzureSqlContainerDeployment(
                    deploymentController,
                    payload.engine,
                    payload.form,
                    payload.step,
                );
            }
            return deployment.stepCompletions.get(payload.step)!.promise;
        },
    );

    deploymentController.onRequest(AzureSqlDatabaseRequests.CancelContainerProvisioning, async () =>
        cancelAzureSqlContainerProvisioning(deploymentController),
    );
}

export async function prepareAzureSqlContainerForm(
    form: AzureSqlContainerForm,
): Promise<{ form: AzureSqlContainerForm; errors: AzureSqlContainerFormErrors }> {
    const preparedForm = { ...form };
    let portError: string | undefined;
    if (!preparedForm.port) {
        const port = await dockerUtils.findAvailablePort(defaultPortNumber);
        if (port > 0) {
            preparedForm.port = String(port);
        } else {
            portError = AzureSqlContainer.portDetectionFailed;
        }
    }
    const errors = validateAzureSqlContainerForm(preparedForm);
    if (portError) {
        errors.port = portError;
    } else if (form.port && !errors.port && !(await validatePort(preparedForm.port))) {
        errors.port = AzureSqlContainer.portInUse;
    }
    return { form: preparedForm, errors };
}

export async function cancelAzureSqlContainerProvisioning(
    deploymentController: DeploymentWebviewController,
): Promise<void> {
    const deployment = azureSqlContainerDeployments.get(deploymentController);
    if (!deployment) {
        return;
    }

    deployment.abortController.abort();
    await deployment.promise;
}

function getProvisioningStepMessage(step: AzureSqlContainerProvisioningStep): string {
    switch (step) {
        case AzureSqlContainerProvisioningStep.PullImage:
            return AzureSqlContainer.pullingContainerImage;
        case AzureSqlContainerProvisioningStep.UploadCertificate:
            return AzureSqlContainer.uploadingCertificate;
        case AzureSqlContainerProvisioningStep.CreateContainer:
            return AzureSqlContainer.creatingContainer;
        case AzureSqlContainerProvisioningStep.WaitForReady:
            return AzureSqlContainer.settingUpContainer;
        case AzureSqlContainerProvisioningStep.Connect:
            return AzureSqlContainer.connectingToContainer;
    }
}

function startAzureSqlContainerDeployment(
    deploymentController: DeploymentWebviewController,
    engine: ContainerEngine,
    form: AzureSqlContainerForm,
    startStep: AzureSqlContainerProvisioningStep,
    previousResults?: Map<AzureSqlContainerProvisioningStep, AzureSqlContainerProvisioningResult>,
    entraState: ContainerEntraState = {},
): AzureSqlContainerDeployment {
    const containerProvisioningSteps = getAzureSqlContainerProvisioningSteps(
        form.authenticationType,
    );
    const abortController = new AbortController();
    const stepResults = new Map(previousResults);
    const stepCompletions = new Map<
        AzureSqlContainerProvisioningStep,
        Deferred<AzureSqlContainerProvisioningResult>
    >();
    const startIndex = containerProvisioningSteps.indexOf(startStep);

    for (const [index, step] of containerProvisioningSteps.entries()) {
        const completion = new Deferred<AzureSqlContainerProvisioningResult>();
        stepCompletions.set(step, completion);
        if (index < startIndex) {
            completion.resolve(stepResults.get(step) ?? { success: true });
        }
    }

    const deployment = {
        entraState,
        abortController,
        stepResults,
        stepCompletions,
        promise: Promise.resolve(),
    };
    azureSqlContainerDeployments.set(deploymentController, deployment);
    deployment.promise = runAzureSqlContainerDeployment(
        deploymentController,
        engine,
        form,
        startStep,
        abortController.signal,
        (step, result) => {
            stepResults.set(step, result);
            stepCompletions.get(step)?.resolve(result);
        },
        undefined,
        entraState,
    );
    return deployment;
}

export async function runAzureSqlContainerDeployment(
    deploymentController: DeploymentWebviewController,
    engine: ContainerEngine,
    form: AzureSqlContainerForm,
    startStep: AzureSqlContainerProvisioningStep,
    signal: AbortSignal,
    onStepComplete: (
        step: AzureSqlContainerProvisioningStep,
        result: AzureSqlContainerProvisioningResult,
    ) => void,
    executeStep = runAzureSqlContainerProvisioningStep,
    entraState: ContainerEntraState = {},
): Promise<void> {
    const containerProvisioningSteps = getAzureSqlContainerProvisioningSteps(
        form.authenticationType,
    );
    const startIndex = containerProvisioningSteps.indexOf(startStep);
    let currentStep = startStep;
    try {
        if (startIndex < 0) {
            throw new Error(AzureSqlContainer.invalidProvisioningStep);
        }
        startProvisioningTask(
            deploymentController,
            DeploymentType.AzureSqlDatabase,
            AzureSqlContainer.provisioningTask,
            form.containerName,
        );

        for (const step of containerProvisioningSteps.slice(startIndex)) {
            currentStep = step;
            updateProvisioningTask(
                deploymentController,
                DeploymentType.AzureSqlDatabase,
                getProvisioningStepMessage(step),
            );
            const result = await executeStep(
                engine,
                step,
                form,
                deploymentController.mainController,
                signal,
                entraState,
            );
            onStepComplete(step, result);

            if (!result.success) {
                const canceled = signal.aborted;
                completeProvisioningTask(
                    deploymentController,
                    DeploymentType.AzureSqlDatabase,
                    canceled ? BackgroundTaskState.Canceled : BackgroundTaskState.Failed,
                    canceled
                        ? AzureSqlContainer.provisioningTaskCanceled(form.containerName)
                        : AzureSqlContainer.provisioningTaskFailed(
                              form.containerName,
                              result.error ?? AzureSqlContainer.createContainerFailed,
                          ),
                );
                return;
            }
        }
    } catch (error) {
        const errorMessage = sanitizeProvisioningError(error, form);
        onStepComplete(currentStep, {
            success: false,
            error: errorMessage,
            fullErrorText: errorMessage,
        });
        completeProvisioningTask(
            deploymentController,
            DeploymentType.AzureSqlDatabase,
            signal.aborted ? BackgroundTaskState.Canceled : BackgroundTaskState.Failed,
            signal.aborted
                ? AzureSqlContainer.provisioningTaskCanceled(form.containerName)
                : AzureSqlContainer.provisioningTaskFailed(form.containerName, errorMessage),
        );
        return;
    }

    completeProvisioningTask(
        deploymentController,
        DeploymentType.AzureSqlDatabase,
        BackgroundTaskState.Succeeded,
        AzureSqlContainer.provisioningTaskSucceeded(form.containerName),
    );
}

export async function generateAzureSqlContainerName(): Promise<string> {
    return dockerUtils.validateContainerName("", defaultAzureSqlContainerName);
}

export function validateAzureSqlContainerForm(
    form: AzureSqlContainerForm,
): AzureSqlContainerFormErrors {
    const errors: AzureSqlContainerFormErrors = {};
    if (isAzureSqlContainerEntraAuthentication(form.authenticationType)) {
        if (!form.accountId) {
            errors.accountId = AzureSqlContainer.selectEntraAccount;
        }
        if (!form.tenantId) {
            errors.tenantId = ConnectionDialog.tenantIdIsRequired;
        }
        if (!form.applicationId) {
            errors.applicationId = AzureSqlContainer.selectAppRegistration;
        }
        if (
            !form.pfxFilePath ||
            !path.isAbsolute(form.pfxFilePath) ||
            path.extname(form.pfxFilePath).toLowerCase() !== ".pfx"
        ) {
            errors.pfxFilePath = AzureSqlContainer.pfxFileRequired;
        }
        if (
            form.authenticationType === AuthenticationType.ActiveDirectoryServicePrincipal &&
            !form.servicePrincipalClientSecret?.trim()
        ) {
            errors.servicePrincipalClientSecret =
                AzureSqlContainer.servicePrincipalClientSecretRequired;
        }
    } else if (
        form.authenticationType !== undefined &&
        form.authenticationType !== AuthenticationType.SqlLogin
    ) {
        errors.authenticationType = AzureSqlContainer.invalidAuthenticationType;
    }
    const passwordError = validateSqlServerPassword(form.password);
    if (passwordError) {
        errors.password = passwordError;
    }
    if (!isValidPortNumber(form.port)) {
        errors.port = AzureSqlContainer.invalidPort;
    }
    if (form.containerName && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(form.containerName)) {
        errors.containerName = AzureSqlContainer.invalidContainerName;
    }
    if (
        form.hostname &&
        (form.hostname.length > 253 ||
            !form.hostname
                .split(".")
                .every(
                    (label) =>
                        label.length <= 63 &&
                        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label),
                ))
    ) {
        errors.hostname = AzureSqlContainer.invalidHostname;
    }
    if (!form.acceptEula) {
        errors.acceptEula = AzureSqlContainer.acceptTerms;
    }
    return errors;
}

export async function detectContainerEngines(): Promise<
    Record<ContainerEngine, ContainerEnginePrerequisiteResult>
>;
export async function detectContainerEngines(
    checkPrerequisite: typeof checkContainerEnginePrerequisite,
): Promise<Record<ContainerEngine, ContainerEnginePrerequisiteResult>>;
export async function detectContainerEngines(
    checkPrerequisite = checkContainerEnginePrerequisite,
): Promise<Record<ContainerEngine, ContainerEnginePrerequisiteResult>> {
    const detectionResults = await Promise.all(
        Object.values(ContainerEngine).map(async (engine) => {
            const result = await checkPrerequisite(
                engine,
                ContainerEnginePrerequisite.Installation,
            );
            return [engine, result] as const;
        }),
    );

    return Object.fromEntries(detectionResults) as Record<
        ContainerEngine,
        ContainerEnginePrerequisiteResult
    >;
}

export async function checkContainerEnginePrerequisite(
    engine: ContainerEngine,
    prerequisite: ContainerEnginePrerequisite,
): Promise<ContainerEnginePrerequisiteResult> {
    const command = prerequisiteCommands[engine]?.[prerequisite];
    if (!command) {
        return { success: true };
    }

    try {
        const result = await executeContainerEngineCommand(command, 15_000);

        if (
            engine === ContainerEngine.Docker &&
            prerequisite === ContainerEnginePrerequisite.Configuration &&
            result.stdout.trim().toLowerCase() !== "linux"
        ) {
            return {
                success: false,
                error: `Docker is configured to use ${result.stdout.trim()} containers instead of Linux containers.`,
            };
        }

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: getErrorMessage(error),
        };
    }
}

function getPullArguments(engine: ContainerEngine): string[] {
    return engine === ContainerEngine.AppleContainer
        ? ["image", "pull", azureSqlContainerImage]
        : ["pull", azureSqlContainerImage];
}

function getRunArguments(
    engine: ContainerEngine,
    form: AzureSqlContainerForm,
    administrator?: ContainerEntraAdministrator,
): string[] {
    const args = engine === ContainerEngine.AppleContainer ? ["run", "--detach"] : ["run", "-d"];
    args.push(
        "--name",
        form.containerName,
        "-e",
        "ACCEPT_EULA=Y",
        "-e",
        "MSSQL_SA_PASSWORD",
        "-p",
        `${form.port}:1433`,
    );
    if (form.hostname) {
        args.push("--hostname", form.hostname);
    }
    if (isAzureSqlContainerEntraAuthentication(form.authenticationType)) {
        if (!administrator || !form.applicationId || !form.tenantId || !form.pfxFilePath) {
            throw new Error(AzureSqlContainer.certificateUploadRequired);
        }
        for (const setting of [
            `MSSQL_AAD_CLIENT_ID=${form.applicationId}`,
            `MSSQL_AAD_PRIMARY_TENANT=${form.tenantId}`,
            `MSSQL_AAD_CERTIFICATE_FILE_PATH=${containerEntraCertificatePath}`,
            `MSSQL_AAD_SERVER_ADMIN_NAME=${administrator.name}`,
            "MSSQL_AAD_SERVER_ADMIN_TYPE=0",
            `MSSQL_AAD_SERVER_ADMIN_SID=${administrator.id}`,
        ]) {
            args.push("-e", setting);
        }
        args.push("-v", `${form.pfxFilePath}:${containerEntraCertificatePath}:ro`);
    }
    args.push(azureSqlContainerImage);
    return args;
}

export function getAzureSqlContainerProvisioningCommand(
    engine: ContainerEngine,
    step:
        | AzureSqlContainerProvisioningStep.PullImage
        | AzureSqlContainerProvisioningStep.CreateContainer
        | AzureSqlContainerProvisioningStep.WaitForReady,
    form: AzureSqlContainerForm,
    administrator?: ContainerEntraAdministrator,
): PrerequisiteCommand {
    if (step === AzureSqlContainerProvisioningStep.WaitForReady) {
        return {
            executable: getContainerEngineExecutable(engine),
            args: [
                "exec",
                "--env",
                "SQLCMDPASSWORD",
                form.containerName,
                "/opt/mssql-tools18/bin/sqlcmd",
                "-S",
                localhost,
                "-U",
                sa,
                "-C",
                "-b",
                "-l",
                "5",
                "-t",
                "5",
                "-Q",
                "SELECT 1",
            ],
            env: { SQLCMDPASSWORD: form.password },
        };
    }
    return {
        executable: getContainerEngineExecutable(engine),
        args:
            step === AzureSqlContainerProvisioningStep.PullImage
                ? getPullArguments(engine)
                : getRunArguments(engine, form, administrator),
        ...(step === AzureSqlContainerProvisioningStep.CreateContainer
            ? {
                  env: {
                      MSSQL_SA_PASSWORD: form.password,
                  },
              }
            : {}),
    };
}

export async function waitForAzureSqlContainer(
    engine: ContainerEngine,
    form: AzureSqlContainerForm,
    signal?: AbortSignal,
    executeCommand = executeContainerEngineCommand,
): Promise<AzureSqlContainerProvisioningResult> {
    const command = getAzureSqlContainerProvisioningCommand(
        engine,
        AzureSqlContainerProvisioningStep.WaitForReady,
        form,
    );
    const deadline = Date.now() + containerReadyTimeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline && !signal?.aborted) {
        try {
            await executeCommand(
                command,
                Math.max(1, Math.min(15_000, deadline - Date.now())),
                signal,
            );
            if (!signal?.aborted && Date.now() < deadline) {
                return { success: true };
            }
        } catch (error) {
            lastError = error;
        }
        await waitForContainerDelay(
            Math.min(containerReadyPollIntervalMs, Math.max(0, deadline - Date.now())),
            signal,
        );
    }

    return {
        success: false,
        error: AzureSqlContainer.containerNotReady,
        ...(lastError === undefined
            ? {}
            : { fullErrorText: sanitizeProvisioningError(lastError, form) }),
    };
}

function sanitizeProvisioningError(error: unknown, form: AzureSqlContainerForm): string {
    let errorText = typeof error === "string" ? error : getErrorMessage(error);
    const secrets = [form.password, form.servicePrincipalClientSecret].sort(
        (a, b) => (b?.length ?? 0) - (a?.length ?? 0),
    );
    for (const secret of secrets) {
        if (secret) {
            errorText = errorText.replaceAll(secret, "******");
        }
    }
    return dockerUtils.sanitizeErrorText(errorText);
}

async function addAzureSqlContainerConnection(
    engine: ContainerEngine,
    form: AzureSqlContainerForm,
    mainController: MainController,
    signal?: AbortSignal,
): Promise<AzureSqlContainerProvisioningResult> {
    const connection = new ConnectionProfile();
    Object.assign(connection, {
        server: `${localhost},${form.port}`,
        profileName: form.profileName || form.containerName,
        containerName: form.containerName,
        containerEngine: engine,
        groupId: form.groupId,
        trustServerCertificate: true,
    } satisfies Partial<ConnectionProfile>);
    try {
        if (signal?.aborted) {
            return { success: false };
        }
        if (form.authenticationType === AuthenticationType.AzureMFA) {
            if (!form.accountId) {
                throw new Error(AzureSqlContainer.selectEntraAccount);
            }
            if (!form.tenantId) {
                throw new Error(ConnectionDialog.tenantIdIsRequired);
            }
            const account = await VsCodeAzureHelper.getAccountById(form.accountId);
            if (!account) {
                throw new Error(
                    Accounts.accountNotAvailableThroughVsCode(form.accountId, form.tenantId),
                );
            }
            Object.assign(connection, {
                authenticationType: AuthenticationType.AzureMFA,
                accountId: account.id,
                tenantId: form.tenantId,
                user: account.label,
                email: account.label,
                password: "",
                savePassword: false,
                emptyPasswordInput: true,
            } satisfies Partial<ConnectionProfile>);
        } else if (form.authenticationType === AuthenticationType.ActiveDirectoryDefault) {
            Object.assign(connection, {
                authenticationType: AuthenticationType.ActiveDirectoryDefault,
                tenantId: form.tenantId,
                user: "",
                password: "",
                savePassword: false,
                emptyPasswordInput: true,
            } satisfies Partial<ConnectionProfile>);
        } else if (form.authenticationType === AuthenticationType.ActiveDirectoryServicePrincipal) {
            if (!form.applicationId) {
                throw new Error(AzureSqlContainer.selectAppRegistration);
            }
            if (!form.tenantId) {
                throw new Error(ConnectionDialog.tenantIdIsRequired);
            }
            if (!form.servicePrincipalClientSecret?.trim()) {
                throw new Error(AzureSqlContainer.servicePrincipalClientSecretRequired);
            }
            Object.assign(connection, {
                authenticationType: AuthenticationType.ActiveDirectoryServicePrincipal,
                tenantId: form.tenantId,
                user: form.applicationId,
                password: form.servicePrincipalClientSecret,
                savePassword: false,
                emptyPasswordInput: false,
            } satisfies Partial<ConnectionProfile>);
        } else {
            Object.assign(connection, {
                authenticationType: sqlAuthentication,
                user: sa,
                password: form.password,
                savePassword: form.savePassword,
                emptyPasswordInput: false,
            } satisfies Partial<ConnectionProfile>);
        }
        if (
            !(await waitForContainerConnection(
                connection,
                form.containerName,
                mainController,
                signal,
            ))
        ) {
            return { success: false, error: AzureSqlContainer.connectContainerFailed };
        }
        const profile = await mainController.connectionManager.connectionUI.saveProfile(connection);
        if (signal?.aborted) {
            return { success: false };
        }
        const connectionString = await mainController.connectionManager.getConnectionString(
            mainController.connectionManager.createConnectionDetails(profile),
            false,
            false,
        );
        if (signal?.aborted) {
            return { success: false };
        }
        await mainController.createObjectExplorerSession(profile);
        return { success: true, connectionString };
    } catch (error) {
        return {
            success: false,
            error: AzureSqlContainer.connectContainerFailed,
            fullErrorText: sanitizeProvisioningError(error, form),
        };
    }
}

export async function readContainerCertificate(
    pfxFilePath: string,
    signal?: AbortSignal,
): Promise<X509Certificate> {
    signal?.throwIfAborted();
    if (!path.isAbsolute(pfxFilePath) || path.extname(pfxFilePath).toLowerCase() !== ".pfx") {
        throw new Error(AzureSqlContainer.pfxFileRequired);
    }
    const stat = await fs.stat(pfxFilePath);
    if (!stat.isFile() || stat.size > 10 * 1024 * 1024) {
        throw new Error(AzureSqlContainer.invalidPfxCertificate);
    }
    const bytes = await fs.readFile(pfxFilePath, { signal });
    try {
        const engine = new CryptoEngine({ name: "mssql", crypto: globalThis.crypto });
        const password = new ArrayBuffer(0);
        const pfx = PFX.fromBER(Uint8Array.from(bytes).buffer);
        await pfx.parseInternalValues({ password }, engine);
        const authenticatedSafe = pfx.parsedValue?.authenticatedSafe;
        if (!authenticatedSafe) {
            throw new Error(AzureSqlContainer.invalidPfxCertificate);
        }
        const keys: KeyObject[] = [];
        const certificates: X509Certificate[] = [];
        for (const content of authenticatedSafe.safeContents) {
            let data: ArrayBuffer;
            if (
                content.contentType === ContentInfo.DATA &&
                content.content instanceof asn1.OctetString
            ) {
                data = content.content.getValue();
            } else if (
                content.contentType === ContentInfo.ENCRYPTED_DATA &&
                content.content instanceof asn1.Sequence
            ) {
                data = await EncryptedData.fromBER(content.content.toBER(false)).decrypt(
                    { password },
                    engine,
                );
            } else {
                throw new Error(AzureSqlContainer.invalidPfxCertificate);
            }
            for (const bag of SafeContents.fromBER(data).safeBags) {
                if (
                    bag.bagValue instanceof CertBag &&
                    bag.bagValue.certValue instanceof asn1.OctetString
                ) {
                    certificates.push(
                        new X509Certificate(Buffer.from(bag.bagValue.certValue.getValue())),
                    );
                } else {
                    let key: PrivateKeyInfo | undefined;
                    if (bag.bagValue instanceof PrivateKeyInfo) {
                        key = bag.bagValue;
                    } else if (bag.bagValue instanceof PKCS8ShroudedKeyBag) {
                        const encrypted = new EncryptedData({
                            encryptedContentInfo: new EncryptedContentInfo({
                                contentType: ContentInfo.DATA,
                                contentEncryptionAlgorithm: bag.bagValue.encryptionAlgorithm,
                                encryptedContent: bag.bagValue.encryptedData,
                            }),
                        });
                        key = PrivateKeyInfo.fromBER(await encrypted.decrypt({ password }, engine));
                    }
                    if (key) {
                        keys.push(
                            createPrivateKey({
                                key: Buffer.from(key.toSchema().toBER(false)),
                                format: "der",
                                type: "pkcs8",
                            }),
                        );
                    }
                }
            }
        }
        const matching = new Map(
            certificates
                .filter((certificate) => keys.some((key) => certificate.checkPrivateKey(key)))
                .map((certificate) => [certificate.fingerprint256, certificate]),
        );
        const certificate = matching.values().next().value;
        if (
            matching.size !== 1 ||
            !certificate ||
            certificate.publicKey.asymmetricKeyType !== "rsa" ||
            (certificate.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
            new Date(certificate.validFrom).getTime() > Date.now() ||
            new Date(certificate.validTo).getTime() <= Date.now()
        ) {
            throw new Error(AzureSqlContainer.invalidPfxCertificate);
        }
        signal?.throwIfAborted();
        return certificate;
    } catch (error) {
        signal?.throwIfAborted();
        throw new Error(AzureSqlContainer.invalidPfxCertificate, { cause: error });
    }
}

function toPem(label: string, der: ArrayBuffer): Buffer {
    const base64 = Buffer.from(der).toString("base64");
    const lines: string[] = [];
    for (let offset = 0; offset < base64.length; offset += 64) {
        lines.push(base64.slice(offset, offset + 64));
    }
    return Buffer.from(
        `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`,
        "utf8",
    );
}

export async function generateContainerCertificateFiles(
    pfxFilePath: string,
): Promise<ContainerCertificateFiles> {
    if (path.extname(pfxFilePath).toLowerCase() !== ".pfx") {
        throw new Error(AzureSqlContainer.pfxExtensionRequired);
    }
    const basePath = path.join(path.dirname(pfxFilePath), path.parse(pfxFilePath).name);
    const files: ContainerCertificateFiles = {
        pfxFilePath,
        privateKeyFilePath: `${basePath}.key`,
        publicCertificateFilePath: `${basePath}.cer`,
    };
    const opened: { handle: fs.FileHandle; filePath: string }[] = [];
    try {
        // Reserve every output exclusively before generating keys; never overwrite existing files.
        for (const filePath of [
            files.pfxFilePath,
            files.privateKeyFilePath,
            files.publicCertificateFilePath,
        ]) {
            const handle = await fs.open(filePath, "wx", 0o600);
            opened.push({ handle, filePath });
        }
        const crypto = globalThis.crypto;
        const engine = new CryptoEngine({ name: "mssql", crypto });
        const algorithm: RsaHashedKeyGenParams = {
            name: "RSASSA-PKCS1-v1_5",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
        };
        const keys = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
        const privateKeyDer = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
        const certificate = new Certificate();
        certificate.version = 2;
        const serial = randomBytes(16);
        serial[0] = serial[0] & 0x7f || 1;
        certificate.serialNumber = new asn1.Integer({
            valueHex: Uint8Array.from(serial).buffer,
        });
        const now = new Date();
        certificate.notBefore.value = new Date(now.getTime() - 5 * 60_000);
        certificate.notAfter.value = new Date(now);
        certificate.notAfter.value.setUTCFullYear(now.getUTCFullYear() + 1);
        const subject = new AttributeTypeAndValue({
            type: "2.5.4.3",
            value: new asn1.Utf8String({ value: "MSSQL developer container" }),
        });
        certificate.subject.typesAndValues.push(subject);
        certificate.issuer.typesAndValues.push(subject);
        await certificate.subjectPublicKeyInfo.importKey(keys.publicKey, engine);
        certificate.extensions = [
            new Extension({
                extnID: "2.5.29.19",
                critical: true,
                extnValue: new BasicConstraints({ cA: false }).toSchema().toBER(false),
            }),
            new Extension({
                extnID: "2.5.29.15",
                critical: true,
                extnValue: new asn1.BitString({
                    unusedBits: 7,
                    valueHex: new Uint8Array([0x80]).buffer,
                }).toBER(false),
            }),
            new Extension({
                extnID: "2.5.29.37",
                extnValue: new ExtKeyUsage({
                    keyPurposes: ["1.3.6.1.5.5.7.3.2"],
                })
                    .toSchema()
                    .toBER(false),
            }),
        ];
        await certificate.sign(keys.privateKey, "SHA-256", engine);
        const certificateDer = certificate.toSchema().toBER(false);
        const localKeyId = new Attribute({
            type: "1.2.840.113549.1.9.21",
            values: [new asn1.OctetString({ valueHex: Uint8Array.from(randomBytes(20)).buffer })],
        });
        // An unencrypted key bag is intentional: the PFX must not require a password.
        const safeContents = new SafeContents({
            safeBags: [
                new SafeBag({
                    bagId: "1.2.840.113549.1.12.10.1.1",
                    bagValue: PrivateKeyInfo.fromBER(privateKeyDer),
                    bagAttributes: [localKeyId],
                }),
                new SafeBag({
                    bagId: "1.2.840.113549.1.12.10.1.3",
                    bagValue: new CertBag({ parsedValue: certificate }),
                    bagAttributes: [localKeyId],
                }),
            ],
        });
        const authenticatedSafe = new AuthenticatedSafe({
            safeContents: [
                new ContentInfo({
                    contentType: ContentInfo.DATA,
                    content: new asn1.OctetString({
                        valueHex: safeContents.toSchema().toBER(false),
                    }),
                }),
            ],
        });
        const pfx = new PFX({ parsedValue: { authenticatedSafe, integrityMode: 0 } });
        await pfx.makeInternalValues(
            {
                password: new ArrayBuffer(0),
                iterations: 2048,
                pbkdf2HashAlgorithm: { name: "SHA-256" },
                hmacHashAlgorithm: "SHA-256",
            },
            engine,
        );
        const contents = [
            Buffer.from(pfx.toSchema().toBER(false)),
            toPem("PRIVATE KEY", privateKeyDer),
            toPem("CERTIFICATE", certificateDer),
        ];
        for (const [index, { handle }] of opened.entries()) {
            await handle.writeFile(contents[index]);
        }
        await Promise.all(opened.map(({ handle }) => handle.close()));
        return files;
    } catch (error) {
        const cleanup = await Promise.allSettled(
            opened.map(async ({ handle, filePath }) => {
                try {
                    await handle.close();
                } finally {
                    await fs.unlink(filePath);
                }
            }),
        );
        const failures = cleanup
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);
        if (failures.length) {
            throw new AggregateError(
                [error, ...failures],
                AzureSqlContainer.certificateCleanupFailed,
            );
        }
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
            throw new Error(AzureSqlContainer.certificateFilesAlreadyExist);
        }
        throw error;
    }
}

export async function runAzureSqlContainerProvisioningStep(
    engine: ContainerEngine,
    step: AzureSqlContainerProvisioningStep,
    form: AzureSqlContainerForm,
    mainController: MainController,
    signal?: AbortSignal,
    entraState: ContainerEntraState = {},
): Promise<AzureSqlContainerProvisioningResult> {
    const entraIdentity = JSON.stringify([
        form.authenticationType ?? AuthenticationType.SqlLogin,
        form.accountId,
        form.tenantId,
        form.applicationId,
    ]);
    try {
        switch (step) {
            case AzureSqlContainerProvisioningStep.PullImage: {
                const command = getAzureSqlContainerProvisioningCommand(engine, step, form);
                await executeContainerEngineCommand(command, 600_000, signal);
                return { success: true };
            }
            case AzureSqlContainerProvisioningStep.UploadCertificate: {
                delete entraState.administrator;
                delete entraState.certificateThumbprint;
                delete entraState.identity;
                signal?.throwIfAborted();
                if (
                    !isAzureSqlContainerEntraAuthentication(form.authenticationType) ||
                    !form.accountId ||
                    !form.tenantId ||
                    !form.applicationId ||
                    !form.pfxFilePath
                ) {
                    throw new Error(AzureSqlContainer.certificateUploadRequired);
                }
                const certificate = await readContainerCertificate(form.pfxFilePath, signal);
                const account = await VsCodeAzureHelper.getAccountById(form.accountId);
                if (!account) {
                    throw new Error(
                        Accounts.accountNotAvailableThroughVsCode(form.accountId, form.tenantId),
                    );
                }
                let administrator: ContainerEntraAdministrator;
                if (
                    form.authenticationType === AuthenticationType.ActiveDirectoryServicePrincipal
                ) {
                    const principal = await graphClient.ensureServicePrincipal(
                        form.applicationId,
                        account,
                        form.tenantId,
                        signal,
                    );
                    administrator = { id: principal.id, name: principal.displayName };
                } else {
                    const user = await graphClient.fetchCurrentUser(account, form.tenantId, signal);
                    administrator = { id: user.id, name: user.userPrincipalName };
                }
                await graphClient.uploadAppCertificate(
                    form.applicationId,
                    certificate,
                    account,
                    form.tenantId,
                    signal,
                );
                signal?.throwIfAborted();
                entraState.administrator = administrator;
                entraState.certificateThumbprint = certificate.fingerprint256;
                entraState.identity = entraIdentity;
                return { success: true };
            }
            case AzureSqlContainerProvisioningStep.CreateContainer: {
                signal?.throwIfAborted();
                if (isAzureSqlContainerEntraAuthentication(form.authenticationType)) {
                    if (
                        !entraState.administrator ||
                        !entraState.certificateThumbprint ||
                        entraState.identity !== entraIdentity ||
                        !form.pfxFilePath
                    ) {
                        throw new Error(AzureSqlContainer.certificateUploadRequired);
                    }
                    const certificate = await readContainerCertificate(form.pfxFilePath, signal);
                    if (certificate.fingerprint256 !== entraState.certificateThumbprint) {
                        throw new Error(AzureSqlContainer.pfxCertificateChanged);
                    }
                }
                const command = getAzureSqlContainerProvisioningCommand(
                    engine,
                    step,
                    form,
                    entraState.administrator,
                );
                await executeContainerEngineCommand(command, 120_000, signal);
                return { success: true };
            }
            case AzureSqlContainerProvisioningStep.WaitForReady:
                return waitForAzureSqlContainer(engine, form, signal);
            case AzureSqlContainerProvisioningStep.Connect:
                return addAzureSqlContainerConnection(engine, form, mainController, signal);
        }
    } catch (error) {
        const errorMessage =
            step === AzureSqlContainerProvisioningStep.UploadCertificate
                ? AzureSqlContainer.certificateUploadFailed
                : step === AzureSqlContainerProvisioningStep.PullImage
                  ? AzureSqlContainer.pullImageFailed
                  : AzureSqlContainer.createContainerFailed;
        return {
            success: false,
            error: errorMessage,
            fullErrorText: sanitizeProvisioningError(error, form),
        };
    }
}
