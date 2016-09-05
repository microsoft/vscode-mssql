import {RequestType} from 'vscode-languageclient';

// ------------------------------- < Connect Request > ----------------------------------------------

// Connection request message callback declaration
export namespace ConnectionRequest {
     export const type: RequestType<ConnectParams, ConnectionResult, void> = { get method(): string { return 'connection/connect'; } };
}

/**
 * Parameters to initialize a connection to a database
 */
export class ConnectionDetails {
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

    /**
     * unencrypted password
     */
    public password: string;

    /**
     * Gets or sets the authentication to use.
     */
    public authenticationType: string;

    /**
     * Gets or sets a Boolean value that indicates whether SQL Server uses SSL encryption for all data sent between the client and server if
     * the server has a certificate installed.
     */
    public encrypt: boolean;

    /**
     * Gets or sets a value that indicates whether the channel will be encrypted while bypassing walking the certificate chain to validate trust.
     */
    public trustServerCertificate: boolean;

    /**
     * Gets or sets a Boolean value that indicates if security-sensitive information, such as the password, is not returned as part of the
     * connection if the connection is open or has ever been in an open state.
     */
    public persistSecurityInfo: boolean;

    /**
     * Gets or sets the length of time (in seconds) to wait for a connection to the server before terminating the attempt and generating an error.
     */
    public connectTimeout: number;

    /**
     * The number of reconnections attempted after identifying that there was an idle connection failure.
     */
    public connectRetryCount: number;

    /**
     * Amount of time (in seconds) between each reconnection attempt after identifying that there was an idle connection failure.
     */
    public connectRetryInterval: number;

    /**
     * Gets or sets the name of the application associated with the connection string.
     */
    public applicationName: string;

    /**
     * Gets or sets the name of the workstation connecting to SQL Server.
     */
    public workstationId: string;

    /**
     * Declares the application workload type when connecting to a database in an SQL Server Availability Group.
     */
    public applicationIntent: string;

    /**
     * Gets or sets the SQL Server Language record name.
     */
    public currentLanguage: string;

    /**
     * Gets or sets a Boolean value that indicates whether the connection will be pooled or explicitly opened every time that the connection is requested.
     */
    public pooling: boolean;

    /**
     * Gets or sets the maximum number of connections allowed in the connection pool for this specific connection string.
     */
    public maxPoolSize: number;

    /**
     * Gets or sets the minimum number of connections allowed in the connection pool for this specific connection string.
     */
    public minPoolSize: number;

    /**
     * Gets or sets the minimum time, in seconds, for the connection to live in the connection pool before being destroyed.
     */
    public loadBalanceTimeout: number;

    /**
     * Gets or sets a Boolean value that indicates whether replication is supported using the connection.
     */
    public replication: boolean;

    /**
     * Gets or sets a string that contains the name of the primary data file. This includes the full path name of an attachable database.
     */
    public attachDbFilename: string;

    /**
     * Gets or sets the name or address of the partner server to connect to if the primary server is down.
     */
    public failoverPartner: string;

    /**
     * If your application is connecting to an AlwaysOn availability group (AG) on different subnets, setting MultiSubnetFailover=true provides
     * faster detection of and connection to the (currently) active server.
     */
    public multiSubnetFailover: boolean;

    /**
     * When true, an application can maintain multiple active result sets (MARS).
     */
    public multipleActiveResultSets: boolean;

    /**
     * Gets or sets the size in bytes of the network packets used to communicate with an instance of SQL Server.
     */
    public packetSize: number;

    /**
     * Gets or sets a string value that indicates the type system the application expects.
     */
    public typeSystemVersion: string;
}

// Connection request message format
export class ConnectParams {
    // URI identifying the owner of the connection
    public ownerUri: string;

    // Details for creating the connection
    public connection: ConnectionDetails;
}

// Connection response format
export class ConnectionResult {
    // connection id returned from service host
    public connectionId: string;

    // any diagnostic messages return from the service host
    public messages: string;
}

// ------------------------------- </ Connect Request > ---------------------------------------------

// ------------------------------- < Disconnect Request > -------------------------------------------

// Disconnect request message callback declaration
export namespace DisconnectRequest {
    export const type: RequestType<DisconnectParams, DisconnectResult, void> = { get method(): string { return 'connection/disconnect'; } };
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
    export const type: RequestType<ListDatabasesParams, ListDatabasesResult, void> = { get method(): string { return 'connection/listdatabases'; } };
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

// --------------------------------- < Version Request > -------------------------------------------------

// Version request message callback declaration
export namespace VersionRequest {
    export const type: RequestType<void, VersionResult, void> = { get method(): string { return 'version'; } };
}

// Version response format
export type VersionResult = string;

// ------------------------------- </ Version Request > --------------------------------------------------
