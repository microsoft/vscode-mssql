/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeMssql from "vscode-mssql";
import {
    FormItemSpec,
    FormContextProps,
    FormEvent,
    FormState,
} from "../reactviews/common/forms/form";
import { ApiStatus } from "./webview";

export class ConnectionDialogWebviewState
    implements FormState<IConnectionDialogProfile>
{
    /** the underlying connection profile for the form target; same as `connectionProfile` */
    formState: IConnectionDialogProfile;
    /** The underlying connection profile for the form target; a more intuitively-named alias for `formState` */
    get connectionProfile(): IConnectionDialogProfile {
        return this.formState;
    }
    set connectionProfile(value: IConnectionDialogProfile) {
        this.formState = value;
    }
    public selectedInputMode: ConnectionInputMode;
    public connectionComponents: {
        components: Record<
            keyof IConnectionDialogProfile,
            ConnectionDialogFormItemSpec
        >;
        mainOptions: (keyof IConnectionDialogProfile)[];
        topAdvancedOptions: (keyof IConnectionDialogProfile)[];
        groupedAdvancedOptions: Record<
            string,
            (keyof IConnectionDialogProfile)[]
        >;
    };
    public azureDatabases: AzureSqlDatabaseInfo[];
    public recentConnections: IConnectionDialogProfile[];
    public connectionStatus: ApiStatus;
    public formError: string;

    constructor({
        connectionProfile,
        selectedInputMode,
        connectionComponents,
        azureDatabases,
        recentConnections,
        connectionStatus,
        formError,
    }: {
        connectionProfile: IConnectionDialogProfile;
        selectedInputMode: ConnectionInputMode;
        connectionComponents: {
            components: Record<
                keyof IConnectionDialogProfile,
                ConnectionDialogFormItemSpec
            >;
            mainOptions: (keyof IConnectionDialogProfile)[];
            topAdvancedOptions: (keyof IConnectionDialogProfile)[];
            groupedAdvancedOptions: Record<
                string,
                (keyof IConnectionDialogProfile)[]
            >;
        };
        azureDatabases: AzureSqlDatabaseInfo[];
        recentConnections: IConnectionDialogProfile[];
        connectionStatus: ApiStatus;
        formError: string;
    }) {
        this.formState = connectionProfile;
        this.selectedInputMode = selectedInputMode;
        this.connectionComponents = connectionComponents;
        this.azureDatabases = azureDatabases;
        this.recentConnections = recentConnections;
        this.connectionStatus = connectionStatus;
        this.formError = formError;
    }
}

export interface AzureSqlDatabaseInfo {
    server: string;
    databases: string[];
    location: string;
    resourceGroup: string;
    subscription: string;
}

export interface ConnectionDialogFormItemSpec
    extends FormItemSpec<IConnectionDialogProfile> {
    isAdvancedOption: boolean;
    optionCategory?: string;
}

export enum ConnectionInputMode {
    Parameters = "parameters",
    ConnectionString = "connectionString",
    AzureBrowse = "azureBrowse",
}

// A Connection Profile contains all the properties of connection credentials, with additional
// optional name and details on whether password should be saved
export interface IConnectionDialogProfile extends vscodeMssql.IConnectionInfo {
    profileName?: string;
    savePassword?: boolean;
    emptyPasswordInput?: boolean;
    azureAuthType?: vscodeMssql.AzureAuthType;
    /** display name for the MRU pane; should be set to the profileName if available, otherwise generated from connection details */
    displayName?: string;
}

export interface ConnectionDialogContextProps
    extends FormContextProps<
        ConnectionDialogWebviewState,
        IConnectionDialogProfile
    > {
    loadConnection: (connection: IConnectionDialogProfile) => void;
    setConnectionInputType: (inputType: ConnectionInputMode) => void;
    connect: () => void;
}

export enum AuthenticationType {
    SqlLogin = "SqlLogin",
    Integrated = "Integrated",
    AzureMFA = "AzureMFA",
}

export interface ConnectionDialogReducers {
    setConnectionInputType: {
        inputMode: ConnectionInputMode;
    };
    formAction: {
        event: FormEvent<IConnectionDialogProfile>;
    };
    loadConnection: {
        connection: IConnectionDialogProfile;
    };
    connect: {};
}
