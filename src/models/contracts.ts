import {RequestType} from 'vscode-languageclient';

// ------------------------------- < Connect Request > ----------------------------------------------

// Connection request message callback declaration
export namespace ConnectionRequest {
     export const type: RequestType<ConnectParams, ConnectionResult, void> = { get method(): string { return 'connection/connect'; } };
}

// Required parameters to initialize a connection to a database
export class ConnectionDetails {
    // server name
    public serverName: string;

    // database name
    public databaseName: string;

    // user name
    public userName: string;

    // unencrypted password
    public password: string;
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
// --------------------------------- < Version Request > -------------------------------------------------

// Version request message callback declaration
export namespace VersionRequest {
    export const type: RequestType<void, VersionResult, void> = { get method(): string { return 'version'; } };
}

// Version response format
export type VersionResult = string;

// ------------------------------- </ Version Request > --------------------------------------------------
