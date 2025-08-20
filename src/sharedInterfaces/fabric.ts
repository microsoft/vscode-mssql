/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface FabricSqlDbInfo {
    server: string;
    database: string;
    workspace: IWorkspace;
    tags: string[];
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
}

/**
 * IWorkspaceRole Fabric Workspace role as seen in api responses
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
