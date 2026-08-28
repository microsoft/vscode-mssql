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
import { TelemetryViews } from "../sharedInterfaces/telemetry";
import { ApiStatus } from "../sharedInterfaces/webview";
import * as localContainers from "./localContainersHelpers";
import { LocalContainersState } from "../sharedInterfaces/localContainers";
import * as fabricProvisioning from "./fabricProvisioningHelpers";
import * as azureSqlDatabase from "./azureSqlDatabaseHelpers";
import {
    deploymentScriptAlreadyExists,
    newDeployment,
    noWorkspaceOpenForDeploymentScript,
    overwriteDeploymentScript,
} from "../constants/locConstants";
import { FabricProvisioningState } from "../sharedInterfaces/fabricProvisioning";
import {
    AzureSqlDatabaseState,
    AZURE_SQL_DB_COMPONENT_ORDER,
} from "../sharedInterfaces/azureSqlDatabase";
import { findFirstFavoriteOption } from "../sharedInterfaces/form";

export const DEPLOYMENT_VIEW_ID = "deployment";
const DEPLOYMENT_FAVORITES_STATE_KEY = "mssql.deploymentResourceFavorites";

type DeploymentFavorites = Record<string, string[]>;

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
    constructor(
        context: vscode.ExtensionContext,
        // Main controller is used to connect to the container after creation
        public mainController: MainController,
        initialConnectionGroup?: string,
    ) {
        super(context, DEPLOYMENT_VIEW_ID, DEPLOYMENT_VIEW_ID, new DeploymentWebviewState(), {
            title: newDeployment,
            viewColumn: vscode.ViewColumn.Active,
            iconPath: {
                dark: vscode.Uri.joinPath(context.extensionUri, "media", "deployment.svg"),
                light: vscode.Uri.joinPath(context.extensionUri, "media", "deployment.svg"),
            },
        });
        void this.initialize(initialConnectionGroup);
    }

    private async initialize(initialConnectionGroup?: string) {
        // If an initial connection group was provided, try to pre-populate the form state
        if (initialConnectionGroup) {
            this.state.formState.groupId = initialConnectionGroup;
        }
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
            state.deploymentTypeState.loadState = ApiStatus.Loading;
            this.updateState(state);
            const selectedGroupId = state?.formState?.groupId;

            // Initialize the appropriate deployment type state
            if (payload.deploymentType === DeploymentType.LocalContainers) {
                newDeploymentTypeState = await localContainers.initializeLocalContainersState(
                    state.connectionGroupOptions,
                    selectedGroupId,
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
            } else if (state.deploymentType === DeploymentType.AzureSqlDatabase) {
                azureSqlDatabase.sendAzureSqlDatabaseCloseEventTelemetry(
                    state.deploymentTypeState as AzureSqlDatabaseState,
                );
            }

            this.panel.dispose();
            this.dispose();
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

    async updateItemVisibility() {}

    protected getActiveFormComponents(
        state: DeploymentWebviewState,
    ): (keyof DeploymentFormState)[] {
        return Object.keys(state.formComponents) as (keyof DeploymentFormState)[];
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
}
