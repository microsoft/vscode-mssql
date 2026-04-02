/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    createConnectionGroup,
    getDefaultConnectionGroupDialogProps,
} from "../controllers/connectionGroupWebviewController";
import MainController from "../controllers/mainController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { FormWebviewController } from "../forms/formWebviewController";
import { IConnectionGroup } from "../models/interfaces";
import {
    DeploymentFormState,
    DeploymentWebviewState,
    DeploymentFormItemSpec,
    DeploymentReducers,
    DeploymentType,
    DeploymentTypeState,
} from "../sharedInterfaces/deployment";
import { TelemetryViews } from "../sharedInterfaces/telemetry";
import { ApiStatus } from "../sharedInterfaces/webview";
import * as localContainers from "./localContainersHelpers";
import { DockerStepOrder, LocalContainersState } from "../sharedInterfaces/localContainers";
import * as fabricProvisioning from "./fabricProvisioningHelpers";
import { newDeployment } from "../constants/locConstants";
import { FabricProvisioningState } from "../sharedInterfaces/fabricProvisioning";
import {
    BackgroundTaskHandle,
    BackgroundTaskState,
    isBackgroundTaskCompleted,
} from "../backgroundTasks/backgroundTasksService";
import { uuid } from "../utils/utils";

export const DEPLOYMENT_VIEW_ID = "deployment";

interface DeploymentOperationSession {
    id: string;
    state: DeploymentWebviewState;
    activeController?: DeploymentWebviewController;
}

/**
 * Overarching controller for the deployment webview.
 * Since there's one overarching controller for all deployment types, but each deployment type has differently typed form states + webview states, there are two form states:
 * one with the overall controller (required because it extends FormWebviewController), and one with each specific deployment state.
 */
export class DeploymentWebviewController extends FormWebviewController<
    DeploymentFormState,
    DeploymentWebviewState,
    DeploymentFormItemSpec,
    DeploymentReducers
> {
    private static readonly operationSessions = new Map<string, DeploymentOperationSession>();

    requiredInputs: DeploymentFormItemSpec[];
    private _backgroundTaskHandle?: BackgroundTaskHandle;
    private _backgroundTaskState?: BackgroundTaskState;
    private readonly _initialDeploymentType?: DeploymentType;
    private readonly _initialWizardPageId?: string;
    private readonly _operationId: string;
    private readonly _operationSession: DeploymentOperationSession;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        // Main controller is used to connect to the container after creation
        public mainController: MainController,
        initialConnectionGroup?: string,
        initialDeploymentType?: DeploymentType,
        initialWizardPageId?: string,
        initialState?: DeploymentWebviewState,
    ) {
        const operationId = initialState?.operationId ?? uuid();
        const operationSession = DeploymentWebviewController.getOrCreateOperationSession(
            operationId,
            initialState,
        );

        super(
            context,
            vscodeWrapper,
            DEPLOYMENT_VIEW_ID,
            DEPLOYMENT_VIEW_ID,
            operationSession.state,
            {
                title: newDeployment,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "deployment.svg"),
                    light: vscode.Uri.joinPath(context.extensionUri, "media", "deployment.svg"),
                },
            },
        );
        this._initialDeploymentType = initialDeploymentType;
        this._initialWizardPageId = initialWizardPageId;
        this._operationId = operationId;
        this._operationSession = operationSession;
        void this.initialize(initialConnectionGroup);
    }

    private static getOrCreateOperationSession(
        operationId: string,
        initialState?: DeploymentWebviewState,
    ): DeploymentOperationSession {
        let session = this.operationSessions.get(operationId);
        if (!session) {
            const state = initialState ?? new DeploymentWebviewState();
            state.operationId = operationId;
            session = { id: operationId, state };
            this.operationSessions.set(operationId, session);
        }

        return session;
    }

    private static hasInitializedDeploymentTypeState(
        state: DeploymentWebviewState,
        deploymentType: DeploymentType,
    ): boolean {
        if (deploymentType === DeploymentType.LocalContainers) {
            return Array.isArray((state.deploymentTypeState as LocalContainersState)?.dockerSteps);
        }

        if (deploymentType === DeploymentType.FabricProvisioning) {
            const fabricState = state.deploymentTypeState as FabricProvisioningState;
            return !!fabricState?.formState && !!fabricState?.formComponents;
        }

        return false;
    }

    private async initialize(initialConnectionGroup?: string) {
        this.attachToOperationSession();
        const connectionGroupOptions =
            await this.mainController.connectionManager.connectionUI.getConnectionGroupOptions();
        if (initialConnectionGroup && !this.state.formState?.groupId) {
            this.state.formState.groupId = initialConnectionGroup;
        }

        this.state.connectionGroupOptions = connectionGroupOptions;
        this.state.operationId = this._operationId;
        this.registerRpcHandlers();
        if (this._initialDeploymentType !== undefined) {
            if (
                !DeploymentWebviewController.hasInitializedDeploymentTypeState(
                    this.state,
                    this._initialDeploymentType,
                )
            ) {
                await this.initializeDeploymentSpecificsState(
                    this.state,
                    this._initialDeploymentType,
                );
            }

            this.state.resumedDeploymentType = this._initialDeploymentType;
            this.state.resumedWizardPageId = this._initialWizardPageId;
        }
        this.state.loadState = ApiStatus.Loaded;
        this.updateState(this.state);
    }

    private attachToOperationSession(): void {
        this._operationSession.activeController = this;
        this.state = this._operationSession.state;
    }

    private registerRpcHandlers() {
        this.registerReducer("initializeDeploymentSpecifics", async (state, payload) => {
            await this.initializeDeploymentSpecificsState(state, payload.deploymentType);
            state.resumedDeploymentType = undefined;
            state.resumedWizardPageId = undefined;
            return state;
        });

        this.registerReducer("formAction", async (state, payload) => {
            if (state.deploymentType === DeploymentType.LocalContainers) {
                state.deploymentTypeState = await localContainers.handleLocalContainersFormAction(
                    state.deploymentTypeState as LocalContainersState,
                    payload,
                );
                state.dialog = state.deploymentTypeState.dialog;
            } else {
                state = (await this.handleDeploymentFormAction(
                    state,
                    payload,
                )) as DeploymentWebviewState;
                state.deploymentTypeState.formState = state.formState;
                state.deploymentTypeState.formErrors = state.formErrors;
                state.deploymentTypeState.formComponents = state.formComponents as any;
            }

            return state;
        });

        this.registerReducer("createConnectionGroup", async (state, payload) => {
            const createConnectionGroupResult: IConnectionGroup | string =
                await createConnectionGroup(
                    payload.connectionGroupSpec,
                    this.mainController.connectionManager,
                    TelemetryViews.ConnectionDialog,
                );
            if (typeof createConnectionGroupResult === "string") {
                // If the result is a string, it means there was an error creating the group
                state.formErrors.push(createConnectionGroupResult);
            } else {
                // If the result is an IConnectionGroup, it means the group was created successfully
                state.formState.groupId = createConnectionGroupResult.id;
            }

            state.formComponents.groupId.options =
                await this.mainController.connectionManager.connectionUI.getConnectionGroupOptions();

            state.dialog = undefined;
            state.deploymentTypeState.dialog = undefined;

            return state;
        });

        this.registerReducer("setConnectionGroupDialogState", async (state, payload) => {
            if (payload.shouldOpen) {
                state.dialog = getDefaultConnectionGroupDialogProps();
            } else {
                state.dialog = undefined;
            }
            state.deploymentTypeState.dialog = state.dialog;
            return state;
        });

        this.registerReducer("dispose", async (state, _payload) => {
            if (state.deploymentType === DeploymentType.LocalContainers) {
                localContainers.sendLocalContainersCloseEventTelemetry(
                    state.deploymentTypeState as LocalContainersState,
                );
            } else if (state.deploymentType === DeploymentType.FabricProvisioning) {
                fabricProvisioning.sendFabricProvisioningCloseEventTelemetry(
                    state.deploymentTypeState as FabricProvisioningState,
                );
            }

            this.panel.dispose();
            this.dispose();
            return state;
        });

        localContainers.registerLocalContainersReducers(this);
        fabricProvisioning.registerFabricProvisioningReducers(this);
    }

    async updateItemVisibility() {}

    protected getActiveFormComponents(
        state: DeploymentWebviewState,
    ): (keyof DeploymentFormState)[] {
        return Object.keys(state.formComponents) as (keyof DeploymentFormState)[];
    }

    public syncBackgroundTask(
        deploymentType: DeploymentType = this.state.deploymentType,
        deploymentTypeState: DeploymentTypeState = this.state.deploymentTypeState,
    ): void {
        if (deploymentType === DeploymentType.LocalContainers) {
            this.syncLocalContainersBackgroundTask(deploymentTypeState as LocalContainersState);
        } else if (deploymentType === DeploymentType.FabricProvisioning) {
            this.syncFabricProvisioningBackgroundTask(
                deploymentTypeState as FabricProvisioningState,
            );
        }
    }

    public get operationId(): string {
        return this._operationId;
    }

    public applyDeploymentTypeState(
        deploymentType: DeploymentType,
        deploymentTypeState: DeploymentTypeState,
    ): void {
        this.state.operationId = this._operationId;
        this.state.deploymentType = deploymentType;
        this.state.deploymentTypeState = deploymentTypeState;
        this.state.dialog = deploymentTypeState.dialog;
        this.state.formState = deploymentTypeState.formState ?? this.state.formState;
        this.state.formComponents = (deploymentTypeState.formComponents ??
            this.state.formComponents) as any;
        this.state.formErrors = deploymentTypeState.formErrors ?? this.state.formErrors;
    }

    public publishDeploymentState(
        deploymentType: DeploymentType = this.state.deploymentType,
        deploymentTypeState: DeploymentTypeState = this.state.deploymentTypeState,
    ): void {
        this.applyDeploymentTypeState(deploymentType, deploymentTypeState);
        this._operationSession.state = this.state;
        this.syncBackgroundTask(deploymentType, deploymentTypeState);

        const activeController = this._operationSession.activeController;
        if (activeController && !activeController.isDisposed) {
            activeController.updateState(this._operationSession.state);
        }
    }

    private async handleDeploymentFormAction(state, payload) {
        if (payload.event.isAction) {
            const component = state.formComponents[payload.event.propertyName];
            if (component && component.actionButtons) {
                const actionButton = component.actionButtons.find(
                    (b) => b.id === payload.event.value,
                );
                if (actionButton?.callback) {
                    await actionButton.callback();
                }
            }
        } else {
            (state.formState[
                payload.event.propertyName
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ] as any) = payload.event.value;
            this.state.deploymentTypeState.formState = state.formState;
            await this.validateDeploymentForm(payload.event.propertyName);
        }
        await this.updateItemVisibility();

        return state;
    }

    public async validateDeploymentForm(
        propertyName?: keyof DeploymentFormState,
        deploymentTypeState?: DeploymentTypeState,
    ): Promise<string[]> {
        const state = deploymentTypeState || this.state.deploymentTypeState;
        let errors: string[] = [];
        if (propertyName) {
            const component = state.formComponents[propertyName];
            if (!component.validate) return errors;
            const componentValidation = component.validate(
                state as any,
                state.formState[propertyName],
            );
            if (!componentValidation.isValid) {
                errors.push(propertyName);
            }
            component.validation = componentValidation;
        } else {
            for (const componentKey of Object.keys(state.formState)) {
                const component = state.formComponents[componentKey];
                if (!component.validate) continue;
                const componentValidation = component.validate(
                    state as any,
                    state.formState[componentKey],
                );
                if (!componentValidation.isValid) {
                    errors.push(componentKey);
                }
                component.validation = componentValidation;
            }
        }
        return errors;
    }

    private async initializeDeploymentSpecificsState(
        state: DeploymentWebviewState,
        deploymentType: DeploymentType,
    ): Promise<void> {
        let newDeploymentTypeState: DeploymentTypeState;
        state.deploymentType = deploymentType;
        state.deploymentTypeState.loadState = ApiStatus.Loading;
        this.updateState(state);
        const selectedGroupId = state?.formState?.groupId;

        if (deploymentType === DeploymentType.LocalContainers) {
            newDeploymentTypeState = await localContainers.initializeLocalContainersState(
                state.connectionGroupOptions,
                selectedGroupId,
            );
        } else if (deploymentType === DeploymentType.FabricProvisioning) {
            newDeploymentTypeState = await fabricProvisioning.initializeFabricProvisioningState(
                this,
                state.connectionGroupOptions,
                this.logger,
                selectedGroupId,
            );
        } else {
            return;
        }

        state.deploymentTypeState = newDeploymentTypeState;
        state.dialog = newDeploymentTypeState.dialog;
        state.formState = newDeploymentTypeState.formState;
        state.formComponents = newDeploymentTypeState.formComponents as any;
    }

    private syncLocalContainersBackgroundTask(state: LocalContainersState): void {
        const dockerSteps = state.dockerSteps ?? [];
        const provisioningSteps = dockerSteps.slice(DockerStepOrder.pullImage);
        const hasStarted = provisioningSteps.some(
            (step) => step.loadState !== ApiStatus.NotStarted,
        );
        if (!hasStarted) {
            return;
        }

        const loadedSteps = provisioningSteps.filter(
            (step) => step.loadState === ApiStatus.Loaded,
        ).length;
        const erroredStep = provisioningSteps.find((step) => step.loadState === ApiStatus.Error);
        const currentStep =
            erroredStep ??
            dockerSteps[
                Math.min(
                    Math.max(state.currentDockerStep, DockerStepOrder.pullImage),
                    Math.max(dockerSteps.length - 1, DockerStepOrder.pullImage),
                )
            ];
        const taskState = erroredStep
            ? BackgroundTaskState.Failed
            : loadedSteps === provisioningSteps.length
              ? BackgroundTaskState.Succeeded
              : BackgroundTaskState.InProgress;
        const containerName = state.formState?.containerName || state.formState?.profileName;
        const tooltipSections = [vscode.l10n.t("Create a Local Docker SQL Server")];
        if (containerName) {
            tooltipSections.push(vscode.l10n.t("Container: {0}", containerName));
        }
        if (state.formState?.version) {
            tooltipSections.push(vscode.l10n.t("Image: {0}", state.formState.version));
        }

        const percent =
            taskState === BackgroundTaskState.Succeeded
                ? 100
                : Math.round((loadedSteps / provisioningSteps.length) * 100);
        const message =
            erroredStep?.errorMessage ??
            (taskState === BackgroundTaskState.Succeeded
                ? vscode.l10n.t("Container is ready for connections")
                : (currentStep?.headerText ?? vscode.l10n.t("Preparing Docker deployment")));

        this.upsertBackgroundTask(taskState, {
            displayText: vscode.l10n.t("Docker SQL Server Deployment"),
            details: containerName,
            tooltip: tooltipSections.join("\n\n"),
            percent,
            source: "MSSQL",
            message,
            open: this.createDeploymentOpenHandler(
                DeploymentType.LocalContainers,
                "local-provisioning",
            ),
        });
    }

    private syncFabricProvisioningBackgroundTask(state: FabricProvisioningState): void {
        const hasStarted =
            Boolean(state.deploymentStartTime) || state.provisionLoadState !== ApiStatus.NotStarted;
        if (!hasStarted) {
            return;
        }

        const taskState =
            state.provisionLoadState === ApiStatus.Error ||
            state.connectionLoadState === ApiStatus.Error
                ? BackgroundTaskState.Failed
                : state.connectionLoadState === ApiStatus.Loaded
                  ? BackgroundTaskState.Succeeded
                  : BackgroundTaskState.InProgress;
        const workspaceName = state.workspaceName || state.formState?.workspace;
        const databaseName = state.formState?.databaseName;
        const details = [workspaceName, databaseName].filter(Boolean).join("/") || undefined;
        const tooltipSections = [vscode.l10n.t("SQL database in Fabric")];
        if (databaseName) {
            tooltipSections.push(vscode.l10n.t("Database: {0}", databaseName));
        }
        if (workspaceName) {
            tooltipSections.push(vscode.l10n.t("Workspace: {0}", workspaceName));
        }
        if (state.tenantName) {
            tooltipSections.push(vscode.l10n.t("Tenant: {0}", state.tenantName));
        }

        const percent =
            taskState === BackgroundTaskState.Succeeded
                ? 100
                : state.provisionLoadState === ApiStatus.Loaded ||
                    state.connectionLoadState === ApiStatus.Loading ||
                    state.connectionLoadState === ApiStatus.Error
                  ? 50
                  : 0;
        const message =
            state.errorMessage ||
            (state.provisionLoadState === ApiStatus.Loaded
                ? state.connectionLoadState === ApiStatus.Loaded
                    ? vscode.l10n.t("Database connected")
                    : vscode.l10n.t("Connecting to database")
                : vscode.l10n.t("Provisioning database"));

        this.upsertBackgroundTask(taskState, {
            displayText: vscode.l10n.t("SQL Database in Fabric Deployment"),
            details,
            tooltip: tooltipSections.join("\n\n"),
            percent,
            source: "MSSQL",
            message,
            open: this.createDeploymentOpenHandler(
                DeploymentType.FabricProvisioning,
                "fabric-provisioning",
            ),
        });
    }

    private upsertBackgroundTask(
        state: BackgroundTaskState,
        task: {
            displayText: string;
            details?: string;
            tooltip: string;
            percent?: number;
            source: string;
            message: string;
            open: () => void;
        },
    ): void {
        if (
            !this._backgroundTaskHandle ||
            (this._backgroundTaskState !== undefined &&
                isBackgroundTaskCompleted(this._backgroundTaskState) &&
                !isBackgroundTaskCompleted(state))
        ) {
            this._backgroundTaskHandle = this.mainController.backgroundTasksService.registerTask({
                ...task,
                canCancel: false,
                state,
            });
            this._backgroundTaskState = state;
            return;
        }

        if (!this._backgroundTaskHandle) {
            return;
        }

        if (isBackgroundTaskCompleted(state)) {
            if (
                this._backgroundTaskState !== undefined &&
                isBackgroundTaskCompleted(this._backgroundTaskState)
            ) {
                this._backgroundTaskHandle.update(task);
            } else {
                this._backgroundTaskHandle.complete(state, task);
            }
        } else {
            this._backgroundTaskHandle.update({
                ...task,
                canCancel: false,
                state,
            });
        }

        this._backgroundTaskState = state;
    }

    private createDeploymentOpenHandler(
        deploymentType: DeploymentType,
        wizardPageId: string,
    ): () => void {
        return () => {
            const activeController = this._operationSession.activeController;
            if (activeController && !activeController.isDisposed) {
                activeController.revealToForeground(vscode.ViewColumn.Active);
                return;
            }

            this.mainController.onDeployNewDatabase({
                initialConnectionGroup: this._operationSession.state.formState?.groupId,
                initialDeploymentType: deploymentType,
                initialWizardPageId: wizardPageId,
                initialState: Object.assign(new DeploymentWebviewState(), {
                    operationId: this._operationId,
                }),
            });
        };
    }

    public override dispose(): void {
        if (this._operationSession.activeController === this) {
            this._operationSession.activeController = undefined;
        }
        super.dispose();
    }
}
