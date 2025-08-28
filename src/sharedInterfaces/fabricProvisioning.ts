/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";
import { FormContextProps, FormItemSpec, FormReducers, FormState } from "./form";
import { IDialogProps } from "./connectionDialog";
import { ICapacity, ISqlDbArtifact, IWorkspace } from "./fabric";
import { ConnectionGroupSpec } from "./connectionGroup";

export class FabricProvisioningWebviewState
    implements
        FormState<
            FabricProvisioningFormState,
            FabricProvisioningWebviewState,
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
    public workspaces: IWorkspace[] = [];
    public capacities: ICapacity[] = [];
    public userGroupIds: Set<string> = new Set<string>();
    public database: ISqlDbArtifact | undefined = undefined;
    /** Used to track the form validation state */
    formValidationLoadState: ApiStatus = ApiStatus.NotStarted;
    /** Used to track fabric database provision state */
    provisionLoadState: ApiStatus = ApiStatus.NotStarted;
    constructor(params?: Partial<FabricProvisioningWebviewState>) {
        for (const key in params) {
            if (key in this) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- safe due to key in this check being a Partial of the class
                (this as any)[key as keyof FabricProvisioningWebviewState] =
                    params[key as keyof FabricProvisioningWebviewState]!;
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
        FabricProvisioningWebviewState,
        FabricProvisioningFormItemSpec
    > {
    componentWidth: string;
    isAdvancedOption: boolean;
}

export interface FabricProvisioningContextProps
    extends FormContextProps<
        FabricProvisioningFormState,
        FabricProvisioningWebviewState,
        FabricProvisioningFormItemSpec
    > {
    /**
     * Reload fabric environment
     * Used when account/ tenant is changed
     */
    reloadFabricEnvironment(newTenant: string): void;
    /**
     * Handles the request for the database provisioning process
     */
    createDatabase(): void;
    /**
     * Creates a connection group based on the provided spec.
     */
    createConnectionGroup(connectionGroupSpec: ConnectionGroupSpec): void;

    /**
     * Sets the visibility of the connection group dialog based on the provided state.
     * @param shouldOpen - A boolean indicating whether the dialog should be open or closed.
     */
    setConnectionGroupDialogState(shouldOpen: boolean): void;
}

export interface FabricProvisioningReducers extends FormReducers<FabricProvisioningFormState> {
    /**
     * Reload fabric environment
     * Used when account/ tenant is changed
     */
    reloadFabricEnvironment: { newTenant: string };
    /**
     * Handles the request for the database provisioning process
     */
    createDatabase: {};
    /**
     * Handles the action of creating a connection group.
     */
    createConnectionGroup: {
        connectionGroupSpec: ConnectionGroupSpec;
    };

    /**
     * Handles the action of opening/closing the connection group dialog.
     */
    setConnectionGroupDialogState: { shouldOpen: boolean };
}
