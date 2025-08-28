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
import {
    hasWorkspacePermission,
    IWorkspace,
    WorkspaceRole,
    WorkspaceRoleRank,
} from "../sharedInterfaces/fabric";
import { tokens } from "@fluentui/react-components";
import {
    createConnectionGroup,
    getDefaultConnectionGroupDialogProps,
} from "../controllers/connectionGroupWebviewController";
import { IConnectionGroup } from "../sharedInterfaces/connectionGroup";
import { TelemetryViews } from "../sharedInterfaces/telemetry";
import { fetchUserGroups } from "../azure/utils";

export class FabricProvisioningWebviewController extends FormWebviewController<
    FabricProvisioningFormState,
    FabricProvisioningWebviewState,
    FabricProvisioningFormItemSpec,
    FabricProvisioningReducers
> {
    defaultWorkspacePermissionsCap = 20;
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
        this.getWorkspaces();
        console.log("Load stats: ", Date.now() - startTime);
    }

    private registerRpcHandlers() {
        this.registerReducer("reloadFabricEnvironment", async (state, payload) => {
            state.workspaces = [];
            await this.reloadFabricComponents(payload.newTenant);
            return state;
        });
        this.registerReducer("handleWorkspaceFormAction", async (state, payload) => {
            const workspace = state.workspacesWithPermissions[payload.workspaceId];
            if (workspace && !workspace.role) {
                delete state.workspacesWithPermissions[workspace.id];
                const workspaceWithRole = await this.getRoleForWorkspace(
                    workspace,
                    state.formState.tenantId,
                );
                if (hasWorkspacePermission(workspaceWithRole.role, WorkspaceRole.Contributor)) {
                    state.workspacesWithPermissions[workspaceWithRole.id] = workspaceWithRole;
                } else {
                    state.workspacesWithoutPermissions[workspaceWithRole.id] = workspaceWithRole;
                }
                this.state.workspacesWithPermissions = state.workspacesWithPermissions;
                this.state.workspacesWithoutPermissions = state.workspacesWithoutPermissions;
                state.formComponents.workspace.options = this.getWorkspaceOptions();
            }
            state.formState.workspace = payload.workspaceId;
            const workspaceComponent = this.getFormComponent(state, "workspace");
            const validation = workspaceComponent.validate(state, state.formState.workspace);
            workspaceComponent.validation = validation;
            if (!validation.isValid) {
                state.formErrors.push("workspace");
            }
            return state;
        });
        this.registerReducer("createDatabase", async (state, _payload) => {
            state.formValidationLoadState = ApiStatus.Loading;
            this.updateState(state);
            state.formErrors = await this.validateForm(state.formState);
            if (state.formErrors.length === 0) {
                this.provisionDatabase();
                state.deploymentStartTime = Date.now().toLocaleString();
                state.formValidationLoadState = ApiStatus.Loaded;
            } else {
                state.formValidationLoadState = ApiStatus.NotStarted;
            }
            this.updateState(state);
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
                state = getDefaultConnectionGroupDialogProps(
                    state,
                ) as FabricProvisioningWebviewState;
            } else {
                state.dialog = undefined;
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
                validate(state: FabricProvisioningWebviewState, value: string) {
                    {
                        console.log(state.workspaces);
                        console.log(value);
                        if (!value) {
                            return {
                                isValid: false,
                                validationMessage: Fabric.workspaceIsRequired,
                            };
                        }
                        const hasPermission = value in state.workspacesWithPermissions;
                        return {
                            isValid: hasPermission,
                            validationMessage: hasPermission
                                ? ""
                                : FabricProvisioning.workspacePermissionsError,
                        };
                    }
                },
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
        this.state.capacityIds = new Set<string>();
        this.state.userGroupIds = new Set<string>();
        this.state.workspaces = [];
        this.updateState();
        this.getWorkspaces(tenantId);
    }

    private getWorkspaceOptions(): FormItemOptions[] {
        const orderedWorkspaces = [
            ...Object.values(this.state.workspacesWithPermissions),
            ...Object.values(this.state.workspacesWithoutPermissions),
        ];
        return orderedWorkspaces.map((workspace) => {
            const hasPermission = workspace.id in this.state.workspacesWithPermissions;

            let description = "";
            if (workspace.hasCapacityPermissionsForProvisioning === false) {
                description = Fabric.insufficientCapacityPermissions;
            } else if (!hasPermission) {
                description = Fabric.insufficientWorkspacePermissions;
            }

            return {
                displayName: workspace.displayName,
                value: workspace.id,
                style: hasPermission ? {} : { color: tokens.colorNeutralForegroundDisabled },
                description: description,
                icon: hasPermission ? undefined : "Warning20Regular",
            };
        });
    }

    private getWorkspaces(tenantId?: string): void {
        if (this.state.formState.tenantId === "" && !tenantId) return;

        const startTime = Date.now();
        tenantId = tenantId || this.state.formState.tenantId;

        this.getCapacities(tenantId)
            .then(() => {
                return FabricHelper.getFabricWorkspaces(tenantId);
            })
            .then((workspaces) => {
                return this.sortWorkspacesByPermission(workspaces, WorkspaceRole.Contributor);
            })
            .then((filteredWorkspaces) => {
                this.state.workspaces = filteredWorkspaces;
                const workspaceOptions = this.getWorkspaceOptions();
                this.state.formComponents.workspace.options = workspaceOptions;
                this.state.formState.workspace =
                    workspaceOptions.length > 0 ? workspaceOptions[0].value : "";
                this.updateState();
                console.log(Date.now() - startTime);
            })
            .catch((err) => {
                console.error("Failed to load workspaces", err);
            });
    }

    private provisionDatabase(tenantId?: string): void {
        if (this.state.formState.tenantId === "" && !tenantId) return;
        FabricHelper.createFabricSqlDatabase(
            this.state.formState.workspace,
            this.state.formState.databaseName,
            this.state.formState.databaseDescription,
            tenantId || this.state.formState.tenantId,
        )
            .then((database) => {
                this.state.database = database;
                this.updateState();
            })
            .catch((err) => {
                console.error("Failed to create database", err);
            });
    }

    private async getCapacities(tenantId?: string): Promise<void> {
        if (this.state.formState.tenantId === "" && !tenantId) return;
        if (this.state.capacityIds.size !== 0) return;
        try {
            const capacities = await FabricHelper.getFabricCapacities(
                tenantId || this.state.formState.tenantId,
            );
            this.state.capacityIds = new Set(capacities.map((capacities) => capacities.id));
        } catch (err) {
            console.error("Failed to load capacities", err);
        }
    }

    private async getRoleForWorkspace(
        workspace: IWorkspace,
        tenantId?: string,
    ): Promise<IWorkspace> {
        if (this.state.formState.tenantId === "" && !tenantId) return;
        workspace.role = WorkspaceRole.Viewer;
        try {
            const roles = await FabricHelper.getRoleForWorkspace(
                workspace.id,
                tenantId || this.state.formState.tenantId,
            );
            if (!roles) return workspace;
            for (const role of roles) {
                if (
                    WorkspaceRoleRank[role.role] >= WorkspaceRoleRank[workspace.role] &&
                    this.state.userGroupIds.has(role.id)
                ) {
                    workspace.role = role.role;
                }
            }
        } catch (err) {
            console.error("Failed to get workspace role", err);
        }
        return workspace;
    }

    private async sortWorkspacesByPermission(
        workspaces: IWorkspace[],
        requiredRole: WorkspaceRole,
        tenantId?: string,
    ): Promise<IWorkspace[]> {
        // Ensure userGroupIds are loaded
        if (this.state.userGroupIds.size === 0) {
            const userId = this.state.formState.accountId.split(".")[0];
            const userGroups = await fetchUserGroups(userId);
            this.state.userGroupIds = new Set(userGroups.map((userGroup) => userGroup.id));
            this.state.userGroupIds.add(userId);
        }

        const workspacesWithValidOrUnknownCapacities: Record<string, IWorkspace> = {};

        for (const workspace of workspaces) {
            // Track all workspaces in the global map
            this.state.workspaces[workspace.id] = workspace;

            if (workspace.capacityId && !this.state.capacityIds.has(workspace.capacityId)) {
                workspace.hasCapacityPermissionsForProvisioning = false;
                this.state.workspacesWithoutPermissions[workspace.id] = workspace;
            } else {
                workspacesWithValidOrUnknownCapacities[workspace.id] = workspace;
            }
        }

        // Fetch all roles in parallel if it won't hit rate limits
        if (
            Object.keys(workspacesWithValidOrUnknownCapacities).length <
            this.defaultWorkspacePermissionsCap
        ) {
            const workspacesWithRoles = await Promise.all(
                Object.values(workspacesWithValidOrUnknownCapacities).map(async (workspace) => {
                    return await this.getRoleForWorkspace(workspace, tenantId);
                }),
            );

            for (const workspace of workspacesWithRoles) {
                if (hasWorkspacePermission(workspace.role, requiredRole)) {
                    this.state.workspacesWithPermissions[workspace.id] = workspace;
                } else {
                    this.state.workspacesWithoutPermissions[workspace.id] = workspace;
                }
                // Also keep workspace in the global map
                this.state.workspaces[workspace.id] = workspace;
            }
        } else {
            this.state.workspacesWithPermissions = workspacesWithValidOrUnknownCapacities;
        }

        // Merge both
        return [
            ...Object.values(this.state.workspacesWithPermissions),
            ...Object.values(this.state.workspacesWithoutPermissions),
        ];
    }
}
