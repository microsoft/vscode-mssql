/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { tokens } from "@fluentui/react-components";
import { AzureController } from "../azure/azureController";
import { getAccounts, getTenants } from "../connectionconfig/azureHelpers";
import { getGroupIdFormItem } from "../connectionconfig/formComponentHelpers";
import {
    ConnectionDialog,
    Fabric,
    FabricProvisioning,
    refreshTokenLabel,
} from "../constants/locConstants";
import VscodeWrapper from "../controllers/vscodeWrapper";
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

export const workspaceRoleRequestLimit = 20;

export async function initializeFabricProvisioningState(
    deploymentController: DeploymentWebviewController,
    groupOptions: FormItemOptions[],
    logger: Logger,
): Promise<fp.FabricProvisioningState> {
    const state = new fp.FabricProvisioningState();
    const azureAccountOptions = await getAccounts(
        deploymentController.mainController.azureAccountService,
        logger,
    );
    const defaultAccountId = azureAccountOptions.length > 0 ? azureAccountOptions[0].value : "";
    const tenantOptions = await getTenants(
        deploymentController.mainController.azureAccountService,
        defaultAccountId,
        logger,
    );
    state.formState = {
        accountId: defaultAccountId,
        groupId: groupOptions[0].value,
        tenantId: tenantOptions.length > 0 ? tenantOptions[0].value : "",
        workspace: "",
        databaseName: "",
        databaseDescription: "",
    } as fp.FabricProvisioningFormState;

    // set context
    deploymentController.state.deploymentTypeState = state;
    const azureActionButtons = await getAzureActionButtons(deploymentController, logger);
    state.formComponents = setFabricProvisioningFormComponents(
        azureAccountOptions,
        azureActionButtons,
        groupOptions,
        tenantOptions,
    );
    state.loadState = ApiStatus.Loaded;
    getWorkspaces(deploymentController);
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
        fabricProvisioningState.formValidationLoadState = ApiStatus.Loading;

        updatefabricProvisioningState(deploymentController, fabricProvisioningState);
        fabricProvisioningState = await handleWorkspaceFormAction(
            fabricProvisioningState,
            fabricProvisioningState.formState.workspace,
        );
        updatefabricProvisioningState(deploymentController, fabricProvisioningState);
        fabricProvisioningState.formErrors = await deploymentController.validateDeploymentForm();
        if (fabricProvisioningState.formErrors.length === 0) {
            provisionDatabase(deploymentController);
            fabricProvisioningState.deploymentStartTime = new Date().toUTCString();
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

export async function getAzureActionButtons(
    deploymentController: DeploymentWebviewController,
    logger: Logger,
): Promise<FormItemActionButton[]> {
    const accountFormComponentId = "accountId";
    const azureAccountService = deploymentController.mainController.azureAccountService;
    const state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;

    const actionButtons: FormItemActionButton[] = [];
    actionButtons.push({
        label:
            state.formState.accountId === ""
                ? ConnectionDialog.signIn
                : ConnectionDialog.addAccount,
        id: "azureSignIn",
        callback: async () => {
            const account = await azureAccountService.addAccount();
            logger.verbose(
                `Added Azure account '${account.displayInfo?.displayName}', ${account.key.id}`,
            );

            const accountsComponent = state.formComponents[accountFormComponentId];
            if (!accountsComponent) {
                logger.error("Account component not found");
                return;
            }

            accountsComponent.options = await getAccounts(azureAccountService, logger);

            logger.verbose(
                `Read ${accountsComponent.options.length} Azure accounts: ${accountsComponent.options.map((a) => a.value).join(", ")}`,
            );

            state.formState.accountId = account.key.id;
            logger.verbose(`Selecting '${account.key.id}'`);

            updatefabricProvisioningState(deploymentController, state);
            await loadComponentsAfterSignIn(deploymentController, logger);
        },
    });

    if (state.formState.accountId) {
        const account = (await azureAccountService.getAccounts()).find(
            (account) => account.displayInfo.userId === state.formState.accountId,
        );

        if (account) {
            let isTokenExpired = false;
            try {
                const session = await azureAccountService.getAccountSecurityToken(
                    account,
                    undefined,
                );
                isTokenExpired = !AzureController.isTokenValid(session.token, session.expiresOn);
            } catch (err) {
                logger.verbose(
                    `Error getting token or checking validity; prompting for refresh. Error: ${getErrorMessage(err)}`,
                );

                new VscodeWrapper().showErrorMessage(
                    "Error validating Entra authentication token; you may need to refresh your token.",
                );

                isTokenExpired = true;
            }

            if (isTokenExpired) {
                actionButtons.push({
                    label: refreshTokenLabel,
                    id: "refreshToken",
                    callback: async () => {
                        const account = (await azureAccountService.getAccounts()).find(
                            (account) => account.displayInfo.userId === state.formState.accountId,
                        );
                        if (account) {
                            try {
                                const session = await azureAccountService.getAccountSecurityToken(
                                    account,
                                    undefined,
                                );
                                logger.log("Token refreshed", session.expiresOn);
                            } catch (err) {
                                logger.error(`Error refreshing token: ${getErrorMessage(err)}`);
                            }
                        }
                    },
                });
            }
        }
    }
    return actionButtons;
}

export async function loadComponentsAfterSignIn(
    deploymentController: DeploymentWebviewController,
    logger: Logger,
) {
    const state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;
    const accountComponent = state.formComponents["accountId"];

    // Reload tenant options
    const tenantComponent = state.formComponents["tenantId"];
    const tenants = await getTenants(
        deploymentController.mainController.azureAccountService,
        state.formState.accountId,
        logger,
    );
    if (tenantComponent) {
        tenantComponent.options = tenants;
        if (tenants.length > 0 && !tenants.find((t) => t.value === state.formState.tenantId)) {
            // if expected tenantId is not in the list of tenants, set it to the first tenant
            state.formState.tenantId = tenants[0].value;
            const errors = await deploymentController.validateDeploymentForm("tenantId");
            if (errors.length) {
                state.formErrors.push("tenantId");
            }
        }
    }
    accountComponent.actionButtons = await getAzureActionButtons(deploymentController, logger);

    await reloadFabricComponents(deploymentController);
}

export async function reloadFabricComponents(
    deploymentController: DeploymentWebviewController,
    tenantId?: string,
): Promise<fp.FabricProvisioningState> {
    const state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;
    state.capacityIds = new Set<string>();
    state.userGroupIds = new Set<string>();
    state.workspaces = [];
    state.databaseNamesInWorkspace = [];
    updatefabricProvisioningState(deploymentController, state);
    getWorkspaces(deploymentController, tenantId);
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
            style: hasPermission ? {} : { color: tokens.colorNeutralForegroundDisabled },
            description: description,
            icon: hasPermission ? undefined : "Warning20Regular",
        };
    });
}

export function getWorkspaces(
    deploymentController: DeploymentWebviewController,
    tenantId?: string,
): void {
    let state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;
    if (state.formState.tenantId === "" && !tenantId) return;

    tenantId = tenantId || state.formState.tenantId;

    getCapacities(deploymentController, tenantId)
        .then(() => {
            return FabricHelper.getFabricWorkspaces(tenantId);
        })
        .then((workspaces) => {
            return sortWorkspacesByPermission(
                deploymentController,
                workspaces,
                WorkspaceRole.Contributor,
            );
        })
        .then((filteredWorkspaces) => {
            state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;
            state.workspaces = filteredWorkspaces;
            const workspaceOptions = getWorkspaceOptions(state);
            state.formComponents.workspace.options = workspaceOptions;
            state.formState.workspace =
                workspaceOptions.length > 0 ? workspaceOptions[0].value : "";
            updatefabricProvisioningState(deploymentController, state);
        })
        .catch((err) => {
            console.error("Failed to load workspaces", err);
        });
}

export async function getCapacities(
    deploymentController: DeploymentWebviewController,
    tenantId?: string,
): Promise<void> {
    const state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;
    if (state.formState.tenantId === "" && !tenantId) return;
    if (state.capacityIds.size !== 0) return;
    try {
        const capacities = await FabricHelper.getFabricCapacities(
            tenantId || state.formState.tenantId,
        );
        state.capacityIds = new Set(capacities.map((capacities) => capacities.id));
        updatefabricProvisioningState(deploymentController, state);
    } catch (err) {
        console.error("Failed to load capacities", err);
    }
}

export async function getRoleForWorkspace(
    state: fp.FabricProvisioningState,
    workspace: IWorkspace,
    tenantId?: string,
): Promise<IWorkspace> {
    if (state.formState.tenantId === "" && !tenantId) return;
    workspace.role = WorkspaceRole.Viewer;
    try {
        const roles = await FabricHelper.getRoleForWorkspace(
            workspace.id,
            tenantId || state.formState.tenantId,
        );
        if (!roles) return workspace;
        for (const role of roles) {
            if (
                WorkspaceRoleRank[role.role] >= WorkspaceRoleRank[workspace.role] &&
                state.userGroupIds.has(role.id)
            ) {
                workspace.role = role.role;
            }
        }
    } catch (err) {
        console.error("Failed to get workspace role", err);
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
    if (state.userGroupIds.size === 0) {
        const userId = state.formState.accountId.split(".")[0];
        const userGroups = await fetchUserGroups(userId);
        state.userGroupIds = new Set(userGroups.map((userGroup) => userGroup.id));
        state.userGroupIds.add(userId);
    }

    const workspacesWithValidOrUnknownCapacities: Record<string, IWorkspace> = {};

    for (const workspace of workspaces) {
        // Track all workspaces in the global map
        state.workspaces[workspace.id] = workspace;

        if (workspace.capacityId && !state.capacityIds.has(workspace.capacityId)) {
            workspace.hasCapacityPermissionsForProvisioning = false;
            state.workspacesWithoutPermissions[workspace.id] = workspace;
        } else {
            workspacesWithValidOrUnknownCapacities[workspace.id] = workspace;
        }
    }

    // Fetch all roles in parallel if it won't hit rate limits
    if (Object.keys(workspacesWithValidOrUnknownCapacities).length < workspaceRoleRequestLimit) {
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
    } else {
        state.workspacesWithPermissions = workspacesWithValidOrUnknownCapacities;
    }

    updatefabricProvisioningState(deploymentController, state);

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
    if (workspace && !workspace.role) {
        delete state.workspacesWithPermissions[workspace.id];
        const workspaceWithRole = await getRoleForWorkspace(
            state,
            workspace,
            state.formState.tenantId,
        );
        if (hasWorkspacePermission(workspaceWithRole.role, WorkspaceRole.Contributor)) {
            state.workspacesWithPermissions[workspaceWithRole.id] = workspaceWithRole;
        } else {
            state.workspacesWithoutPermissions[workspaceWithRole.id] = workspaceWithRole;
        }
        state.workspacesWithPermissions = state.workspacesWithPermissions;
        state.workspacesWithoutPermissions = state.workspacesWithoutPermissions;
        state.formComponents.workspace.options = getWorkspaceOptions(state);
    }
    state.formState.workspace = workspace.id;
    const workspaceComponent = state.formComponents["workspace"];
    const workspaceValidation = workspaceComponent.validate(state, state.formState.workspace);
    workspaceComponent.validation = workspaceValidation;
    if (!workspaceValidation.isValid) {
        state.formErrors.push("workspace");
        state.databaseNamesInWorkspace = [];
    } else {
        const databasesInWorkspaces = await FabricHelper.getFabricDatabases(
            workspace,
            state.formState.tenantId,
        );
        state.databaseNamesInWorkspace = databasesInWorkspaces.map(
            (database) => database.displayName,
        );
    }
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

export function provisionDatabase(
    deploymentController: DeploymentWebviewController,
    tenantId?: string,
): void {
    const state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;
    if (state.formState.tenantId === "" && !tenantId) return;
    state.provisionLoadState = ApiStatus.Loading;
    updatefabricProvisioningState(deploymentController, state);
    FabricHelper.createFabricSqlDatabase(
        state.formState.workspace,
        state.formState.databaseName,
        state.formState.databaseDescription,
        tenantId || state.formState.tenantId,
    )
        .then((database) => {
            state.database = database;
            state.provisionLoadState = ApiStatus.Loaded;
            updatefabricProvisioningState(deploymentController, state);
            void connectToDatabase(deploymentController);
        })
        .catch((err) => {
            console.error("Failed to create database", err);
            state.errorMessage = getErrorMessage(err);
            state.provisionLoadState = ApiStatus.Error;
            updatefabricProvisioningState(deploymentController, state);
        });
}

export async function connectToDatabase(deploymentController: DeploymentWebviewController) {
    const state = deploymentController.state.deploymentTypeState as fp.FabricProvisioningState;
    if (!state.database) return;
    state.connectionLoadState = ApiStatus.Loading;
    updatefabricProvisioningState(deploymentController, state);
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
        const databaseConnectionProfile: IConnectionDialogProfile =
            await ConnectionCredentials.createConnectionInfo(databaseConnectionDetails);
        databaseConnectionProfile.profileName =
            state.formState.profileName || state.database.displayName;
        databaseConnectionProfile.groupId = state.formState.groupId;
        databaseConnectionProfile.authenticationType = AuthenticationType.AzureMFA;
        databaseConnectionProfile.accountId = state.formState.accountId;
        const profile =
            await deploymentController.mainController.connectionManager.connectionUI.saveProfile(
                databaseConnectionProfile as IConnectionProfile,
            );

        await deploymentController.mainController.createObjectExplorerSession(profile);
        state.connectionLoadState = ApiStatus.Loaded;
    } catch (err) {
        state.connectionLoadState = ApiStatus.Error;
        state.errorMessage = getErrorMessage(err);
    }
    updatefabricProvisioningState(deploymentController, state);
}

export function updatefabricProvisioningState(
    deploymentController: DeploymentWebviewController,
    newState: fp.FabricProvisioningState,
) {
    deploymentController.state.deploymentTypeState = newState;
    deploymentController.updateState(deploymentController.state);
}
