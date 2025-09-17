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
import { LocalContainersState } from "../sharedInterfaces/localContainers";
import * as fabricProvisioning from "./fabricProvisioningHelpers";
import { newDeployment } from "../constants/locConstants";
import { FabricProvisioningState } from "../sharedInterfaces/fabricProvisioning";

/*
 Since there's one overarching controller for all deployment types, but each deployment type has differently typed form states + webview states,
 there are two form states- one with the overall controller (required because it extends FormWebviewController), and one with each specific deployment state
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
        vscodeWrapper: VscodeWrapper,
        // Main controller is used to connect to the container after creation
        public mainController: MainController,
        initialConnectionGroup?: { id?: string },
    ) {
        super(context, vscodeWrapper, "deployment", "deployment", new DeploymentWebviewState(), {
            title: newDeployment,
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
        // If an initial connection group was provided, try to pre-populate the form state
        if (initialConnectionGroup && initialConnectionGroup.id) {
            (this.state.formState as any).groupId = initialConnectionGroup.id;
        }
        void this.initialize();
    }

    private async initialize() {
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
            const selectedGroupId = (state.formState as any)?.groupId;

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
            }

            // Capture the initial deployment specific state in the overall controller's state
            state.deploymentTypeState = newDeploymentTypeState;
            state.formState = newDeploymentTypeState.formState;
            state.formComponents = newDeploymentTypeState.formComponents as any;
            return state;
        });

        this.registerReducer("formAction", async (state, payload) => {
            if (state.deploymentType === DeploymentType.LocalContainers) {
                state.deploymentTypeState = await localContainers.handleLocalContainersFormAction(
                    state.deploymentTypeState as LocalContainersState,
                    payload,
                );
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
            console.log("Creating connection group with spec:", payload.connectionGroupSpec);
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
            state.deploymentTypeState.dialog = state.dialog;

            return state;
        });

        this.registerReducer("setConnectionGroupDialogState", async (state, payload) => {
            if (payload.shouldOpen) {
                state = getDefaultConnectionGroupDialogProps(state) as DeploymentWebviewState;
            } else {
                state.dialog = undefined;
            }
            state.dialog.props.parentId = state.formState.groupId;
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
}
