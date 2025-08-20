/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { FabricSqlDbInfoOld, IWorkspace, IFabricError } from "../sharedInterfaces/connectionDialog";
import { HttpHelper } from "../http/httpHelper";

export class FabricHelper {
    static readonly fabricUriBase = vscode.Uri.parse("https://api.fabric.microsoft.com/v1/");
    constructor() {}

    public static async getFabricWorkspaces(tenantId: string): Promise<IWorkspace[]> {
        const response = await this.fetchFromFabric<{ value: IWorkspace[] }>(
            "workspaces",
            tenantId,
        );

        return response.value;
    }

    public static async getFabricWorkspace(
        workspaceId: string,
        tenantId: string,
    ): Promise<IWorkspace> {
        const response = await this.fetchFromFabric<IWorkspace>(
            `workspaces/${workspaceId}`,
            tenantId,
        );

        return response;
    }

    public static async getFabricDatabases(
        workspace: IWorkspace | string,
        tenantId?: string,
    ): Promise<FabricSqlDbInfoOld[]> {
        const workspacePromise =
            typeof workspace === "string"
                ? this.getFabricWorkspace(workspace, tenantId)
                : workspace;

        const response = await this.fetchFromFabric<{ value: ISqlDbArtifact[] }>(
            `workspaces/${typeof workspace === "string" ? workspace : workspace.id}/sqlDatabases`,
            tenantId,
        );

        const resolvedWorkspace = await workspacePromise;

        try {
            return response.value.map((db) => {
                return {
                    server: db.properties.serverFqdn,
                    displayName: db.displayName,
                    database: db.properties.databaseName,
                    workspace: resolvedWorkspace,
                    tags: [],
                } as FabricSqlDbInfoOld;
            });
        } catch (error) {
            console.error("Error processing Fabric databases:", error);
            return [];
        }
    }

    public static async fetchFromFabric<TResponse>(
        api: string,
        tenantId?: string,
    ): Promise<TResponse> {
        const uri = vscode.Uri.joinPath(this.fabricUriBase, api);
        const httpHelper = new HttpHelper();

        const scopes = ["https://analysis.windows.net/powerbi/api/.default"];

        if (tenantId) {
            scopes.push(`VSCODE_TENANT:${tenantId}`);
        }

        const session = await vscode.authentication.getSession("microsoft", scopes, {
            createIfNone: true,
        });
        let token = session?.accessToken;

        const response = await httpHelper.makeGetRequest<TResponse>(uri.toString(), token);
        const result = response.data;

        if (isFabricError(result)) {
            throw new Error(result.errorCode);
        }

        return result;
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isFabricError(obj: any): obj is IFabricError {
    return (
        obj &&
        typeof obj === "object" &&
        typeof obj.errorCode === "string" &&
        typeof obj.message === "string"
    );
}

/**
 * IArtifact as seen in api responses
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
