/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {NotificationType, RequestType} from 'vscode-languageclient';

// ------------------------------- < Connect Request > ----------------------------------------------

// Connection request message callback declaration
export namespace ConnectionRequest {
    export const type = new RequestType<ConnectParams, boolean, void, void>('connection/connect');
}

/**
 * Parameters to initialize a connection to a database
 */
export class ConnectionDetails {

    public options: { [name: string]: any } = {};
}

/**
 * Connection request message format
 */
export class ConnectParams {
    /**
     * URI identifying the owner of the connection
     */
    public ownerUri: string;

    /**
     * Details for creating the connection
     */
    public connection: ConnectionDetails;
}

// ------------------------------- </ Connect Request > ---------------------------------------------

// ------------------------------- < Connection Complete Event > ------------------------------------

/**
 * Connection complete event callback declaration.
 */
export namespace ConnectionCompleteNotification {
    export const type = new NotificationType<ConnectionCompleteParams, void>('connection/complete');
}

/**
 * Information about a SQL Server instance.
 */
export class ServerInfo {
    /**
     * The major version of the SQL Server instance.
     */
    public serverMajorVersion: number;

    /**
     * The minor version of the SQL Server instance.
     */
    public serverMinorVersion: number;

    /**
     * The build of the SQL Server instance.
     */
    public serverReleaseVersion: number;

    /**
     * The ID of the engine edition of the SQL Server instance.
     */
    public engineEditionId: number;

    /**
     * String containing the full server version text.
     */
    public serverVersion: string;

    /**
     * String describing the product level of the server.
     */
    public serverLevel: string;

    /**
     * The edition of the SQL Server instance.
     */
    public serverEdition: string;

    /**
     * Whether the SQL Server instance is running in the cloud (Azure) or not.
     */
    public isCloud: boolean;

    /**
     * The version of Azure that the SQL Server instance is running on, if applicable.
     */
    public azureVersion: number;

    /**
     * The Operating System version string of the machine running the SQL Server instance.
     */
    public osVersion: string;
}

/**
 * Connection response format.
 */
export class ConnectionCompleteParams {
    /**
     * URI identifying the owner of the connection
     */
    public ownerUri: string;

    /**
     * connection id returned from service host.
     */
    public connectionId: string;

    /**
     * any diagnostic messages return from the service host.
     */
    public messages: string;

    /**
     * Error message returned from the engine, if any.
     */
    public errorMessage: string;

    /**
     * Error number returned from the engine, if any.
     */
    public errorNumber: number;

    /**
     * Information about the connected server.
     */
    public serverInfo: ServerInfo;

    /**
     * information about the actual connection established
     */
    public connectionSummary: ConnectionSummary;
}

// ------------------------------- </ Connection Complete Event > -----------------------------------

// ------------------------------- < Cancel Connect Request > ---------------------------------------

/**
 * Cancel connect request message callback declaration
 */
export namespace CancelConnectRequest {
    export const type = new RequestType<CancelConnectParams, CancelConnectResult, void, void>('connection/cancelconnect');
}


/**
 * Cancel connect request message format
 */
export class CancelConnectParams {
    /**
     * URI identifying the owner of the connection
     */
    public ownerUri: string;
}

/**
 * Cancel connect response format.
 */
export type CancelConnectResult = boolean;

// ------------------------------- </ Cancel Connect Request > --------------------------------------

// ------------------------------- < Connection Changed Event > -------------------------------------

/**
 * Connection changed event callback declaration.
 */
export namespace ConnectionChangedNotification {
    export const type = new NotificationType<ConnectionChangedParams, void>('connection/connectionchanged');
}

/**
 * Summary that identifies a unique database connection.
 */
export class ConnectionSummary {
    /**
     * server name
     */
    public serverName: string;

    /**
     * database name
     */
    public databaseName: string;

    /**
     * user name
     */
    public userName: string;
}

/**
 * Parameters for the ConnectionChanged notification.
 */
export class ConnectionChangedParams {
    /**
     * Owner URI of the connection that changed.
     */
    public ownerUri: string;

    /**
     * Summary of details containing any connection changes.
     */
    public connection: ConnectionSummary;
}

// ------------------------------- </ Connection Changed Event > ------------------------------------

// ------------------------------- < Disconnect Request > -------------------------------------------

// Disconnect request message callback declaration
export namespace DisconnectRequest {
    export const type = new RequestType<DisconnectParams, DisconnectResult, void, void>('connection/disconnect');
}


// Disconnect request message format
export class DisconnectParams {
    // URI identifying the owner of the connection
    public ownerUri: string;
}

// Disconnect response format
export type DisconnectResult = boolean;

// ------------------------------- </ Disconnect Request > ------------------------------------------

// ------------------------------- < List Databases Request > ---------------------------------------

// List databases request callback declaration
export namespace ListDatabasesRequest {
    export const type = new RequestType<ListDatabasesParams, ListDatabasesResult, void, void>('connection/listdatabases');
}

// List databases request format
export class ListDatabasesParams {
    // Connection information to use for querying master
    public ownerUri: string;
}

// List databases response format
export class ListDatabasesResult {
    public databaseNames: Array<string>;
}

// ------------------------------- </ List Databases Request > --------------------------------------

// ------------------------------- < Connection String Request > ---------------------------------------
/**
 * Get Connection String request callback declaration
 */
export namespace GetConnectionStringRequest {
    export const type = new RequestType<GetConnectionStringParams, GetConnectionStringResult, void, void>('connection/getconnectionstring');
}

/**
 * Get Connection String request format
 */
export class GetConnectionStringParams {
    /**
     * Connection key to lookup connection string for the provided connection Uri
     */
    public ownerUri: string;

    /**
     * Indicates whether to include the password in the connection string
     */
    public includePassword?: boolean;
}

/**
 * Connection string response format
 */
export class GetConnectionStringResult {
    public connectionString: string;
}

// ------------------------------- </ Connection String Request > --------------------------------------
