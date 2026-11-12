/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "node:path";
import {
    createConnectionGroup,
    getDefaultConnectionGroupDialogProps,
} from "../controllers/connectionGroupWebviewController";
import MainController from "../controllers/mainController";
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
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { ApiStatus } from "../sharedInterfaces/webview";
import * as localContainers from "./localContainersHelpers";
import { classicContainerConnectAdapter, ContainerConnectAdapter } from "./containerConnectAdapter";
import { LocalContainersState } from "../sharedInterfaces/localContainers";
import * as fabricProvisioning from "./fabricProvisioningHelpers";
import * as azureSqlDatabase from "./azureSqlDatabaseHelpers";
import {
    deploymentScriptAlreadyExists,
    LocalToCloud,
    newDeployment,
    noWorkspaceOpenForDeploymentScript,
    overwriteDeploymentScript,
} from "../constants/locConstants";
import { FabricProvisioningState } from "../sharedInterfaces/fabricProvisioning";
import {
    AzureSqlDatabaseState,
    AZURE_SQL_DB_COMPONENT_ORDER,
    AzureSqlDatabaseRequests,
    LocalDatabaseCompatibilityResult,
    LocalDatabaseSource,
} from "../sharedInterfaces/azureSqlDatabase";
import { findFirstFavoriteOption } from "../sharedInterfaces/form";
import * as azureSql from "./azureSqlHelpers";
import {
    sendActionEvent,
    startWorkflow,
    type TelemetryEventOptions,
    type WorkflowStep,
    type WorkflowTelemetryObject,
} from "extension-toolkit/vscode";
import { BackgroundTaskState } from "../backgroundTasks/backgroundTasksService";
import {
    AzureSqlCompatibilityBuilder,
    connectLocalDatabaseSource,
    findActiveLocalSourceUri,
    getLocalToCloudConnectionTelemetry,
    getLocalDatabaseProfileId,
    isAzureSqlDatabaseSource,
    getLocalDatabaseSources,
    getLocalServerDatabases,
    LocalDatabaseCompatibilityService,
    LocalDatabaseDeploymentService,
} from "./localToCloudHelpers";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { getMssqlOutputChannel } from "../models/logger";
import { mergeTelemetryOptions } from "../utils/telemetryUtils";

export const DEPLOYMENT_VIEW_ID = "deployment";
const DEPLOYMENT_FAVORITES_STATE_KEY = "mssql.deploymentResourceFavorites";

type DeploymentFavorites = Record<string, string[]>;

export enum DeploymentWorkflowEventName {
    Opened = "Opened",
    DeploymentTypeSelected = "DeploymentTypeSelected",
    ConfigurationReady = "ConfigurationReady",
    SourceSelected = "SourceSelected",
    CompatibilityValidated = "CompatibilityValidated",
    DeploymentStarted = "DeploymentStarted",
    DeploymentCompleted = "DeploymentCompleted",
    PanelClosed = "PanelClosed",
    Closed = "Closed",
}

const DeploymentWorkflowStep = {
    [DeploymentWorkflowEventName.Opened]: { name: "Opened", ordinal: 1 },
    [DeploymentWorkflowEventName.DeploymentTypeSelected]: {
        name: "DeploymentTypeSelected",
        ordinal: 2,
    },
    [DeploymentWorkflowEventName.ConfigurationReady]: {
        name: "Configuration",
        ordinal: 3,
    },
    [DeploymentWorkflowEventName.DeploymentStarted]: {
        name: "Deployment",
        ordinal: 4,
    },
    [DeploymentWorkflowEventName.DeploymentCompleted]: {
        name: "Deployment",
        ordinal: 4,
    },
} as const;

/** Local-to-cloud validates a source database first, so its ordinals are branch-relative. */
const LocalToCloudWorkflowStep = {
    [DeploymentWorkflowEventName.DeploymentTypeSelected]:
        DeploymentWorkflowStep[DeploymentWorkflowEventName.DeploymentTypeSelected],
    [DeploymentWorkflowEventName.SourceSelected]: { name: "Source", ordinal: 3 },
    [DeploymentWorkflowEventName.CompatibilityValidated]: { name: "Compatibility", ordinal: 4 },
    [DeploymentWorkflowEventName.ConfigurationReady]: { name: "Configuration", ordinal: 5 },
    [DeploymentWorkflowEventName.DeploymentStarted]: { name: "Deployment", ordinal: 6 },
    [DeploymentWorkflowEventName.DeploymentCompleted]: { name: "Deployment", ordinal: 6 },
} as const;

type DeploymentWorkflowStepEventName = keyof typeof LocalToCloudWorkflowStep;

const CompatibilityOutcome: Record<LocalDatabaseCompatibilityResult["status"], string> = {
    passed: "Succeeded",
    warnings: "Succeeded",
    blocked: "Failed",
    error: "Failed",
    cancelled: "Cancelled",
};

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
    requiredInputs: DeploymentFormItemSpec[];
    /** The wizard's terminal connect seam (DOCK-0): which OE opens the profile. */
    public readonly containerConnect: ContainerConnectAdapter;
    private readonly _workflow: WorkflowTelemetryObject;
    private _deploymentSucceeded = false;
    private _panelDisposed = false;
    /** Deployments that are still running, which may outlive the panel. */
    private readonly _runningDeployments = new Set<DeploymentType>();

    constructor(
        context: vscode.ExtensionContext,
        // Main controller is used to connect to the container after creation
        public mainController: MainController,
        initialConnectionGroup?: string,
        initialDeploymentType?: DeploymentType,
        containerConnect?: ContainerConnectAdapter,
        initialLocalDatabaseSource?: LocalDatabaseSource,
    ) {
        super(context, DEPLOYMENT_VIEW_ID, DEPLOYMENT_VIEW_ID, new DeploymentWebviewState(), {
            title: newDeployment,
            viewColumn: vscode.ViewColumn.Active,
            iconPath: {
                dark: vscode.Uri.joinPath(context.extensionUri, "media", "deployment.svg"),
                light: vscode.Uri.joinPath(context.extensionUri, "media", "deployment.svg"),
            },
        });
        this._workflow = startWorkflow(
            TelemetryViews.Deployment,
            TelemetryActions.DeploymentWorkflow,
            DeploymentWorkflowEventName.Opened,
            { step: DeploymentWorkflowStep[DeploymentWorkflowEventName.Opened] },
        );
        this.containerConnect = containerConnect ?? classicContainerConnectAdapter(mainController);
        void this.initialize(
            initialConnectionGroup,
            initialDeploymentType,
            initialLocalDatabaseSource,
        );
    }

    private async initialize(
        initialConnectionGroup?: string,
        initialDeploymentType?: DeploymentType,
        initialLocalDatabaseSource?: LocalDatabaseSource,
    ) {
        // If an initial connection group was provided, try to pre-populate the form state
        if (initialConnectionGroup) {
            this.state.formState.groupId = initialConnectionGroup;
        }
        this.state.initialDeploymentType = initialDeploymentType;
        this.state.initialLocalDatabaseSource = initialLocalDatabaseSource;
        this.state.connectionGroupOptions =
            await this.mainController.connectionManager.connectionUI.getConnectionGroupOptions();
        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
        this.updateState();
    }

    private registerRpcHandlers() {
        this.registerReducer("initializeDeploymentSpecifics", async (state, payload) => {
            let newDeploymentTypeState: DeploymentTypeState;
            state.deploymentType = payload.deploymentType;
            // Local-to-cloud reuses the Azure SQL Database form but is its own workflow branch.
            const workflowDeploymentType = payload.workflowDeploymentType ?? payload.deploymentType;
            if (workflowDeploymentType === payload.deploymentType) {
                this.recordDeploymentWorkflowEvent(
                    DeploymentWorkflowEventName.DeploymentTypeSelected,
                    payload.deploymentType,
                );
            }
            state.deploymentTypeState.loadState = ApiStatus.Loading;
            this.updateState(state);
            const selectedGroupId = state?.formState?.groupId;

            // Initialize the appropriate deployment type state
            if (payload.deploymentType === DeploymentType.LocalContainers) {
                newDeploymentTypeState = await localContainers.initializeLocalContainersState(
                    state.connectionGroupOptions,
                    selectedGroupId,
                    this.workflowCorrelationId,
                );
            } else if (payload.deploymentType === DeploymentType.FabricProvisioning) {
                newDeploymentTypeState = await fabricProvisioning.initializeFabricProvisioningState(
                    this,
                    state.connectionGroupOptions,
                    this.logger,
                    selectedGroupId,
                );
            } else if (payload.deploymentType === DeploymentType.AzureSqlDatabase) {
                newDeploymentTypeState = await azureSqlDatabase.initializeAzureSqlDatabaseState(
                    this,
                    state.connectionGroupOptions,
                    this.logger,
                    selectedGroupId,
                );
            } else {
                // A deployment type with no wizard behind it yet. Everything below reads the
                // state this block was meant to produce, so carrying on would dereference
                // `undefined` and take the webview down. The start page only advances once the
                // state for its chosen type is ready, so returning here leaves the user on the
                // chooser instead.
                this.logger.error(
                    `No deployment wizard is implemented for deployment type ${payload.deploymentType}.`,
                );
                state.deploymentTypeState.loadState = ApiStatus.Error;
                return state;
            }

            // Capture the initial deployment specific state in the overall controller's state
            state.deploymentTypeState = newDeploymentTypeState;
            state.dialog = newDeploymentTypeState.dialog;
            state.formState = newDeploymentTypeState.formState;
            state.formComponents = newDeploymentTypeState.formComponents as any;
            this.applyFavoritesToFormComponents(state);
            if (payload.deploymentType === DeploymentType.FabricProvisioning) {
                void fabricProvisioning.getWorkspaces(this);
            }
            this.recordDeploymentWorkflowEvent(
                DeploymentWorkflowEventName.ConfigurationReady,
                workflowDeploymentType,
            );
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

        this.registerReducer("toggleFormOptionFavorite", async (state, payload) => {
            const component = state.formComponents[payload.propertyName];
            if (component?.favoriteOptionIds === undefined) {
                return state;
            }

            const favoriteKey = this.getFavoriteKey(state.deploymentType, payload.propertyName);
            const favorites =
                this._context.globalState.get<DeploymentFavorites>(
                    DEPLOYMENT_FAVORITES_STATE_KEY,
                ) ?? {};
            const currentFavorites = favorites[favoriteKey] ?? [];
            const nextFavorites = currentFavorites.includes(payload.favoriteId)
                ? currentFavorites.filter((id) => id !== payload.favoriteId)
                : [...currentFavorites, payload.favoriteId];

            await this._context.globalState.update(DEPLOYMENT_FAVORITES_STATE_KEY, {
                ...favorites,
                [favoriteKey]: nextFavorites,
            });

            component.favoriteOptionIds = nextFavorites;
            state.deploymentTypeState.formComponents[payload.propertyName].favoriteOptionIds =
                nextFavorites;
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
                const dialog = getDefaultConnectionGroupDialogProps(
                    await this.mainController.connectionManager.connectionStore.connectionConfig.getGroups(),
                );
                dialog.props = {
                    ...dialog.props,
                    ...payload.connectionGroupSpec,
                    message: createConnectionGroupResult,
                };
                state.dialog = dialog;
                state.deploymentTypeState.dialog = dialog;
                return state;
            } else {
                // If the result is an IConnectionGroup, it means the group was created successfully
                state.formState.groupId = createConnectionGroupResult.id;
            }

            state.connectionGroupOptions =
                await this.mainController.connectionManager.connectionUI.getConnectionGroupOptions();
            if (state.formComponents.groupId) {
                state.formComponents.groupId.options = state.connectionGroupOptions;
            }

            state.dialog = undefined;
            state.deploymentTypeState.dialog = undefined;

            return state;
        });

        this.registerReducer("setConnectionGroupDialogState", async (state, payload) => {
            if (payload.shouldOpen) {
                state.dialog = getDefaultConnectionGroupDialogProps(
                    await this.mainController.connectionManager.connectionStore.connectionConfig.getGroups(),
                );
            } else {
                state.dialog = undefined;
            }
            state.deploymentTypeState.dialog = state.dialog;
            return state;
        });

        this.registerReducer("dispose", async (state, _payload) => {
            try {
                if (state.deploymentType === DeploymentType.LocalContainers) {
                    const localState = state.deploymentTypeState as LocalContainersState;
                    // The Azure container wizard does not initialize the legacy Docker state.
                    if (localState.dockerSteps) {
                        localContainers.sendLocalContainersCloseEventTelemetry(
                            localState,
                            this.workflowCorrelationId,
                        );
                    }
                } else if (state.deploymentType === DeploymentType.FabricProvisioning) {
                    fabricProvisioning.sendFabricProvisioningCloseEventTelemetry(
                        state.deploymentTypeState as FabricProvisioningState,
                        this.workflowCorrelationId,
                    );
                } else if (state.deploymentType === DeploymentType.AzureSqlDatabase) {
                    azureSqlDatabase.sendAzureSqlDatabaseCloseEventTelemetry(
                        state.deploymentTypeState as AzureSqlDatabaseState,
                        this.workflowCorrelationId,
                    );
                }
            } finally {
                this.panel.dispose();
                this.dispose();
            }
            return state;
        });

        this.registerReducer("downloadDeploymentScript", async (state, payload) => {
            const extension = payload.fileName.includes(".")
                ? payload.fileName.slice(payload.fileName.lastIndexOf(".") + 1)
                : undefined;
            const targetUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(payload.fileName),
                filters: extension ? { [extension.toUpperCase()]: [extension] } : undefined,
            });
            if (targetUri) {
                await vscode.workspace.fs.writeFile(
                    targetUri,
                    Buffer.from(payload.content, "utf8"),
                );
                await vscode.window.showTextDocument(targetUri, { preview: false });
            }
            return state;
        });

        this.registerReducer("addDeploymentScriptToWorkspace", async (state, payload) => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                void vscode.window.showErrorMessage(noWorkspaceOpenForDeploymentScript);
                return state;
            }

            const fileName = path.basename(payload.fileName);
            const targetUri = vscode.Uri.joinPath(workspaceFolder.uri, fileName);

            try {
                await vscode.workspace.fs.stat(targetUri);
                const overwrite = await vscode.window.showWarningMessage(
                    deploymentScriptAlreadyExists(fileName),
                    { modal: true },
                    overwriteDeploymentScript,
                );
                if (overwrite !== overwriteDeploymentScript) {
                    return state;
                }
            } catch (error) {
                if (!(error instanceof vscode.FileSystemError && error.code === "FileNotFound")) {
                    throw error;
                }
            }

            await vscode.workspace.fs.writeFile(targetUri, Buffer.from(payload.content, "utf8"));
            await vscode.window.showTextDocument(targetUri, { preview: false });
            return state;
        });

        localContainers.registerLocalContainersReducers(this);
        fabricProvisioning.registerFabricProvisioningReducers(this);
        azureSqlDatabase.registerAzureSqlDatabaseReducers(this);
        azureSql.registerAzureSqlRpcHandlers(this);
        let localWizardOpenedAt: number | undefined;
        this.registerDisposable(
            new vscode.Disposable(() => {
                if (localWizardOpenedAt !== undefined) {
                    sendActionEvent(TelemetryViews.LocalToCloudDeployment, TelemetryActions.Close, {
                        additionalProps: { workflowCorrelationId: this.workflowCorrelationId },
                        additionalMeasurements: {
                            durationInMs: performance.now() - localWizardOpenedAt,
                        },
                    });
                }
            }),
        );
        const compatibilityOutput = getMssqlOutputChannel();
        const compatibility = new LocalDatabaseCompatibilityService(
            this.mainController.connectionManager,
            SqlToolsServiceClient.instance,
            this.mainController.sqlTasksService,
            this.mainController.sqlProjectsService,
            this.mainController.dacFxService,
            new AzureSqlCompatibilityBuilder(compatibilityOutput),
            this.logger,
            this.workflowCorrelationId,
        );
        const deployment = new LocalDatabaseDeploymentService(
            this,
            compatibility,
            SqlToolsServiceClient.instance,
            compatibilityOutput,
            this.logger,
        );
        this.registerDisposable(deployment);
        this.onRequest(
            AzureSqlDatabaseRequests.LocalDatabaseDeploymentAction,
            ({ deploymentId, action }) => deployment.performAction(deploymentId, action),
        );
        this.onRequest(AzureSqlDatabaseRequests.DeployLocalDatabase, (request) =>
            deployment.deploy(request, (progress) => {
                void this.sendNotification(
                    AzureSqlDatabaseRequests.LocalDatabaseDeploymentProgress,
                    progress,
                ).catch((error) =>
                    this.logger.error("Failed to report database deployment progress.", error),
                );
            }),
        );
        this.onRequest(AzureSqlDatabaseRequests.CancelLocalDatabaseDeployment, ({ deploymentId }) =>
            deployment.cancel(deploymentId),
        );
        this.onRequest(AzureSqlDatabaseRequests.ShowLocalDatabaseCompatibilityOutput, () =>
            compatibilityOutput.show(true),
        );
        this.onRequest(AzureSqlDatabaseRequests.ValidateLocalDatabaseCompatibility, (request) => {
            if (deployment.isRunning) {
                throw new Error(LocalToCloud.invalidDeployment);
            }
            return compatibility
                .validate(request, (progress) => {
                    void this.sendNotification(
                        AzureSqlDatabaseRequests.LocalDatabaseCompatibilityProgress,
                        progress,
                    ).catch((error) =>
                        this.logger.error("Failed to report compatibility progress.", error),
                    );
                })
                .then((result) => {
                    this.recordDeploymentWorkflowEvent(
                        DeploymentWorkflowEventName.CompatibilityValidated,
                        DeploymentType.LocalToCloud,
                        {
                            outcome: CompatibilityOutcome[result.status],
                            telemetry: this.getLocalSourceTelemetry(request.sourceId, {
                                validationStatus: result.status,
                            }),
                        },
                    );
                    return result;
                });
        });
        this.onRequest(
            AzureSqlDatabaseRequests.CancelLocalDatabaseCompatibility,
            ({ validationId }) =>
                deployment.isRunning ? Promise.resolve() : compatibility.cancel(validationId),
        );
        this.onRequest(AzureSqlDatabaseRequests.ClearLocalDatabaseCompatibility, () =>
            deployment.isRunning ? Promise.resolve() : compatibility.clear(),
        );
        this.onRequest(AzureSqlDatabaseRequests.GetLocalDatabaseSources, async () => {
            if (localWizardOpenedAt === undefined) {
                localWizardOpenedAt = performance.now();
                sendActionEvent(TelemetryViews.LocalToCloudDeployment, TelemetryActions.Open, {
                    additionalProps: { workflowCorrelationId: this.workflowCorrelationId },
                });
                this.recordDeploymentWorkflowEvent(
                    DeploymentWorkflowEventName.DeploymentTypeSelected,
                    DeploymentType.LocalToCloud,
                );
            }
            const manager = this.mainController.connectionManager;
            const connections = await manager.connectionStore.readAllConnections();
            const savedProfileIds = new Set(connections.map((connection) => connection.id));
            const activeConnections = Object.entries(manager.activeConnections)
                .filter(
                    ([uri, connection]) =>
                        savedProfileIds.has(getLocalDatabaseProfileId(connection)) &&
                        manager.isConnected(uri),
                )
                .map(([, connection]) => ({
                    ...connection.credentials,
                    isConnected: true,
                    serverVersion: connection.serverInfo?.serverVersion,
                    isAzureSql: isAzureSqlDatabaseSource(connection.serverInfo),
                    id: getLocalDatabaseProfileId(connection),
                }));
            return getLocalDatabaseSources([...connections, ...activeConnections]);
        });
        const pendingConnections = new Map<string, Promise<LocalDatabaseSource>>();
        const pendingServerDatabases = new Map<string, Promise<string[]>>();
        this.onRequest(AzureSqlDatabaseRequests.GetLocalServerDatabases, async ({ id }) => {
            const pending = pendingServerDatabases.get(id);
            if (pending) {
                return pending;
            }
            const request = getLocalServerDatabases(
                this.mainController.connectionManager,
                id,
                SqlToolsServiceClient.instance,
            );
            pendingServerDatabases.set(id, request);
            try {
                return await request;
            } finally {
                pendingServerDatabases.delete(id);
            }
        });
        this.onRequest(
            AzureSqlDatabaseRequests.ConnectLocalDatabaseSource,
            async ({ id, database }) => {
                const key = JSON.stringify([id, database]);
                const pending = pendingConnections.get(key);
                if (pending) {
                    return pending;
                }
                const request = connectLocalDatabaseSource(
                    this.mainController.connectionManager,
                    id,
                    SqlToolsServiceClient.instance,
                    database,
                );
                pendingConnections.set(key, request);
                try {
                    const source = await request;
                    this.recordDeploymentWorkflowEvent(
                        DeploymentWorkflowEventName.SourceSelected,
                        DeploymentType.LocalToCloud,
                        { telemetry: this.getLocalSourceTelemetry(source.id) },
                    );
                    return source;
                } finally {
                    pendingConnections.delete(key);
                }
            },
        );
    }

    private applyFavoritesToFormComponents(state: DeploymentWebviewState): void {
        const favorites =
            this._context.globalState.get<DeploymentFavorites>(DEPLOYMENT_FAVORITES_STATE_KEY) ??
            {};

        for (const [propertyName, component] of Object.entries(state.formComponents)) {
            if (component.favoriteOptionIds === undefined) {
                continue;
            }

            component.favoriteOptionIds =
                favorites[this.getFavoriteKey(state.deploymentType, propertyName)] ?? [];
            const favoriteOption = findFirstFavoriteOption(
                component.options ?? [],
                component.favoriteOptionIds,
            );
            if (favoriteOption) {
                state.formState[propertyName] = favoriteOption.value;
            }
        }

        state.deploymentTypeState.formComponents = state.formComponents as any;
    }

    private getFavoriteKey(deploymentType: DeploymentType, propertyName: string): string {
        return `${DeploymentType[deploymentType]}.${propertyName}`;
    }

    /** Correlation ID of the deployment workflow, for joining deployment-specific telemetry. */
    public get workflowCorrelationId(): string {
        return this._workflow.correlationId;
    }

    /**
     * Records the start of a deployment that may outlive the panel.
     * @param telemetry Connection metadata for the deployment, when known.
     */
    public recordDeploymentStarted(
        deploymentType: DeploymentType,
        telemetry?: TelemetryEventOptions,
    ): void {
        this._runningDeployments.add(deploymentType);
        this.recordDeploymentWorkflowEvent(
            DeploymentWorkflowEventName.DeploymentStarted,
            deploymentType,
            { telemetry },
        );
    }

    /**
     * Records a deployment's outcome. Once the panel has closed, the last running deployment's
     * completion ends the workflow.
     * @param telemetry Connection metadata for the deployment, when known.
     */
    public recordDeploymentCompleted(
        deploymentType: DeploymentType,
        outcome: BackgroundTaskState,
        telemetry?: TelemetryEventOptions,
    ): void {
        this._runningDeployments.delete(deploymentType);
        this._deploymentSucceeded =
            outcome === BackgroundTaskState.Succeeded ||
            outcome === BackgroundTaskState.SucceededWithWarning;
        this.recordDeploymentWorkflowEvent(
            DeploymentWorkflowEventName.DeploymentCompleted,
            deploymentType,
            {
                outcome,
                telemetry,
                end: this._panelDisposed && this._runningDeployments.size === 0,
            },
        );
    }

    private recordDeploymentWorkflowEvent(
        eventName: DeploymentWorkflowStepEventName,
        deploymentType: DeploymentType,
        {
            outcome,
            telemetry = {},
            end = false,
        }: { outcome?: string; telemetry?: TelemetryEventOptions; end?: boolean } = {},
    ): void {
        const steps: Partial<Record<DeploymentWorkflowStepEventName, WorkflowStep>> =
            deploymentType === DeploymentType.LocalToCloud
                ? LocalToCloudWorkflowStep
                : DeploymentWorkflowStep;
        const step: WorkflowStep = {
            ...(steps[eventName] ?? { name: eventName }),
            branch: DeploymentType[deploymentType],
        };
        const options = { ...telemetry, step, outcome };
        if (end) {
            this._workflow.end(eventName, options);
        } else {
            this._workflow.record(eventName, options);
        }
    }

    /** Source connection metadata for a local-to-cloud workflow event. */
    private getLocalSourceTelemetry(
        sourceId: string,
        additionalProps: Record<string, string> = {},
    ): TelemetryEventOptions {
        const manager = this.mainController.connectionManager;
        const telemetry = getLocalToCloudConnectionTelemetry(
            manager,
            "source",
            findActiveLocalSourceUri(manager, sourceId),
        );
        return mergeTelemetryOptions(telemetry, { additionalProps });
    }

    async updateItemVisibility() {}

    protected getActiveFormComponents(
        state: DeploymentWebviewState,
    ): (keyof DeploymentFormState)[] {
        return Object.keys(state.formComponents) as (keyof DeploymentFormState)[];
    }

    private async handleDeploymentFormAction(state, payload) {
        const authenticationChanged =
            payload.event.propertyName === "authenticationType" &&
            state.formState.authenticationType !== payload.event.value;
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

        // For Azure SQL Database, reset downstream components when an azure field changes
        if (state.deploymentType === DeploymentType.AzureSqlDatabase) {
            const componentOrder = AZURE_SQL_DB_COMPONENT_ORDER as readonly string[];
            if (componentOrder.includes(payload.event.propertyName)) {
                azureSqlDatabase.reloadAzureComponentsDownstream(
                    state.deploymentTypeState as AzureSqlDatabaseState,
                    payload.event.propertyName,
                );
            }
            // Re-detect auth type when user selects a different server
            if (payload.event.propertyName === "serverName") {
                const azureSqlState = state.deploymentTypeState as AzureSqlDatabaseState;
                // Reset the flag so applyServerAuthSettings can detect auth from the new server
                azureSqlState.serverCreatedWithAuth = false;
                azureSqlDatabase.applyServerAuthSettings(
                    azureSqlState,
                    payload.event.value as string,
                );
            }
            if (authenticationChanged) {
                azureSqlDatabase.applyAuthenticationSelection(
                    state.deploymentTypeState as AzureSqlDatabaseState,
                );
                await this.validateDeploymentForm();
            }
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
            if (!component?.validate) return errors;
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
                if (!component?.validate) continue;
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

    public override dispose(): void {
        if (!this._panelDisposed) {
            this._panelDisposed = true;
            // The current step already carries the workflow branch, which may differ from the
            // form's deployment type (local-to-cloud uses the Azure SQL Database form).
            const step = this._workflow.currentStep;
            if (this._runningDeployments.size > 0) {
                // Deployments continue in the background; the last completion ends the workflow.
                this._workflow.record(DeploymentWorkflowEventName.PanelClosed, { step });
            } else {
                this._workflow.end(DeploymentWorkflowEventName.Closed, {
                    outcome: this._deploymentSucceeded ? "Succeeded" : "Cancelled",
                    step,
                });
            }
        }
        super.dispose();
    }
}
