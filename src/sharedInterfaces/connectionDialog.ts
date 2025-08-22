/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeMssql from "vscode-mssql";
import { FormItemSpec, FormContextProps, FormState, FormReducers } from "./form";
import { FirewallRuleSpec } from "./firewallRule";
import { ApiStatus, Status } from "./webview";
import { AddFirewallRuleState } from "./addFirewallRule";
import { ConnectionGroupSpec, ConnectionGroupState } from "./connectionGroup";
import { RequestType } from "vscode-jsonrpc/browser";

export class ConnectionDialogWebviewState
    implements
        FormState<
            IConnectionDialogProfile,
            ConnectionDialogWebviewState,
            ConnectionDialogFormItemSpec
        >
{
    /** the underlying connection profile for the form target; same as `connectionProfile` */
    formState: IConnectionDialogProfile = {} as IConnectionDialogProfile;
    /** The underlying connection profile for the form target; a more intuitively-named alias for `formState` */
    get connectionProfile(): IConnectionDialogProfile {
        return this.formState;
    }
    set connectionProfile(value: IConnectionDialogProfile) {
        this.formState = value;
    }

    formComponents: Partial<Record<keyof IConnectionDialogProfile, ConnectionDialogFormItemSpec>> =
        {};

    public selectedInputMode: ConnectionInputMode = ConnectionInputMode.Parameters;
    public connectionComponents: ConnectionComponentsInfo = {
        mainOptions: [],
        groupedAdvancedOptions: [],
    };
    public azureAccounts: IAzureAccount[] = [];
    public loadingAzureAccountsStatus: ApiStatus = ApiStatus.NotStarted;
    public azureSubscriptions: AzureSubscriptionInfo[] = [];
    public loadingAzureSubscriptionsStatus: ApiStatus = ApiStatus.NotStarted;
    public azureServers: AzureSqlServerInfo[] = [];
    public loadingAzureServersStatus: ApiStatus = ApiStatus.NotStarted;
    public savedConnections: IConnectionDialogProfile[] = [];
    public recentConnections: IConnectionDialogProfile[] = [];
    public connectionStatus: ApiStatus = ApiStatus.NotStarted;
    public readyToConnect: boolean = false;
    public formError: string = "";
    public dialog: IDialogProps | undefined;

    public selectedAccountId: string | undefined;
    public azureTenants: IAzureTenant[] = [];
    public selectedTenantId: string | undefined;
    public fabricWorkspacesLoadStatus: Status = { status: ApiStatus.NotStarted };
    public fabricWorkspaces: FabricWorkspaceInfo[] = [];

    constructor(params?: Partial<ConnectionDialogWebviewState>) {
        for (const key in params) {
            if (key in this) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- safe due to key in this check being a Partial of the class
                (this as any)[key as keyof ConnectionDialogWebviewState] =
                    params[key as keyof ConnectionDialogWebviewState]!;
            }
        }
    }
}

export interface IAzureAccount {
    id: string;
    name: string;
}

export interface IAzureTenant {
    id: string;
    name: string;
}

export interface IDialogProps {
    type:
        | "trustServerCert"
        | "addFirewallRule"
        | "loadFromConnectionString"
        | "createConnectionGroup";
}

export interface TrustServerCertDialogProps extends IDialogProps {
    type: "trustServerCert";
    message: string;
}

export interface AddFirewallRuleDialogProps extends IDialogProps {
    type: "addFirewallRule";
    props: AddFirewallRuleState;
}

export interface ConnectionStringDialogProps extends IDialogProps {
    type: "loadFromConnectionString";
    connectionString: string;
    connectionStringError?: string;
}
export interface CreateConnectionGroupDialogProps extends IDialogProps {
    type: "createConnectionGroup";
    props: ConnectionGroupState;
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
    uri: string;
}

export interface FabricSqlDbInfo {
    id: string;
    server: string;
    displayName: string;
    database: string;
    type: string;
    workspaceName: string;
}

export interface FabricWorkspaceInfo {
    id: string;
    displayName: string;
    tenantId: string;
    databases: FabricSqlDbInfo[];
    loadStatus: Status;
}

export enum SqlArtifactTypes {
    SqlDatabase = "SQLDatabase",
    SqlAnalyticsEndpoint = "SQLEndpoint",
}

/**
 * IWorkspace Fabric workspace as seen in api responses
 */
export interface IWorkspace {
    id: string;
    capacityId?: string; // supplied when getting a single workspace, but only sometimes when getting all workspaces (perhaps newer workspaces?)
    type: string;
    displayName: string;
    description: string;
    databases: string[];
    sqlAnalyticsEndpoints: string[];
    workspace: {
        name: string;
        id: string;
    };
}

export interface IFabricError {
    errorCode: string;
    message: string;
}

export interface ConnectionComponentsInfo {
    mainOptions: (keyof IConnectionDialogProfile)[];
    groupedAdvancedOptions: ConnectionComponentGroup[];
}

export interface ConnectionComponentGroup {
    groupName: string;
    options: (keyof IConnectionDialogProfile)[];
}

export interface ConnectionDialogFormItemSpec
    extends FormItemSpec<
        IConnectionDialogProfile,
        ConnectionDialogWebviewState,
        ConnectionDialogFormItemSpec
    > {
    isAdvancedOption: boolean;
    optionCategory?: string;
    optionCategoryLabel?: string;
}

export enum ConnectionInputMode {
    Parameters = "parameters",
    AzureBrowse = "azureBrowse",
    FabricBrowse = "fabricBrowse",
}

// A Connection Profile contains all the properties of connection credentials, with additional
// optional name and details on whether password should be saved
export interface IConnectionDialogProfile extends vscodeMssql.IConnectionInfo {
    profileName?: string;
    groupId?: string;
    savePassword?: boolean;
    emptyPasswordInput?: boolean;
    azureAuthType?: vscodeMssql.AzureAuthType;
    id?: string;
}

export enum AuthenticationType {
    /**
     * Username and password
     */
    SqlLogin = "SqlLogin",
    /**
     * Windows Authentication
     */
    Integrated = "Integrated",
    /**
     * Microsoft Entra Id - Universal with MFA support
     */
    AzureMFA = "AzureMFA",
    /**
     * Microsoft Entra Id - Password
     */
    AzureMFAAndUser = "AzureMFAAndUser",
    /**
     * Datacenter Security Token Service Authentication
     */
    DSTSAuth = "dstsAuth",
    /**
     * No authentication required
     */
    None = "None",
}

export interface ConnectionDialogContextProps
    extends FormContextProps<
        IConnectionDialogProfile,
        ConnectionDialogWebviewState,
        ConnectionDialogFormItemSpec
    > {
    // Reducers
    loadConnection: (connection: IConnectionDialogProfile) => void;
    setConnectionInputType: (inputType: ConnectionInputMode) => void;
    connect: () => void;
    loadAzureServers: (subscriptionId: string) => void;
    closeDialog: () => void;
    closeMessage: () => void;
    addFirewallRule: (firewallRuleSpec: FirewallRuleSpec) => void;
    openCreateConnectionGroupDialog: () => void;
    createConnectionGroup: (connectionGroupSpec: ConnectionGroupSpec) => void;
    filterAzureSubscriptions: () => void;
    refreshConnectionsList: () => void;
    deleteSavedConnection(connection: IConnectionDialogProfile): void;
    removeRecentConnection(connection: IConnectionDialogProfile): void;
    loadFromConnectionString: (connectionString: string) => void;
    openConnectionStringDialog: () => void;
    signIntoAzureForFirewallRule: () => void;
    signIntoAzureForBrowse: (
        browseTarget: ConnectionInputMode.AzureBrowse | ConnectionInputMode.FabricBrowse,
    ) => void;
    selectAzureAccount: (accountId: string) => void;
    selectAzureTenant: (tenantId: string) => void;
    selectFabricWorkspace: (workspaceId: string) => void;

    // Request handlers
    getConnectionDisplayName: (connection: IConnectionDialogProfile) => Promise<string>;
}

export interface ConnectionDialogReducers extends FormReducers<IConnectionDialogProfile> {
    setConnectionInputType: {
        inputMode: ConnectionInputMode;
    };
    loadConnection: {
        connection: IConnectionDialogProfile;
    };
    connect: {};
    loadAzureServers: {
        subscriptionId: string;
    };
    addFirewallRule: {
        firewallRuleSpec: FirewallRuleSpec;
    };
    createConnectionGroup: {
        connectionGroupSpec: ConnectionGroupSpec;
    };
    openCreateConnectionGroupDialog: {};
    closeDialog: {};
    closeMessage: {};
    filterAzureSubscriptions: {};
    refreshConnectionsList: {};
    deleteSavedConnection: {
        connection: IConnectionDialogProfile;
    };
    removeRecentConnection: {
        connection: IConnectionDialogProfile;
    };
    loadFromConnectionString: { connectionString: string };
    openConnectionStringDialog: {};
    signIntoAzureForFirewallRule: {};
    signIntoAzureForBrowse: {
        browseTarget: ConnectionInputMode.AzureBrowse | ConnectionInputMode.FabricBrowse;
    };
    selectAzureAccount: { accountId: string };
    selectAzureTenant: { tenantId: string };
    selectFabricWorkspace: { workspaceId: string };
}

export namespace GetConnectionDisplayNameRequest {
    export const type = new RequestType<IConnectionDialogProfile, string, void>(
        "getConnectionDisplayName",
    );
}
