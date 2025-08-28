/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Status } from "./webview";

export interface FabricSqlDbInfo {
    id: string;
    server: string;
    displayName: string;
    database: string;
    type: string;
    workspaceId: string;
    workspaceName: string;
    tenantId: string;
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
 * ICapacity Fabric capacity as seen in API responses
 */
export interface ICapacity {
    id: string;
    displayName: string;
    region: string;
    sku: string;
    state: ICapacityState;
}

export enum ICapacityState {
    Active = "Active",
    Inactive = "Inactive",
}

/**
 * IWorkspace Fabric workspace as seen in API responses
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

/**
 * IWorkspaceRole Fabric Workspace role as seen in API responses
 */
export interface IWorkspaceRole {
    id: string;
    role: string;
}

/**
 * The possible workspace roles within a Fabric workspace
 */
export enum WorkspaceRole {
    Admin = "Admin",
    Member = "Member",
    Contributor = "Contributor",
    Viewer = "Viewer",
}

/**
 * IArtifact as seen in Fabric api responses
 */
export interface IArtifact {
    id: string;
    type: string;
    displayName: string;
    description: string | undefined;
    workspaceId: string;
    properties: unknown;
}

export interface ISqlDbArtifact extends IArtifact {
    properties: {
        connectionInfo: string;
        connectionString: string;
        databaseName: string;
        serverFqdn: string;
    };
}

export interface IOperationState {
    createdTimeUtc: string;
    error: string;
    lastUpdatedTimeUtc: string;
    percentComplete: string;
    status: IOperationStatus;
}

export enum IOperationStatus {
    Undefined = "Undefined",
    NotStarted = "NotStarted",
    Running = "Running",
    Succeeded = "Succeeded",
    Failed = "Failed",
}
