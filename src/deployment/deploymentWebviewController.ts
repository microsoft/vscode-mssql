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
import * as localContainers from "./localContainersWebviewUtils";
import { LocalContainersWebviewState } from "../sharedInterfaces/localContainers";
import * as fabricProvisioning from "./fabricProvisioningWebviewUtils";
import { FabricProvisioningWebviewState } from "../sharedInterfaces/fabricProvisioning";

export class DeploymentWebviewController extends FormWebviewController<
    DeploymentFormState,
    DeploymentWebviewState,
    DeploymentFormItemSpec,
    DeploymentReducers
> {
    requiredInputs: DeploymentFormItemSpec[];
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        // Main controller is used to connect to the container after creation
        public mainController: MainController,
    ) {
        super(context, vscodeWrapper, "deployment", "deployment", new DeploymentWebviewState(), {
            title: "Deployment Overview",
            viewColumn: vscode.ViewColumn.Active,
            iconPath: {
                dark: vscode.Uri.joinPath(
                    context.extensionUri,
                    "media",
                    "connectionDialogEditor_dark.svg",
                ),
                light: vscode.Uri.joinPath(
                    context.extensionUri,
                    "media",
                    "connectionDialogEditor_light.svg",
                ),
            },
        });
        void this.initialize();
    }

    private async initialize() {
        this.state.loadState = ApiStatus.Loading;
        this.state.connectionGroupOptions =
            await this.mainController.connectionManager.connectionUI.getConnectionGroupOptions();
        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
        this.updateState();
    }

    private registerRpcHandlers() {
        this.registerReducer("initializeDeploymentSpecifics", async (state, payload) => {
            let newDeploymentTypeState: DeploymentTypeState;
            if (payload.deploymentType === DeploymentType.LocalContainers) {
                newDeploymentTypeState = await localContainers.initializeLocalContainersState(
                    new LocalContainersWebviewState(),
                    state.connectionGroupOptions,
                );
            } else if (payload.deploymentType === DeploymentType.FabricProvisioning) {
                newDeploymentTypeState = await fabricProvisioning.initializeFabricProvisioningState(
                    this,
                    state.connectionGroupOptions,
                    this.logger,
                );
            }
            state.deploymentTypeState = newDeploymentTypeState;
            state.formState = newDeploymentTypeState.formState;
            state.formComponents = newDeploymentTypeState.formComponents as any;
            state.isDeploymentTypeInitialized = true;
            this.updateState(state);
            return state;
        });

        this.registerReducer("formAction", async (state, payload) => {
            let newDeploymentTypeState: DeploymentTypeState = state.deploymentTypeState;
            if (state.deploymentType === DeploymentType.LocalContainers) {
                newDeploymentTypeState = await localContainers.handleLocalContainersFormAction(
                    state.deploymentTypeState as LocalContainersWebviewState,
                    payload,
                );
            }
            state.deploymentTypeState = newDeploymentTypeState;

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

            this.updateState(state);
            return state;
        });

        this.registerReducer("setConnectionGroupDialogState", async (state, payload) => {
            if (payload.shouldOpen) {
                state = getDefaultConnectionGroupDialogProps(state) as DeploymentWebviewState;
            } else {
                state.dialog = undefined;
            }
            return state;
        });

        this.registerReducer("dispose", async (state, _payload) => {
            if (state.deploymentType === DeploymentType.LocalContainers) {
                localContainers.sendLocalContainersCloseEventTelemetry(
                    state.deploymentTypeState as LocalContainersWebviewState,
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

    public async validateDeploymentForm(
        propertyName?: keyof DeploymentFormState,
    ): Promise<string[]> {
        this.state.formState = this.state.deploymentTypeState.formState;
        // @ts-ignore
        this.state.formComponents = this.state.deploymentTypeState.formComponents;
        const formErrors = (await this.validateForm(
            this.state.formState,
            propertyName,
            undefined,
            this,
        )) as string[];
        return formErrors;
    }
}
