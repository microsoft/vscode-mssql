/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ErrorCodes, ResponseError } from "vscode-jsonrpc/node";

export const sqlToolsMcpProviderId = "mssql-sqltools-mcp";
export const sqlToolsMcpServerLabel = "SQL Tools MCP (mssql)";
export const sqlToolsMcpBridgeProtocolVersion = "1.0";

export interface BridgeInitializeRequest {
    protocolVersion?: string;
    serverIdentity?: BridgeIdentity;
    hostIdentity?: BridgeIdentity;
}

export interface BridgeInitializeResponse {
    protocolVersion: string;
    hostIdentity: BridgeIdentity;
}

export interface BridgeIdentity {
    name: string;
    version?: string;
}

export interface BridgeConnectionInfo {
    name: string;
    description?: string;
    serverName?: string;
    databaseName?: string;
    providerName?: "vscode";
    connectionHandle?: string;
}

export interface BridgePlatformContext {
    databaseName?: string;
    serverName?: string;
    engineEdition?: string;
    version?: string;
    contextSettings?: Record<string, string>;
}

export interface QueryContentDescriptor {
    query: string;
    executeStoredProcedure?: boolean;
    returnAsMarkdown?: boolean;
    queryParameters?: string[];
}

export interface QueryResult {
    result: string;
    errorMessage: string;
    isError: boolean;
}

export interface RegisterConnectionRequest {
    connectionName: string;
    connectionHandle: string;
}

export interface RegisterConnectionResponse {
    platformContext: BridgePlatformContext;
}

export interface ExecuteQueryRequest {
    connectionName: string;
    queryContentDescriptor: QueryContentDescriptor;
}

export interface ExecuteQueryResponse {
    queryResult: QueryResult;
}

export interface RemoveConnectionRequest {
    connectionName: string;
}

export interface RemoveConnectionResponse {
    removed: boolean;
}

export enum BridgeErrorCode {
    NotReady = "NotReady",
    Unavailable = "Unavailable",
    NotFound = "NotFound",
    AuthenticationRequired = "AuthenticationRequired",
    AuthenticationFailed = "AuthenticationFailed",
    ExecutionFailed = "ExecutionFailed",
    Timeout = "Timeout",
    Cancelled = "Cancelled",
    ProtocolMismatch = "ProtocolMismatch",
    InternalError = "InternalError",
    InvalidRequest = "InvalidRequest",
}

export class BridgeRequestError extends Error {
    constructor(
        public readonly bridgeErrorCode: BridgeErrorCode,
        message: string,
        public readonly retryable = false,
    ) {
        super(message);
    }
}

export function bridgeResponseError(error: unknown): ResponseError<unknown> {
    if (error instanceof BridgeRequestError) {
        return new ResponseError(toJsonRpcErrorCode(error.bridgeErrorCode), error.message, {
            errorCode: error.bridgeErrorCode,
            retryable: error.retryable,
        });
    }

    return new ResponseError(ErrorCodes.InternalError, "SQL Tools MCP bridge request failed.", {
        errorCode: BridgeErrorCode.InternalError,
        retryable: false,
    });
}

function toJsonRpcErrorCode(errorCode: BridgeErrorCode): number {
    switch (errorCode) {
        case BridgeErrorCode.InvalidRequest:
        case BridgeErrorCode.ProtocolMismatch:
            return ErrorCodes.InvalidRequest;
        case BridgeErrorCode.NotFound:
            return ErrorCodes.InvalidParams;
        case BridgeErrorCode.NotReady:
            return ErrorCodes.ServerNotInitialized;
        case BridgeErrorCode.Cancelled:
            return -32800;
        default:
            return ErrorCodes.InternalError;
    }
}
