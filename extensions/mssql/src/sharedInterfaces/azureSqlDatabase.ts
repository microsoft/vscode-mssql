/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";
import { FormContextProps, FormItemSpec, FormReducers, FormState } from "./form";
import { IDialogProps } from "./connectionDialog";

export class AzureSqlDatabaseState
    implements
        FormState<AzureSqlDatabaseFormState, AzureSqlDatabaseState, AzureSqlDatabaseFormItemSpec>
{
    loadState: ApiStatus = ApiStatus.Loading;
    errorMessage?: string;
    // @ts-ignore
    formState: AzureSqlDatabaseFormState = undefined;
    formComponents: Partial<Record<keyof AzureSqlDatabaseFormState, AzureSqlDatabaseFormItemSpec>> =
        {};
    formErrors: string[] = [];
    dialog: IDialogProps | undefined;
    formValidationLoadState: ApiStatus = ApiStatus.NotStarted;
    constructor(params?: Partial<AzureSqlDatabaseState>) {
        for (const key in params) {
            if (key in this) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- safe due to key in this check being a Partial of the class
                (this as any)[key as keyof AzureSqlDatabaseState] =
                    params[key as keyof AzureSqlDatabaseState]!;
            }
        }
    }
}

export interface AzureSqlDatabaseFormState {
    accountId: string;
    tenantId: string;
    databaseName: string;
    groupId: string;
}

export interface AzureSqlDatabaseFormItemSpec
    extends FormItemSpec<
        AzureSqlDatabaseFormState,
        AzureSqlDatabaseState,
        AzureSqlDatabaseFormItemSpec
    > {
    componentWidth: string;
}

export interface AzureSqlDatabaseContextProps extends FormContextProps<AzureSqlDatabaseFormState> {}

export interface AzureSqlDatabaseReducers extends FormReducers<AzureSqlDatabaseFormState> {}
