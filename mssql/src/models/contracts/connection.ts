/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-languageclient";
import { ConnectionDetails, IServerInfo, DataProtocolServerCapabilities } from "vscode-mssql";

// ------------------------------- < Connect Request > ----------------------------------------------

// Connection request message callback declaration
export namespace ConnectionRequest {
    export const type = new RequestType<ConnectParams, boolean, void, void>("connection/connect");
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
    export const type = new NotificationType<ConnectionCompleteParams, void>("connection/complete");
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
    public serverInfo: IServerInfo;

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
    export const type = new RequestType<CancelConnectParams, CancelConnectResult, void, void>(
        "connection/cancelconnect",
    );
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
    export const type = new NotificationType<ConnectionChangedParams, void>(
        "connection/connectionchanged",
    );
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
    export const type = new RequestType<DisconnectParams, DisconnectResult, void, void>(
        "connection/disconnect",
    );
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
    export const type = new RequestType<ListDatabasesParams, ListDatabasesResult, void, void>(
        "connection/listdatabases",
    );
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

// ------------------------------- < Get Connection String Request > ---------------------------------------
/**
 * Get Connection String request callback declaration
 */
export namespace GetConnectionStringRequest {
    export const type = new RequestType<GetConnectionStringParams, string, void, void>(
        "connection/getconnectionstring",
    );
}

/**
 * Get Connection String request format
 */
export class GetConnectionStringParams {
    /**
     * Connection key to lookup connection string for the provided connection Uri
     * If undefined then a connection details should be specified
     */
    public ownerUri?: string;

    /**
     * Connection details used to create the connection string
     * If undefined then a owner Uri should be specified
     */
    public connectionDetails?: ConnectionDetails;

    /**
     * Indicates whether to include the password in the connection string
     */
    public includePassword?: boolean;

    /**
     * Indicates whether to include the password in the connection string
     * default is set to true
     */
    public includeApplicationName?: boolean;
}

// ------------------------------- </ Get Connection String Request > --------------------------------------

// ------------------------------- < Parse Connection String Request > ---------------------------------------
/**
 * Parse Connection String request callback declaration
 */
export namespace ParseConnectionStringRequest {
    export const type = new RequestType<string, ConnectionDetails, void, void>(
        "connection/parseConnectionString",
    );
}

// ------------------------------- </ Build Connection Details > --------------------------------------

// ------------------------------- < Encryption IV/KEY updation Event > ------------------------------------
/**
 * Parameters for the MSAL cache encryption key notification
 */
export class DidChangeEncryptionIVKeyParams {
    /**
     * Buffer encoded IV string for MSAL cache encryption
     */
    public iv: string;
    /**
     * Buffer encoded Key string for MSAL cache encryption
     */
    public key: string;
}

/**
 * Notification sent when the encryption keys are changed.
 */
export namespace EncryptionKeysChangedNotification {
    export const type = new NotificationType<DidChangeEncryptionIVKeyParams, void>(
        "connection/encryptionKeysChanged",
    );
}

// ------------------------------- < Clear Pooled Connections Request > ---------------------------------------

export namespace ClearPooledConnectionsRequest {
    export const type = new RequestType<object, void, void, void>(
        "connection/clearpooledconnections",
    );
}

//#region Connection capabilities

/**
 * Gets the capabilities of the data protocol server
 */
export namespace GetCapabilitiesRequest {
    export const type = new RequestType<object, CapabilitiesResult, void, void>(
        "capabilities/list",
    );
}

export interface CapabilitiesResult {
    capabilities: DataProtocolServerCapabilities;
}

//#endregion
