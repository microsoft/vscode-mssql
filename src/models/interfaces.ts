'use strict';
import vscode = require('vscode');
import Constants = require('./constants');

// interfaces
export enum ContentType {
    Root = 0,
    Messages = 1,
    ResultsetsMeta = 2,
    Columns = 3,
    Rows = 4,
    SaveResults = 5,
    Copy = 6,
    EditorSelection = 7,
    OpenLink = 8,
    ShowError = 9,
    ShowWarning = 10,
    Config = 11
};

export interface ISlickRange {
    fromCell: number;
    fromRow: number;
    toCell: number;
    toRow: number;
}

export enum AuthenticationTypes {
    Integrated = 1,
    SqlLogin = 2,
    ActiveDirectoryUniversal = 3
}

export const ContentTypes = [
    Constants.outputContentTypeRoot,
    Constants.outputContentTypeMessages,
    Constants.outputContentTypeResultsetMeta,
    Constants.outputContentTypeColumns,
    Constants.outputContentTypeRows,
    Constants.outputContentTypeSaveResults,
    Constants.outputContentTypeCopy,
    Constants.outputContentTypeEditorSelection,
    Constants.outputContentTypeOpenLink,
    Constants.outputContentTypeShowError,
    Constants.outputContentTypeShowWarning,
    Constants.outputContentTypeConfig
    ];

/**
 * Interface exposed to the user for creating new database connections.
 */
export interface IConnectionCredentials {
    /**
     * server name
     */
    server: string;

    /**
     * database name
     */
    database: string;

    /**
     * user name
     */
    user: string;

    /**
     * password
     */
    password: string;

    /**
     * The port number to connect to.
     */
    port: number;

    /**
     * Gets or sets the authentication to use.
     */
    authenticationType: string;

    /**
     * Gets or sets a Boolean value that indicates whether SQL Server uses SSL encryption for all data sent between the client and server if
     * the server has a certificate installed.
     */
    encrypt: boolean;

    /**
     * Gets or sets a value that indicates whether the channel will be encrypted while bypassing walking the certificate chain to validate trust.
     */
    trustServerCertificate: boolean;

    /**
     * Gets or sets a Boolean value that indicates if security-sensitive information, such as the password, is not returned as part of the connection
     * if the connection is open or has ever been in an open state.
     */
    persistSecurityInfo: boolean;

    /**
     * Gets or sets the length of time (in seconds) to wait for a connection to the server before terminating the attempt and generating an error.
     */
    connectTimeout: number;

    /**
     * The number of reconnections attempted after identifying that there was an idle connection failure.
     */
    connectRetryCount: number;

    /**
     * Amount of time (in seconds) between each reconnection attempt after identifying that there was an idle connection failure.
     */
    connectRetryInterval: number;

    /**
     * Gets or sets the name of the application associated with the connection string.
     */
    applicationName: string;

    /**
     * Gets or sets the name of the workstation connecting to SQL Server.
     */
    workstationId: string;

    /**
     * Declares the application workload type when connecting to a database in an SQL Server Availability Group.
     */
    applicationIntent: string;

    /**
     * Gets or sets the SQL Server Language record name.
     */
    currentLanguage: string;

    /**
     * Gets or sets a Boolean value that indicates whether the connection will be pooled or explicitly opened every time that the connection is requested.
     */
    pooling: boolean;

    /**
     * Gets or sets the maximum number of connections allowed in the connection pool for this specific connection string.
     */
    maxPoolSize: number;

    /**
     * Gets or sets the minimum number of connections allowed in the connection pool for this specific connection string.
     */
    minPoolSize: number;

    /**
     * Gets or sets the minimum time, in seconds, for the connection to live in the connection pool before being destroyed.
     */
    loadBalanceTimeout: number;

    /**
     * Gets or sets a Boolean value that indicates whether replication is supported using the connection.
     */
    replication: boolean;

    /**
     * Gets or sets a string that contains the name of the primary data file. This includes the full path name of an attachable database.
     */
    attachDbFilename: string;

    /**
     * Gets or sets the name or address of the partner server to connect to if the primary server is down.
     */
    failoverPartner: string;

    /**
     * If your application is connecting to an AlwaysOn availability group (AG) on different subnets, setting MultiSubnetFailover=true
     * provides faster detection of and connection to the (currently) active server.
     */
    multiSubnetFailover: boolean;

    /**
     * When true, an application can maintain multiple active result sets (MARS).
     */
    multipleActiveResultSets: boolean;

    /**
     * Gets or sets the size in bytes of the network packets used to communicate with an instance of SQL Server.
     */
    packetSize: number;

    /**
     * Gets or sets a string value that indicates the type system the application expects.
     */
    typeSystemVersion: string;
}

// A Connection Profile contains all the properties of connection credentials, with additional
// optional name and details on whether password should be saved
export interface IConnectionProfile extends IConnectionCredentials {
    profileName: string;
    savePassword: boolean;
}

export enum CredentialsQuickPickItemType {
    Profile,
    Mru,
    NewConnection
}
export interface IConnectionCredentialsQuickPickItem extends vscode.QuickPickItem {
    connectionCreds: IConnectionCredentials;
    quickPickItemType: CredentialsQuickPickItemType;
};

// Obtained from an active connection to show in the status bar
export interface IConnectionProperties {
    serverVersion: string;
    currentUser: string;
    currentDatabase: string;
};

export interface IDbColumn {
    allowDBNull?: boolean;
    baseCatalogName: string;
    baseColumnName: string;
    baseSchemaName: string;
    baseServerName: string;
    baseTableName: string;
    columnName: string;
    columnOrdinal?: number;
    columnSize?: number;
    isAliased?: boolean;
    isAutoIncrement?: boolean;
    isExpression?: boolean;
    isHidden?: boolean;
    isIdentity?: boolean;
    isKey?: boolean;
    isBytes?: boolean;
    isChars?: boolean;
    isSqlVariant?: boolean;
    isUdt?: boolean;
    dataType: string;
    isXml?: boolean;
    isJson?: boolean;
    isLong?: boolean;
    isReadOnly?: boolean;
    isUnique?: boolean;
    numericPrecision?: number;
    numericScale?: number;
    udtAssemblyQualifiedName: string;
    dataTypeName: string;
}

export interface IGridResultSet {
    columns: IDbColumn[];
    rowsUri: string;
    numberOfRows: number;
}

export interface ISelectionData {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

export interface IResultMessage {
    time: string;
    message: string;
}

export interface IGridBatchMetaData {
    resultSets: IGridResultSet[];
    messages: IResultMessage[];
    hasError: boolean;
    selection: ISelectionData;
    startTime: string;
    endTime: string;
    totalTime: string;
}

export interface IResultsConfig {
    shortcuts: { [key: string]: string };
    messagesDefaultOpen: boolean;
}
