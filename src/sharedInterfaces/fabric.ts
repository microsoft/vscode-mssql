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
    role?: WorkspaceRole;
    hasCapacityPermissionsForProvisioning?: boolean;
}

export interface IFabricError {
    errorCode: string;
    message: string;
}

/**
 * IWorkspaceRole Fabric Workspace role as seen in API responses
 */
export interface IWorkspaceRoleAssignment {
    id: string;
    role: WorkspaceRole;
}

/**
 * The possible workspace roles within a Fabric workspace, matching API response strings.
 * https://learn.microsoft.com/en-us/rest/api/fabric/core/workspaces/list-workspace-role-assignments?tabs=HTTP#workspacerole
 */
export enum WorkspaceRole {
    Viewer = "Viewer",
    Member = "Member",
    Contributor = "Contributor",
    Admin = "Admin",
}

/**
 * Defines the hierarchy of roles for permission checks.
 * Higher numbers mean higher privileges.
 * https://learn.microsoft.com/en-us/rest/api/fabric/core/workspaces/list-workspace-role-assignments?tabs=HTTP#workspacerole
 */
export const WorkspaceRoleRank: Record<WorkspaceRole, number> = {
    [WorkspaceRole.Viewer]: 0,
    [WorkspaceRole.Member]: 1,
    [WorkspaceRole.Contributor]: 2,
    [WorkspaceRole.Admin]: 3,
};

/**
 * Helper to check if a user has at least a required role.
 *
 * @param userRole The user's current role.
 * @param requiredRole The role required for the action.
 * @returns True if the user has sufficient permissions, false otherwise.
 */
export function hasWorkspacePermission(
    userRole: WorkspaceRole,
    requiredRole: WorkspaceRole,
): boolean {
    return WorkspaceRoleRank[userRole] >= WorkspaceRoleRank[requiredRole];
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

export interface ISqlEndpointArtifact extends IArtifact {}

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
