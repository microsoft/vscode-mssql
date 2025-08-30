/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";
import { FormContextProps, FormItemSpec, FormReducers, FormState } from "./form";
import { IDialogProps } from "./connectionDialog";
import { ISqlDbArtifact, IWorkspace } from "./fabric";

export class FabricProvisioningState
    implements
        FormState<
            FabricProvisioningFormState,
            FabricProvisioningState,
            FabricProvisioningFormItemSpec
        >
{
    loadState: ApiStatus = ApiStatus.Loading;
    errorMessage?: string;
    // @ts-ignore
    formState: FabricProvisioningFormState = undefined;
    formComponents: Partial<
        Record<keyof FabricProvisioningFormState, FabricProvisioningFormItemSpec>
    > = {};
    formErrors: string[] = [];
    dialog: IDialogProps | undefined;
    workspacesWithPermissions: Record<string, IWorkspace> = {};
    workspacesWithoutPermissions: Record<string, IWorkspace> = {};
    capacityIds: Set<string> = new Set<string>();
    userGroupIds: Set<string> = new Set<string>();
    deploymentStartTime: string = "";
    workspaces: IWorkspace[] = [];
    databaseNamesInWorkspace: string[] = [];
    database: ISqlDbArtifact | undefined = undefined;
    tenantName: string = "";
    workspaceName: string = "";
    /** Used to track the form validation state */
    formValidationLoadState: ApiStatus = ApiStatus.NotStarted;
    /** Used to track fabric database provision state */
    provisionLoadState: ApiStatus = ApiStatus.NotStarted;
    connectionLoadState: ApiStatus = ApiStatus.NotStarted;
    constructor(params?: Partial<FabricProvisioningState>) {
        for (const key in params) {
            if (key in this) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- safe due to key in this check being a Partial of the class
                (this as any)[key as keyof FabricProvisioningState] =
                    params[key as keyof FabricProvisioningState]!;
            }
        }
    }
}

export interface FabricProvisioningFormState {
    accountId: string;
    workspace: string;
    databaseName: string;
    databaseDescription?: string;
    tenantId: string;
    profileName: string;
    groupId: string;
}

export interface FabricProvisioningFormItemSpec
    extends FormItemSpec<
        FabricProvisioningFormState,
        FabricProvisioningState,
        FabricProvisioningFormItemSpec
    > {
    componentWidth: string;
    isAdvancedOption: boolean;
}

export interface FabricProvisioningContextProps
    extends FormContextProps<
        FabricProvisioningFormState,
        FabricProvisioningState,
        FabricProvisioningFormItemSpec
    > {
    /**
     * Reload fabric environment
     * Used when account/ tenant is changed
     */
    reloadFabricEnvironment(newTenant: string): void;
    /**
     * Handle workspace form action
     */
    handleWorkspaceFormAction(workspaceId: string): void;
    /**
     * Handles the request for the database provisioning process
     */
    createDatabase(): void;
}

export interface FabricProvisioningReducers extends FormReducers<FabricProvisioningFormState> {
    /**
     * Reload fabric environment
     * Used when account/ tenant is changed
     */
    reloadFabricEnvironment: { newTenant: string };
    /**
     * Handle workspace form action
     */
    handleWorkspaceFormAction: { workspaceId: string };
    /**
     * Handles the request for the database provisioning process
     */
    createDatabase: {};
}
