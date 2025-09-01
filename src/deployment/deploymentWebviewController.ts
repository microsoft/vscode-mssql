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
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { ApiStatus } from "../sharedInterfaces/webview";
import * as localContainers from "./localContainersWebviewUtils";
import { LocalContainersState } from "../sharedInterfaces/localContainers";
import * as fabricProvisioning from "./fabricProvisioningWebviewUtils";
import { newDeployment } from "../constants/locConstants";
import { sendActionEvent } from "../telemetry/telemetry";

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
            if (payload.deploymentType === DeploymentType.LocalContainers) {
                sendActionEvent(
                    TelemetryViews.LocalContainers,
                    TelemetryActions.StartLocalContainersDeployment,
                );
                newDeploymentTypeState = await localContainers.initializeLocalContainersState(
                    new LocalContainersState(),
                    state.connectionGroupOptions,
                );
            } else if (payload.deploymentType === DeploymentType.FabricProvisioning) {
                sendActionEvent(
                    TelemetryViews.FabricProvisioning,
                    TelemetryActions.StartFabricProvisioningDeployment,
                );
                newDeploymentTypeState = await fabricProvisioning.initializeFabricProvisioningState(
                    this,
                    state.connectionGroupOptions,
                    this.logger,
                );
            }
            state.deploymentTypeState = newDeploymentTypeState;
            state.formState = newDeploymentTypeState.formState;
            state.formComponents = newDeploymentTypeState.formComponents as any;
            this.updateState(state);
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

            this.updateState(state);
            return state;
        });

        this.registerReducer("setConnectionGroupDialogState", async (state, payload) => {
            if (payload.shouldOpen) {
                state = getDefaultConnectionGroupDialogProps(state) as DeploymentWebviewState;
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
                sendActionEvent(
                    TelemetryViews.FabricProvisioning,
                    TelemetryActions.FinishFabricProvisioningDeployment,
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
    ): Promise<string[]> {
        let errors: string[] = [];
        if (propertyName) {
            const component = this.state.deploymentTypeState.formComponents[propertyName];
            if (!component.validate) return errors;
            const componentValidation = component.validate(
                this.state.deploymentTypeState as any,
                this.state.deploymentTypeState.formState[propertyName],
            );
            if (!componentValidation) {
                errors.push(propertyName);
            }
            component.validation = componentValidation;
        } else {
            for (const componentKey of Object.keys(this.state.deploymentTypeState.formState)) {
                const component = this.state.deploymentTypeState.formComponents[componentKey];
                if (!component.validate) continue;
                const componentValidation = component.validate(
                    this.state.deploymentTypeState as any,
                    this.state.deploymentTypeState.formState[componentKey],
                );
                if (!componentValidation) {
                    errors.push(componentKey);
                }
                component.validation = componentValidation;
            }
        }
        return errors;
    }
}
