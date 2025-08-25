/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import MainController from "../controllers/mainController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { FormWebviewController } from "../forms/formWebviewController";
import {
    FabricProvisioningFormState,
    FabricProvisioningWebviewState,
    FabricProvisioningFormItemSpec,
    FabricProvisioningReducers,
} from "../sharedInterfaces/fabricProvisioning";
import { ApiStatus } from "../sharedInterfaces/webview";
import { getAccounts } from "../connectionconfig/azureHelpers";
import {
    FormItemActionButton,
    FormItemOptions,
    FormItemSpec,
    FormItemType,
} from "../sharedInterfaces/form";
import { ConnectionDialog, Fabric, FabricProvisioning } from "../constants/locConstants";
import { getAccountActionButtons } from "../connectionconfig/sharedConnectionDialogUtils";
import { FabricHelper } from "../fabric/fabricHelper";

export class FabricProvisioningWebviewController extends FormWebviewController<
    FabricProvisioningFormState,
    FabricProvisioningWebviewState,
    FabricProvisioningFormItemSpec,
    FabricProvisioningReducers
> {
    requiredInputs: FabricProvisioningFormItemSpec[];
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        // Main controller is used to connect to the container after creation
        public mainController: MainController,
    ) {
        super(
            context,
            vscodeWrapper,
            "fabricProvisioning",
            "fabricProvisioning",
            new FabricProvisioningWebviewState(),
            {
                title: "Fabric Provisioning",
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
            },
        );
        void this.initialize();
    }

    private async initialize() {
        const startTime = Date.now();
        this.state.loadState = ApiStatus.Loading;
        const connectionGroupOptions =
            await this.mainController.connectionManager.connectionUI.getConnectionGroupOptions();
        const azureAccountOptions = await getAccounts(
            this.mainController.azureAccountService,
            this.logger,
        );
        this.state.formState = {
            accountId: azureAccountOptions.length > 0 ? azureAccountOptions[0].value : "",
            groupId: connectionGroupOptions[0].value,
            workspace: "",
            databaseName: "",
        } as FabricProvisioningFormState;
        const azureActionButtons = await this.getAzureActionButtons();

        this.state.formComponents = this.setFabricProvisioningFormComponents(
            azureAccountOptions,
            azureActionButtons,
            this.getWorkspaceOptions(),
        );
        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
        this.updateState();
        this.getWorkspaces();
        console.log("Load stats: ", Date.now() - startTime);
    }

    private registerRpcHandlers() {
        this.registerReducer("formAction", async (state, payload) => {
            if (state.formState) {
                (state.formState as any)[payload.event.propertyName] = payload.event.value;
            }

            if (payload.event.propertyName === "accountId") {
                state.workspaces = [];
                this.updateState(state);
                this.getWorkspaces();
            }
            return state;
        });
        this.registerReducer("loadWorkspaces", async (state, _payload) => {
            if (this.state.workspaces) {
                state.workspaces = this.state.workspaces;
            }
            return state;
        });
    }

    async updateItemVisibility() {}

    protected getActiveFormComponents(
        state: FabricProvisioningWebviewState,
    ): (keyof FabricProvisioningFormState)[] {
        return Object.keys(state.formComponents) as (keyof FabricProvisioningFormState)[];
    }

    private setFabricProvisioningFormComponents(
        azureAccountOptions: FormItemOptions[],
        azureActionButtons: FormItemActionButton[],
        workspaceOptions: FormItemOptions[],
    ): Record<
        string,
        FormItemSpec<
            FabricProvisioningFormState,
            FabricProvisioningWebviewState,
            FabricProvisioningFormItemSpec
        >
    > {
        const createFormItem = (
            spec: Partial<FabricProvisioningFormItemSpec>,
        ): FabricProvisioningFormItemSpec =>
            ({
                required: false,
                isAdvancedOption: false,
                ...spec,
            }) as FabricProvisioningFormItemSpec;

        return {
            accountId: createFormItem({
                propertyName: "accountId",
                label: Fabric.fabricAccount,
                required: true,
                type: FormItemType.Dropdown,
                options: azureAccountOptions,
                placeholder: ConnectionDialog.selectAnAccount,
                actionButtons: azureActionButtons,
                validate: (_state: FabricProvisioningWebviewState, value: string) => ({
                    isValid: !!value,
                    validationMessage: value ? "" : Fabric.fabricAccountIsRequired,
                }),

                isAdvancedOption: false,
            }),
            workspace: createFormItem({
                propertyName: "workspace",
                label: Fabric.workspace,
                required: true,
                type: FormItemType.SearchableDropdown,
                options: workspaceOptions,
                isAdvancedOption: false,
                placeholder: Fabric.selectAWorkspace,
                searchBoxPlaceholder: Fabric.searchWorkspaces,
                validate: (_state: FabricProvisioningWebviewState, value: string) => ({
                    isValid: !!value,
                    validationMessage: value ? "" : Fabric.workspaceIsRequired,
                }),
            }),
            databaseName: createFormItem({
                propertyName: "databaseName",
                type: FormItemType.Input,
                label: FabricProvisioning.databaseName,
                isAdvancedOption: true,
                placeholder: FabricProvisioning.enterDatabaseName,
                validate: (_state: FabricProvisioningWebviewState, value: string) => ({
                    isValid: !!value,
                    validationMessage: value ? "" : FabricProvisioning.databaseNameIsRequired,
                }),
            }),
        };
    }

    private async getAzureActionButtons(): Promise<FormItemActionButton[]> {
        return await getAccountActionButtons(
            this,
            this.getFormComponent(this.state, "accountId"),
            this.mainController.azureAccountService,
            this.logger,
            this.vscodeWrapper,
            this.loadWorkspacesAfterSignIn,
        );
    }

    private async loadWorkspacesAfterSignIn(_propertyName: string) {
        const accountComponent = this.getFormComponent(this.state, "accountId");
        accountComponent.actionButtons = await this.getAzureActionButtons();
        this.state.workspaces = await FabricHelper.getFabricWorkspaces();
        const workspaceComponent = this.getFormComponent(this.state, "workspace");
        workspaceComponent.options = this.getWorkspaceOptions();
        this.updateState();
    }

    private getWorkspaceOptions(): FormItemOptions[] {
        return this.state.workspaces.map((workspace) => ({
            displayName: workspace.displayName,
            value: workspace.id,
        }));
    }

    private getWorkspaces(): void {
        FabricHelper.getFabricWorkspaces()
            .then((workspaces) => {
                this.state.workspaces = workspaces;
                const workspaceComponent = this.getFormComponent(this.state, "workspace");
                workspaceComponent.options = this.getWorkspaceOptions();
            })
            .catch((err) => {
                console.error("Failed to load workspaces", err);
            });
        this.updateState();
    }
}
