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
import { getAccounts, getTenants } from "../connectionconfig/azureHelpers";
import {
    FormItemActionButton,
    FormItemOptions,
    FormItemSpec,
    FormItemType,
} from "../sharedInterfaces/form";
import { ConnectionDialog, Fabric, FabricProvisioning } from "../constants/locConstants";
import { getAccountActionButtons } from "../connectionconfig/sharedConnectionDialogUtils";
import { FabricHelper } from "../fabric/fabricHelper";
import { getGroupIdFormItem } from "../connectionconfig/formComponentHelpers";
import { FabricScopes } from "../sharedInterfaces/fabric";

export class FabricProvisioningWebviewController extends FormWebviewController<
    FabricProvisioningFormState,
    FabricProvisioningWebviewState,
    FabricProvisioningFormItemSpec,
    FabricProvisioningReducers
> {
    // Fabric request definitions
    readonly fabricScopes: FabricScopes[] = [
        FabricScopes.ItemReadWrite,
        FabricScopes.WorskpaceReadWrite,
    ];
    readonly fabricTokenRequestReason = "Provision workspaces and SQL Databases in Fabric";

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
        const defaultAccountId = azureAccountOptions.length > 0 ? azureAccountOptions[0].value : "";
        const tenantOptions = await getTenants(
            this.mainController.azureAccountService,
            defaultAccountId,
            this.logger,
        );
        this.state.formState = {
            accountId: defaultAccountId,
            groupId: connectionGroupOptions[0].value,
            tenantId: tenantOptions.length > 0 ? tenantOptions[0].value : "",
            workspace: "",
            databaseName: "",
            databaseDescription: "",
        } as FabricProvisioningFormState;

        const azureActionButtons = await this.getAzureActionButtons();
        this.state.formComponents = this.setFabricProvisioningFormComponents(
            azureAccountOptions,
            azureActionButtons,
            connectionGroupOptions,
            tenantOptions,
        );
        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
        this.updateState();
        // this.getCapacities();
        // this.createWorkspace();
        // this.provisionDatabase();
        // this.getWorkspaces();
        console.log("Load stats: ", Date.now() - startTime);
    }

    private registerRpcHandlers() {
        this.registerReducer("reloadFabricEnvironment", async (state, payload) => {
            state.workspaces = [];
            await this.reloadFabricComponents(payload.newTenant);
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
        groupOptions: FormItemOptions[],
        tenantOptions: FormItemOptions[],
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
                options: [],
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
                required: true,
                label: FabricProvisioning.databaseName,
                isAdvancedOption: false,
                placeholder: FabricProvisioning.enterDatabaseName,
                validate: (_state: FabricProvisioningWebviewState, value: string) => ({
                    isValid: !!value,
                    validationMessage: value ? "" : FabricProvisioning.databaseNameIsRequired,
                }),
            }),
            tenantId: createFormItem({
                propertyName: "tenantId",
                label: ConnectionDialog.tenantId,
                required: true,
                type: FormItemType.Dropdown,
                options: tenantOptions,
                placeholder: ConnectionDialog.selectATenant,
                validate: (_state: FabricProvisioningWebviewState, value: string) => ({
                    isValid: !!value,
                    validationMessage: value ? "" : ConnectionDialog.tenantIdIsRequired,
                }),
            }),
            databaseDescription: createFormItem({
                propertyName: "databaseDescription",
                label: FabricProvisioning.databaseDescription,
                required: false,
                type: FormItemType.Input,
                isAdvancedOption: true,
                placeholder: FabricProvisioning.enterDatabaseDescription,
            }),
            profileName: createFormItem({
                type: FormItemType.Input,
                propertyName: "profileName",
                label: ConnectionDialog.profileName,
                tooltip: ConnectionDialog.profileNameTooltip,
                placeholder: ConnectionDialog.profileNamePlaceholder,
            }),
            groupId: createFormItem(
                getGroupIdFormItem(groupOptions) as FabricProvisioningFormItemSpec,
            ),
        };
    }

    private async getAzureActionButtons(): Promise<FormItemActionButton[]> {
        return await getAccountActionButtons(
            this,
            this.getFormComponent(this.state, "accountId"),
            this.mainController.azureAccountService,
            this.logger,
            this.vscodeWrapper,
            this.loadComponentsAfterSignIn,
        );
    }

    private async loadComponentsAfterSignIn(_propertyName: string) {
        const accountComponent = this.getFormComponent(this.state, "accountId");

        // Reload tenant options
        const tenantComponent = this.getFormComponent(this.state, "tenantId");
        const tenants = await getTenants(
            this.mainController.azureAccountService,
            this.state.formState.accountId,
            this.logger,
        );
        if (tenantComponent) {
            tenantComponent.options = tenants;
            if (
                tenants.length > 0 &&
                !tenants.find((t) => t.value === this.state.formState.tenantId)
            ) {
                // if expected tenantId is not in the list of tenants, set it to the first tenant
                this.state.formState.tenantId = tenants[0].value;
                await this.validateForm(this.state.formState, "tenantId");
            }
        }
        accountComponent.actionButtons = await this.getAzureActionButtons();

        await this.reloadFabricComponents();
    }

    private async reloadFabricComponents(tenantId?: string) {
        this.state.workspaces = [];
        this.updateState();
        this.getWorkspaces(tenantId);
    }

    private getWorkspaceOptions(): FormItemOptions[] {
        return this.state.workspaces.map((workspace) => ({
            displayName: workspace.displayName,
            value: workspace.id,
        }));
    }

    // private getCapacities(tenantId?: string): void {
    //     if (this.state.formState.tenantId === "" && !tenantId) return;
    //     FabricHelper.getFabricCapacities(tenantId || this.state.formState.tenantId)
    //         .then((capacities) => {
    //             this.state.capacities = capacities;
    //             console.log(capacities);
    //         })
    //         .catch((err) => {
    //             console.error("Failed to load capacities", err);
    //         });
    //     this.updateState();
    // }

    private getWorkspaces(tenantId?: string): void {
        if (this.state.formState.tenantId === "" && !tenantId) return;
        FabricHelper.getFabricWorkspaces(tenantId || this.state.formState.tenantId)
            .then((workspaces) => {
                this.state.workspaces = workspaces;
                const workspaceComponent = this.getFormComponent(this.state, "workspace");
                workspaceComponent.options = this.getWorkspaceOptions();
                console.log(workspaces);
            })
            .catch((err) => {
                console.error("Failed to load workspaces", err);
            });
        this.updateState();
    }

    // private createWorkspace(tenantId?: string): void {
    //     if (this.state.formState.tenantId === "" && !tenantId) return;
    //     FabricHelper.createWorkspace(
    //         "74AA88A9-67E2-4072-9C63-B20ABCCD5947", // test capacity
    //         "testExtensionWorkspace",
    //         "test workspace create from vscode",
    //         tenantId || this.state.formState.tenantId,
    //     )
    //         .then((workspace) => {
    //             console.log(workspace);
    //         })
    //         .catch((err) => {
    //             console.error("Failed to create workspaces", err);
    //         });
    //     this.updateState();
    // }

    // private provisionDatabase(tenantId?: string): void {
    //     if (this.state.formState.tenantId === "" && !tenantId) return;
    //     FabricHelper.createFabricSqlDatabase(
    //         "713e4fb1-4c16-47bf-9b14-fed39843ead0", // workspace id
    //         "testExtensionDatabase",
    //         "test database provision from vscode",
    //         tenantId || this.state.formState.tenantId,
    //     )
    //         .then((database) => {
    //             console.log(database);
    //         })
    //         .catch((err) => {
    //             console.error("Failed to create database", err);
    //         });
    //     this.updateState();
    // }
}
