/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import { getGroupIdFormItem } from "../connectionconfig/formComponentHelpers";
import { ConnectionDialog, Fabric, FabricProvisioning } from "../constants/locConstants";
import { FabricHelper } from "../fabric/fabricHelper";
import { Logger } from "../models/logger";
import {
    hasWorkspacePermission,
    IWorkspace,
    WorkspaceRole,
    WorkspaceRoleRank,
} from "../sharedInterfaces/fabric";
import * as fp from "../sharedInterfaces/fabricProvisioning";
import {
    FormItemActionButton,
    FormItemOptions,
    FormItemSpec,
    FormItemType,
} from "../sharedInterfaces/form";
import { ApiStatus } from "../sharedInterfaces/webview";
import { getErrorMessage } from "../utils/utils";
import { DeploymentWebviewController } from "./deploymentWebviewController";
import { fetchUserGroups } from "../azure/utils";
import { AuthenticationType, IConnectionDialogProfile } from "../sharedInterfaces/connectionDialog";
import { ConnectionCredentials } from "../models/connectionCredentials";
import { IConnectionProfile } from "../models/interfaces";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { AzureTenant } from "@microsoft/vscode-azext-azureauth";

export const WORKSPACE_ROLE_REQUEST_LIMIT = 20;

export async function initializeFabricProvisioningState(
    deploymentController: DeploymentWebviewController,
    groupOptions: FormItemOptions[],
    logger: Logger,
    selectedGroupId: string | undefined,
): Promise<fp.FabricProvisioningState> {
    const startTime = Date.now();
    const state = new fp.FabricProvisioningState();

    // Azure context
    const azureAccounts = await VsCodeAzureHelper.getAccounts();
    const azureAccountOptions = azureAccounts.map((account) => ({
        displayName: account.label,
        value: account.id,
    }));

    const defaultAccountId = azureAccountOptions.length > 0 ? azureAccountOptions[0].value : "";
    let defaultTenantId = "";
    let tenantOptions: FormItemOptions[] = [];
    if (defaultAccountId !== "") {
        const tenants = await VsCodeAzureHelper.getTenantsForAccount(defaultAccountId);

        tenantOptions = tenants.map((tenant) => ({
            displayName: tenant.displayName,
            value: tenant.tenantId,
        }));

        defaultTenantId = getDefaultTenantId(defaultAccountId, tenants);
    }

    state.formState = {
        accountId: defaultAccountId,
        groupId: selectedGroupId || groupOptions[0]?.value || "",
        tenantId: defaultTenantId,
        workspace: "",
        databaseName: "",
        databaseDescription: "",
    } as fp.FabricProvisioningFormState;

    // Form Context
    deploymentController.state.deploymentTypeState = state;
    const azureActionButtons = await getAzureActionButton(deploymentController, logger);
    state.formComponents = setFabricProvisioningFormComponents(
        azureAccountOptions,
        azureActionButtons,
        groupOptions,
        tenantOptions,
    );
    state.loadState = ApiStatus.Loaded;
    sendActionEvent(
        TelemetryViews.FabricProvisioning,
        TelemetryActions.StartFabricProvisioningDeployment,
        {},
        {
            localContainersInitTimeInMs: Date.now() - startTime,
        },
    );

    // Load workspaces
    void getWorkspaces(deploymentController);

    return state;
}

export function registerFabricProvisioningReducers(
    deploymentController: DeploymentWebviewController,
) {
    deploymentController.registerReducer("reloadFabricEnvironment", async (state, payload) => {
        state.deploymentTypeState = await reloadFabricComponents(
            deploymentController,
            payload.newTenant,
        );
        return state;
    });

    deploymentController.registerReducer("handleWorkspaceFormAction", async (state, payload) => {
        const fabricProvisioningState = await handleWorkspaceFormAction(
            state.deploymentTypeState as fp.FabricProvisioningState,
            payload.workspaceId,
        );
        state.deploymentTypeState = fabricProvisioningState;
        state.formState = fabricProvisioningState.formState;
        state.formErrors = fabricProvisioningState.formErrors;
        return state;
    });

    deploymentController.registerReducer("createDatabase", async (state, _payload) => {
        let fabricProvisioningState = state.deploymentTypeState as fp.FabricProvisioningState;

        // Workspaces haven't loaded yet
        if (fabricProvisioningState.workspaces.length === 0) return;

        // Update validation load state of form
        fabricProvisioningState.formValidationLoadState = ApiStatus.Loading;
        updateFabricProvisioningState(deploymentController, fabricProvisioningState);

        // Handle case where the workspace permissions are not loaded
        fabricProvisioningState = await handleWorkspaceFormAction(
            fabricProvisioningState,
            fabricProvisioningState.formState.workspace,
        );
        updateFabricProvisioningState(deploymentController, fabricProvisioningState);

        fabricProvisioningState.formErrors = await deploymentController.validateDeploymentForm();
        if (fabricProvisioningState.formErrors.length === 0) {
            void provisionDatabase(deploymentController);
            fabricProvisioningState.deploymentStartTime = new Date().toUTCString();

            // Set tenant and workspace names to display later
            fabricProvisioningState.tenantName =
                fabricProvisioningState.formComponents.tenantId.options.find(
                    (option) => option.value === fabricProvisioningState.formState.tenantId,
                )?.displayName;
            fabricProvisioningState.workspaceName =
                fabricProvisioningState.formComponents.workspace.options.find(
                    (option) => option.value === fabricProvisioningState.formState.workspace,
                )?.displayName;
            fabricProvisioningState.formValidationLoadState = ApiStatus.Loaded;
        } else {
            fabricProvisioningState.formValidationLoadState = ApiStatus.NotStarted;
        }
        state.deploymentTypeState = fabricProvisioningState;
        return state;
    });
}

export function setFabricProvisioningFormComponents(
    azureAccountOptions: FormItemOptions[],
    azureActionButtons: FormItemActionButton[],
    groupOptions: FormItemOptions[],
    tenantOptions: FormItemOptions[],
): Record<
    string,
    FormItemSpec<
        fp.FabricProvisioningFormState,
        fp.FabricProvisioningState,
        fp.FabricProvisioningFormItemSpec
    >
> {
    const createFormItem = (
        spec: Partial<fp.FabricProvisioningFormItemSpec>,
    ): fp.FabricProvisioningFormItemSpec =>
        ({
            required: false,
            isAdvancedOption: false,
            ...spec,
        }) as fp.FabricProvisioningFormItemSpec;

    return {
        accountId: createFormItem({
            propertyName: "accountId",
            label: Fabric.fabricAccount,
            required: true,
            type: FormItemType.Dropdown,
            options: azureAccountOptions,
            placeholder: ConnectionDialog.selectAnAccount,
            actionButtons: azureActionButtons,
            validate: (_state: fp.FabricProvisioningState, value: string) => ({
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
            validate(state: fp.FabricProvisioningState, value: string) {
                {
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
            validate(state: fp.FabricProvisioningState, value: string) {
                {
                    if (!value) {
                        return {
                            isValid: false,
                            validationMessage: FabricProvisioning.databaseNameIsRequired,
                        };
                    }
                    const isUniqueDatabaseName = !state.databaseNamesInWorkspace.includes(value);

                    return {
                        isValid: isUniqueDatabaseName,
                        validationMessage: isUniqueDatabaseName
                            ? ""
                            : FabricProvisioning.databaseNameError,
                    };
                }
            },
        }),
        tenantId: createFormItem({
            propertyName: "tenantId",
            label: ConnectionDialog.tenantId,
            required: true,
            type: FormItemType.Dropdown,
            options: tenantOptions,
            placeholder: ConnectionDialog.selectATenant,
            validate: (_state: fp.FabricProvisioningState, value: string) => ({
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
            getGroupIdFormItem(groupOptions) as fp.FabricProvisioningFormItemSpec,
        ),
    };
}

export async function getAzureActionButton(
    deploymentController: DeploymentWebviewController,
    logger: Logger,
): Promise<FormItemActionButton[]> {
    const accountFormComponentId = "accountId";
    const state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;

    const actionButtons: FormItemActionButton[] = [];
    actionButtons.push({
        label:
            state.formState.accountId === ""
                ? ConnectionDialog.signIn
                : ConnectionDialog.addAccount,
        id: "azureSignIn",
        callback: async () => {
            // Force sign in prompt
            await VsCodeAzureHelper.signIn(true);

            const accountsComponent = state.formComponents[accountFormComponentId];
            if (!accountsComponent) {
                logger.error("Account component not found");
                return;
            }

            const azureAccounts = await VsCodeAzureHelper.getAccounts();
            accountsComponent.options = azureAccounts.map((account) => ({
                displayName: account.label,
                value: account.id,
            }));

            logger.verbose(
                `Read ${accountsComponent.options.length} Azure accounts: ${accountsComponent.options.map((a) => a.value).join(", ")}`,
            );

            // There should always be at least one account, because the user just went through the sign in workflow
            if (azureAccounts.length !== 0) {
                state.formState.accountId = azureAccounts[0].id;
                logger.verbose(`Selecting '${azureAccounts[0].id}'`);
            }

            updateFabricProvisioningState(deploymentController, state);
            await loadComponentsAfterSignIn(deploymentController, logger);
        },
    });
    return actionButtons;
}

export async function loadComponentsAfterSignIn(
    deploymentController: DeploymentWebviewController,
    logger: Logger,
) {
    const state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;

    // Reload tenant options
    const tenantComponent = state.formComponents["tenantId"];
    const tenants = await VsCodeAzureHelper.getTenantsForAccount(state.formState.accountId);
    const tenantOptions = tenants.map((tenant) => ({
        displayName: tenant.displayName,
        value: tenant.tenantId,
    }));
    if (tenantComponent) {
        tenantComponent.options = tenantOptions;
        if (
            tenantOptions.length > 0 &&
            !tenantOptions.find((t) => t.value === state.formState.tenantId)
        ) {
            // if expected tenantId is not in the list of tenants, set it to the first tenant
            state.formState.tenantId = getDefaultTenantId(state.formState.accountId, tenants);
            const errors = await deploymentController.validateDeploymentForm("tenantId");
            if (errors.length) {
                state.formErrors.push("tenantId");
            }
        }
    }
    const accountComponent = state.formComponents["accountId"];
    accountComponent.actionButtons = await getAzureActionButton(deploymentController, logger);

    await reloadFabricComponents(deploymentController);
}

export async function reloadFabricComponents(
    deploymentController: DeploymentWebviewController,
    tenantId?: string,
): Promise<fp.FabricProvisioningState> {
    const state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;
    const accountId = state.formState.accountId;
    if (accountId && !tenantId) {
        const tenants = await VsCodeAzureHelper.getTenantsForAccount(accountId);
        const tenantOptions = tenants.map((tenant) => ({
            displayName: tenant.displayName,
            value: tenant.tenantId,
        }));
        state.formState.tenantId = getDefaultTenantId(accountId, tenants);
        state.formComponents.tenantId.options = tenantOptions;
    }
    state.capacityIds = [];
    state.userGroupIds = [];
    state.workspaces = [];
    state.databaseNamesInWorkspace = [];
    state.errorMessage = "";
    state.isWorkspacesErrored = false;
    updateFabricProvisioningState(deploymentController, state);
    void getWorkspaces(deploymentController, tenantId);
    return state;
}

export function getWorkspaceOptions(state: fp.FabricProvisioningState): FormItemOptions[] {
    const orderedWorkspaces = [
        ...Object.values(state.workspacesWithPermissions),
        ...Object.values(state.workspacesWithoutPermissions),
    ];
    return orderedWorkspaces.map((workspace) => {
        const hasPermission = workspace.id in state.workspacesWithPermissions;

        let description = "";
        if (workspace.hasCapacityPermissionsForProvisioning === false) {
            description = Fabric.insufficientCapacityPermissions;
        } else if (!hasPermission) {
            description = Fabric.insufficientWorkspacePermissions;
        }

        return {
            displayName: workspace.displayName,
            value: workspace.id,
            color: hasPermission ? "" : "colorNeutralForegroundDisabled",
            description: description,
            icon: hasPermission ? undefined : "Warning20Regular",
        };
    });
}

export async function getWorkspaces(
    deploymentController: DeploymentWebviewController,
    tenantId?: string,
): Promise<void> {
    let state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;
    if (state.formState.tenantId === "" && !tenantId) return;
    const startTime = Date.now();

    tenantId = tenantId || state.formState.tenantId;
    try {
        // Set user's capacities in state
        await getCapacities(deploymentController, tenantId);

        const workspaces = await FabricHelper.getFabricWorkspaces(tenantId);
        state.workspaces = await sortWorkspacesByPermission(
            deploymentController,
            workspaces,
            WorkspaceRole.Contributor,
        );

        // Handle workspace state updates
        const workspaceOptions = getWorkspaceOptions(state);
        state.formComponents.workspace.options = workspaceOptions;
        state.formState.workspace = workspaceOptions.length > 0 ? workspaceOptions[0].value : "";
        updateFabricProvisioningState(deploymentController, state);
        sendActionEvent(
            TelemetryViews.FabricProvisioning,
            TelemetryActions.GetWorkspaces,
            {},
            {
                numWorkspaces: state.workspaces.length,
                workspaceLoadTimeInMs: Date.now() - startTime,
            },
        );
    } catch (err) {
        console.log(err);
        state.isWorkspacesErrored = true;
        sendErrorEvent(
            TelemetryViews.FabricProvisioning,
            TelemetryActions.GetWorkspaces,
            err,
            false,
        );
        updateFabricProvisioningState(deploymentController, state);
    }
}

export async function getCapacities(
    deploymentController: DeploymentWebviewController,
    tenantId?: string,
): Promise<void> {
    const state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;
    if (state.formState.tenantId === "" && !tenantId) return;
    if (state.capacityIds.length !== 0) return;

    const startTime = Date.now();
    try {
        const capacities = await FabricHelper.getFabricCapacities(
            tenantId || state.formState.tenantId,
        );
        state.capacityIds = capacities.map((capacity) => capacity.id);
        updateFabricProvisioningState(deploymentController, state);
        sendActionEvent(
            TelemetryViews.FabricProvisioning,
            TelemetryActions.GetWorkspaces,
            {},
            {
                capacitiesLoadTimeInMs: Date.now() - startTime,
            },
        );
    } catch (err) {
        state.errorMessage = getErrorMessage(err);
        sendErrorEvent(
            TelemetryViews.FabricProvisioning,
            TelemetryActions.LoadCapacities,
            err,
            false,
        );
        throw err;
    }
}

export async function getRoleForWorkspace(
    state: fp.FabricProvisioningState,
    workspace: IWorkspace,
    tenantId?: string,
): Promise<IWorkspace> {
    if (state.formState.tenantId === "" && !tenantId) return;
    workspace.role = WorkspaceRole.Viewer;
    const startTime = Date.now();

    try {
        const roles = await FabricHelper.getRolesForWorkspace(
            workspace.id,
            tenantId || state.formState.tenantId,
        );
        if (!roles) return workspace;
        for (const role of roles) {
            if (
                WorkspaceRoleRank[role.role] >= WorkspaceRoleRank[workspace.role] &&
                state.userGroupIds.includes(role.id)
            ) {
                workspace.role = role.role;
            }
        }
        sendActionEvent(
            TelemetryViews.FabricProvisioning,
            TelemetryActions.GetWorkspaceRole,
            {},
            {
                workspaceRoleLoadTimeInMs: Date.now() - startTime,
            },
        );
    } catch (err) {
        state.errorMessage = getErrorMessage(err);
        sendErrorEvent(
            TelemetryViews.FabricProvisioning,
            TelemetryActions.GetWorkspaceRole,
            err,
            false,
        );
    }
    return workspace;
}

export async function sortWorkspacesByPermission(
    deploymentController: DeploymentWebviewController,
    workspaces: IWorkspace[],
    requiredRole: WorkspaceRole,
    tenantId?: string,
): Promise<IWorkspace[]> {
    const state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;

    // Ensure userGroupIds are loaded
    if (state.userGroupIds.length === 0) {
        const userId = state.formState.accountId.split(".")[0];
        const userGroups = await fetchUserGroups(userId);
        if (userGroups.length > 0) {
            state.userGroupIds = userGroups.map((userGroup) => userGroup.id);
        }
        state.userGroupIds.push(userId);
    }

    const workspacesWithValidOrUnknownCapacities: Record<string, IWorkspace> = {};

    for (const workspace of workspaces) {
        // Track all workspaces in the global map
        state.workspaces[workspace.id] = workspace;

        if (workspace.capacityId && !state.capacityIds.includes(workspace.capacityId)) {
            workspace.hasCapacityPermissionsForProvisioning = false;
            state.workspacesWithoutPermissions[workspace.id] = workspace;
        } else {
            workspacesWithValidOrUnknownCapacities[workspace.id] = workspace;
        }
    }

    const startTime = Date.now();
    // Fetch all roles in parallel if it won't hit rate limits
    if (Object.keys(workspacesWithValidOrUnknownCapacities).length < WORKSPACE_ROLE_REQUEST_LIMIT) {
        const workspacesWithRoles = await Promise.all(
            Object.values(workspacesWithValidOrUnknownCapacities).map(async (workspace) => {
                return await getRoleForWorkspace(state, workspace, tenantId);
            }),
        );

        for (const workspace of workspacesWithRoles) {
            if (hasWorkspacePermission(workspace.role, requiredRole)) {
                state.workspacesWithPermissions[workspace.id] = workspace;
            } else {
                state.workspacesWithoutPermissions[workspace.id] = workspace;
            }
            // Also keep workspace in the global map
            state.workspaces[workspace.id] = workspace;
        }
        sendActionEvent(
            TelemetryViews.FabricProvisioning,
            TelemetryActions.GetPermissionsForWorkspaces,
            {},
            {
                workspacePermissionsLoadTimeInMs: Date.now() - startTime,
            },
        );
    } else {
        state.workspacesWithPermissions = workspacesWithValidOrUnknownCapacities;
    }

    updateFabricProvisioningState(deploymentController, state);

    // Merge both
    return [
        ...Object.values(state.workspacesWithPermissions),
        ...Object.values(state.workspacesWithoutPermissions),
    ];
}

export async function handleWorkspaceFormAction(
    state: fp.FabricProvisioningState,
    workspaceId: string,
): Promise<fp.FabricProvisioningState> {
    const workspace = state.workspacesWithPermissions[workspaceId];

    // Check if the workspace has a role
    if (workspace && !workspace.role) {
        // By default, workspace is in the permissions list
        delete state.workspacesWithPermissions[workspace.id];

        // Get workspace roles
        const workspaceWithRole = await getRoleForWorkspace(
            state,
            workspace,
            state.formState.tenantId,
        );

        // Add workspace to respective role list
        if (hasWorkspacePermission(workspaceWithRole.role, WorkspaceRole.Contributor)) {
            state.workspacesWithPermissions[workspaceWithRole.id] = workspaceWithRole;
        } else {
            state.workspacesWithoutPermissions[workspaceWithRole.id] = workspaceWithRole;
        }

        state.formComponents.workspace.options = getWorkspaceOptions(state);
    }

    // Validate the workspace
    state.formState.workspace = workspace.id;
    const workspaceComponent = state.formComponents["workspace"];
    const workspaceValidation = workspaceComponent.validate(state, state.formState.workspace);
    workspaceComponent.validation = workspaceValidation;
    if (!workspaceValidation.isValid) {
        state.formErrors.push("workspace");
        state.databaseNamesInWorkspace = [];
    } else {
        const startTime = Date.now();

        // Get databases in Fabric
        const databasesInWorkspaces = await FabricHelper.getFabricDatabases(
            workspace,
            state.formState.tenantId,
        );

        state.databaseNamesInWorkspace = databasesInWorkspaces.map(
            (database) => database.displayName,
        );
        sendActionEvent(
            TelemetryViews.FabricProvisioning,
            TelemetryActions.GetFabricDatabases,
            {},
            {
                fabricDatabasesLoadTimeInMs: Date.now() - startTime,
            },
        );
    }
    // Validate databases
    const databaseNameComponent = state.formComponents["databaseName"];
    const databaseNameValidation = databaseNameComponent.validate(
        state,
        state.formState.databaseName,
    );
    databaseNameComponent.validation = databaseNameValidation;
    if (!databaseNameValidation.isValid) {
        state.formErrors.push("databaseName");
    }
    return state;
}

export async function provisionDatabase(
    deploymentController: DeploymentWebviewController,
    tenantId?: string,
): Promise<void> {
    const state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;
    if (state.formState.tenantId === "" && !tenantId) return;

    const startTime = Date.now();
    state.provisionLoadState = ApiStatus.Loading;
    updateFabricProvisioningState(deploymentController, state);

    try {
        state.database = await FabricHelper.createFabricSqlDatabase(
            state.formState.workspace,
            state.formState.databaseName,
            state.formState.databaseDescription,
            tenantId || state.formState.tenantId,
        );

        state.provisionLoadState = ApiStatus.Loaded;
        updateFabricProvisioningState(deploymentController, state);
        sendActionEvent(
            TelemetryViews.FabricProvisioning,
            TelemetryActions.ProvisionFabricDatabase,
            {},
            {
                provisionDatabaseLoadTimeInMs: Date.now() - startTime,
            },
        );
        void connectToDatabase(deploymentController);
    } catch (err) {
        state.errorMessage = getErrorMessage(err);
        state.provisionLoadState = ApiStatus.Error;
        updateFabricProvisioningState(deploymentController, state);
        sendErrorEvent(
            TelemetryViews.FabricProvisioning,
            TelemetryActions.ProvisionFabricDatabase,
            err,
            false,
        );
    }
}

export async function connectToDatabase(deploymentController: DeploymentWebviewController) {
    const state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;
    if (!state.database) return;
    const startTime = Date.now();
    state.connectionLoadState = ApiStatus.Loading;
    updateFabricProvisioningState(deploymentController, state);

    try {
        const databaseDetails = await FabricHelper.getFabricDatabase(
            state.formState.workspace,
            state.database.id,
            state.formState.tenantId,
        );
        const databaseConnectionString = databaseDetails.properties.connectionString;
        const databaseConnectionDetails =
            await deploymentController.mainController.connectionManager.parseConnectionString(
                databaseConnectionString,
            );

        // Build connection profile to database
        const databaseConnectionProfile: IConnectionDialogProfile =
            await ConnectionCredentials.createConnectionInfo(databaseConnectionDetails);
        databaseConnectionProfile.profileName =
            state.formState.profileName || state.database.displayName;
        databaseConnectionProfile.groupId = state.formState.groupId;
        databaseConnectionProfile.authenticationType = AuthenticationType.AzureMFA;
        databaseConnectionProfile.accountId = state.formState.accountId;

        // Connect to database
        const profile =
            await deploymentController.mainController.connectionManager.connectionUI.saveProfile(
                databaseConnectionProfile as IConnectionProfile,
            );
        await deploymentController.mainController.createObjectExplorerSession(profile);
        state.connectionLoadState = ApiStatus.Loaded;

        sendActionEvent(
            TelemetryViews.FabricProvisioning,
            TelemetryActions.ConnectToFabricDatabase,
            {},
            {
                connectToDatabaseLoadTimeInMs: Date.now() - startTime,
            },
        );
    } catch (err) {
        state.connectionLoadState = ApiStatus.Error;
        state.errorMessage = getErrorMessage(err);
        sendErrorEvent(
            TelemetryViews.FabricProvisioning,
            TelemetryActions.ConnectToFabricDatabase,
            err,
            false,
        );
    }
    updateFabricProvisioningState(deploymentController, state);
}

export function sendFabricProvisioningCloseEventTelemetry(state: fp.FabricProvisioningState): void {
    sendActionEvent(
        TelemetryViews.FabricProvisioning,
        TelemetryActions.FinishFabricProvisioningDeployment,
        {
            // Include telemetry data about the state when closed
            formValidationState: state.formValidationLoadState,
            errorMessage: state.errorMessage,
            provisionState: state.provisionLoadState,
            connectionState: state.connectionLoadState,
        },
    );
}

export function updateFabricProvisioningState(
    deploymentController: DeploymentWebviewController,
    newState: fp.FabricProvisioningState,
) {
    deploymentController.state.deploymentTypeState = newState;
    deploymentController.updateState(deploymentController.state);
}

export function getDefaultTenantId(accountId: string, tenants: AzureTenant[]): string {
    if (accountId === "" || tenants.length === 0) return "";

    // Response from VS Code account system shows all tenants as "Home", so we need to extract the home tenant ID manually
    const homeTenantId = VsCodeAzureHelper.getHomeTenantIdForAccount(accountId);

    // For personal Microsoft accounts, the extracted tenant ID may not be one that the user has access to.
    // Only use the extracted tenant ID if it's in the tenant list; otherwise, default to the first.
    return tenants.some((t) => t.tenantId === homeTenantId)
        ? homeTenantId
        : tenants.length > 0
          ? tenants[0].tenantId
          : "";
}
