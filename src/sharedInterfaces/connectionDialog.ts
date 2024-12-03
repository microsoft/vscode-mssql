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
    public azureSubscriptions: AzureSubscriptionInfo[];
    public azureServers: AzureSqlServerInfo[];
    public savedConnections: IConnectionDialogProfile[];
    public recentConnections: IConnectionDialogProfile[];
    public connectionStatus: ApiStatus;
    public formError: string;
    public loadingAzureSubscriptionsStatus: ApiStatus;
    public loadingAzureServersStatus: ApiStatus;
    public dialog: IDialogProps | undefined;

    constructor({
        connectionProfile,
        selectedInputMode,
        connectionComponents,
        azureSubscriptions,
        azureServers,
        savedConnections,
        recentConnections,
        connectionStatus,
        formError,
        loadingAzureSubscriptionsStatus,
        loadingAzureServersStatus,
        dialog,
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
        azureServers: AzureSqlServerInfo[];
        azureSubscriptions: AzureSubscriptionInfo[];
        savedConnections: IConnectionDialogProfile[];
        recentConnections: IConnectionDialogProfile[];
        connectionStatus: ApiStatus;
        formError: string;
        loadingAzureSubscriptionsStatus: ApiStatus;
        loadingAzureServersStatus: ApiStatus;
        dialog: IDialogProps | undefined;
    }) {
        this.formState = connectionProfile;
        this.selectedInputMode = selectedInputMode;
        this.connectionComponents = connectionComponents;
        this.azureSubscriptions = azureSubscriptions;
        this.azureServers = azureServers;
        this.savedConnections = savedConnections;
        this.recentConnections = recentConnections;
        this.connectionStatus = connectionStatus;
        this.formError = formError;
        this.loadingAzureSubscriptionsStatus = loadingAzureSubscriptionsStatus;
        this.loadingAzureServersStatus = loadingAzureServersStatus;
        this.dialog = dialog;
    }
}

export interface IDialogProps {
    type: "trustServerCert" | "addFirewallRule";
}

export interface TrustServerCertDialogProps extends IDialogProps {
    type: "trustServerCert";
    message: string;
}

export interface AddFirewallRuleDialogProps extends IDialogProps {
    type: "addFirewallRule";
    message: string;
    clientIp: string;
    tenants: { name: string; id: string }[];
}

export interface AzureSubscriptionInfo {
    name: string;
    id: string;
    loaded: boolean;
}

export interface AzureSqlServerInfo {
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
    loadAzureServers: (subscriptionId: string) => void;
    closeDialog: () => void;
    addFirewallRule: (
        name: string,
        tenantId: string,
        ip: string | { startIp: string; endIp: string },
    ) => void;
    filterAzureSubscriptions: () => void;
    refreshConnectionsList: () => void;
    deleteSavedConnection(connection: IConnectionDialogProfile): void;
    removeRecentConnection(connection: IConnectionDialogProfile): void;
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
    loadAzureServers: {
        subscriptionId: string;
    };
    addFirewallRule: {
        name: string;
        tenantId: string;
        ip: string | { startIp: string; endIp: string };
    };
    closeDialog: {};
    filterAzureSubscriptions: {};
    refreshConnectionsList: {};
    deleteSavedConnection: {
        connection: IConnectionDialogProfile;
    };
    removeRecentConnection: {
        connection: IConnectionDialogProfile;
    };
}
