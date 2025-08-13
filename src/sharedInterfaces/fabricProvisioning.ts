/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";
import { FormContextProps, FormEvent, FormItemSpec, FormState } from "./form";
import { IDialogProps } from "./connectionDialog";

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
    databaseName: string;
    workspace: string;
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
     * Handles form-related actions and state updates.
     * @param event The form event containing the action and data.
     */
    formAction(event: FormEvent<FabricProvisioningFormState>): void;
}

export interface FabricProvisioningReducers {
    /**
     * Handles form-related actions and state updates.
     */
    formAction: {
        event: FormEvent<FabricProvisioningFormState>;
    };
}
