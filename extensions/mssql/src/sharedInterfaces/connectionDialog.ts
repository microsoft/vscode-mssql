/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeMssql from "vscode-mssql";
import { FormItemSpec, FormContextProps, FormState, FormReducers, FormItemOptions } from "./form";
import { FirewallRuleSpec } from "./firewallRule";
import { ApiStatus, Status } from "./webview";
import { AddFirewallRuleState } from "./addFirewallRule";
import { ConnectionGroupSpec, ConnectionGroupState } from "./connectionGroup";
import { NotificationType, RequestType } from "vscode-jsonrpc/browser";
import { SqlDbInfo, SqlCollectionInfo } from "./fabric";
import { ChangePasswordResult, ChangePasswordWebviewState } from "./changePassword";
import { DialogMessageSpec } from "./dialogMessage";

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
    public loadingAzureTenantsStatus: ApiStatus = ApiStatus.NotStarted;
    public azureSubscriptions: AzureSubscriptionInfo[] = [];
    public loadingAzureSubscriptionsStatus: ApiStatus = ApiStatus.NotStarted;
    public azureServers: AzureSqlServerInfo[] = [];
    public loadingAzureServersStatus: ApiStatus = ApiStatus.NotStarted;
    public unauthenticatedAzureTenants: IUnauthenticatedAzureTenant[] = [];
    public azureTenantStatus: IAzureTenantStatus[] = [];
    public azureTenantSignInCounts: IAzureTenantSignInStatus | undefined;
    public savedConnections: IConnectionDialogProfile[] = [];
    public recentConnections: IConnectionDialogProfile[] = [];
    public isEditingConnection: boolean = false;
    public editingConnectionDisplayName: string | undefined;
    public connectionStatus: ApiStatus = ApiStatus.NotStarted;
    public connectionAction: ConnectionSubmitAction = ConnectionSubmitAction.Connect;
    public testConnectionSucceeded: boolean = false;
    public readyToConnect: boolean = false;
    public formMessage: DialogMessageSpec | undefined;
    public dialog: IDialogProps | undefined;

    public selectedAccountId: string | undefined;
    public azureTenants: IAzureTenant[] = [];
    public selectedTenantId: string | undefined;
    public sqlCollectionsLoadStatus: Status = { status: ApiStatus.NotStarted };
    public sqlCollections: SqlCollectionInfo[] = [];
    public favoritedAzureSubscriptionIds: string[] = [];
    public favoritedFabricWorkspaceIds: string[] = [];

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

export interface IUnauthenticatedAzureTenant {
    tenantId: string;
    tenantName?: string;
    accountId: string;
    accountName: string;
}

export interface IAzureTenantSignInStatus {
    totalTenants: number;
    signedInTenants: number;
}

export interface IAzureTenantStatus {
    accountId: string;
    accountName: string;
    signedInTenants: string[];
}

export interface IDialogProps {
    type:
        | "trustServerCert"
        | "addFirewallRule"
        | "loadFromConnectionString"
        | "createConnectionGroup"
        | "changePassword"
        | "fileBrowser";
}

export interface TrustServerCertDialogProps extends IDialogProps {
    type: "trustServerCert";
    message: string;
}

export interface AddFirewallRuleDialogProps extends IDialogProps {
    type: "addFirewallRule";
    props: AddFirewallRuleState;
}

export interface ChangePasswordDialogProps extends IDialogProps {
    type: "changePassword";
    props: ChangePasswordWebviewState;
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

/** @see SqlCollectionInfo */
export type AzureSubscriptionInfo = SqlCollectionInfo;

/** @see SqlDbInfo */
export type AzureSqlServerInfo = SqlDbInfo;

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
    optionCategory?: string;
    optionCategoryLabel?: string;
}

export enum ConnectionInputMode {
    Parameters = "parameters",
    AzureBrowse = "azureBrowse",
    FabricBrowse = "fabricBrowse",
}

export enum ConnectionSubmitAction {
    Connect = "connect",
    TestConnection = "testConnection",
    SaveWithoutConnecting = "saveWithoutConnecting",
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
     * Microsoft Entra Id - Default
     */
    ActiveDirectoryDefault = "ActiveDirectoryDefault",
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

export interface ConnectionDialogContextProps extends FormContextProps<IConnectionDialogProfile> {
    // Reducers
    loadConnectionForEdit: (connection: IConnectionDialogProfile) => void;
    loadConnectionAsNewDraft: (connection: IConnectionDialogProfile) => void;
    setConnectionInputType: (inputType: ConnectionInputMode) => void;
    connect: () => void;
    testConnection: () => void;
    saveWithoutConnecting: () => void;
    retryLastSubmitAction: () => void;
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
    signIntoAzureTenantForBrowse: () => void;
    selectAzureAccount: (accountId: string) => void;
    selectAzureTenant: (tenantId: string) => void;
    setSelectedTenantId: (tenantId: string) => void;
    selectSqlCollection: (collectionId: string) => void;
    toggleFavoriteCollection: (collectionId: string, inputMode: ConnectionInputMode) => void;
    messageButtonClicked: (buttonId: string) => void;

    // Request handlers
    getConnectionDisplayName: (connection: IConnectionDialogProfile) => Promise<string>;
    getSqlAnalyticsEndpointUriFromFabric: (sqlEndpoint: SqlDbInfo) => Promise<string>;
    changePassword: (newPassword: string) => Promise<ChangePasswordResult>;
}

export interface ConnectionDialogReducers extends FormReducers<IConnectionDialogProfile> {
    setConnectionInputType: {
        inputMode: ConnectionInputMode;
    };
    loadConnectionForEdit: {
        connection: IConnectionDialogProfile;
    };
    loadConnectionAsNewDraft: {
        connection: IConnectionDialogProfile;
    };
    connect: {};
    testConnection: {};
    saveWithoutConnecting: {};
    retryLastSubmitAction: {};
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
    signIntoAzureTenantForBrowse: {};
    selectAzureAccount: { accountId: string };
    selectAzureTenant: { tenantId: string };
    setSelectedTenantId: { tenantId: string };
    selectSqlCollection: { collectionId: string };
    toggleFavoriteCollection: { collectionId: string; inputMode: ConnectionInputMode };
    messageButtonClicked: { buttonId: string };
}

export namespace OpenOptionInfoLinkNotification {
    export const type = new NotificationType<{ option: FormItemOptions }>(
        "connectionDialog/openOptionInfoLink",
    );
}

export namespace GetConnectionDisplayNameRequest {
    export const type = new RequestType<IConnectionDialogProfile, string, void>(
        "getConnectionDisplayName",
    );
}

export namespace GetSqlAnalyticsEndpointUriFromFabricRequest {
    export const type = new RequestType<SqlDbInfo, string, void>(
        "getSqlAnalyticsEndpointUriFromFabric",
    );
}

export type ConnectionSubDialogDisplayType = "standalone" | "modal";
