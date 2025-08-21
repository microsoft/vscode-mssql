/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { FabricSqlDbInfo, IWorkspace, IFabricError } from "../sharedInterfaces/connectionDialog";
import { HttpHelper } from "../http/httpHelper";

export class FabricHelper {
    static readonly fabricUriBase = vscode.Uri.parse("https://api.fabric.microsoft.com/v1/");
    constructor() {}

    public static async getFabricWorkspaces(tenantId: string): Promise<IWorkspace[]> {
        const response = await this.fetchFromFabric<{ value: IWorkspace[] }>(
            "workspaces",
            `listing Fabric workspaces for tenant '${tenantId}'`,
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
            `getting Fabric workspace '${workspaceId}'`,
            tenantId,
        );

        return response;
    }

    public static async getFabricDatabases(
        workspace: IWorkspace | string,
        tenantId?: string,
    ): Promise<FabricSqlDbInfo[]> {
        const workspacePromise =
            typeof workspace === "string"
                ? this.getFabricWorkspace(workspace, tenantId)
                : workspace;

        const workspaceId = typeof workspace === "string" ? workspace : workspace.id;

        const result: FabricSqlDbInfo[] = [];

        try {
            const response = await this.fetchFromFabric<{ value: ISqlDbArtifact[] }>(
                `workspaces/${workspaceId}/sqlDatabases`,
                `Listing Fabric SQL Databases for workspace '${workspaceId}'`,
                tenantId,
            );

            const resolvedWorkspace = await workspacePromise;

            result.push(
                ...response.value.map((db) => {
                    return {
                        server: db.properties.serverFqdn,
                        displayName: db.displayName,
                        database: db.properties.databaseName,
                        workspaceName: resolvedWorkspace.displayName,
                        type: db.type,
                    } as FabricSqlDbInfo;
                }),
            );
        } catch (error) {
            console.error("Error processing Fabric databases:", error);
            throw error;
        }

        return result;
    }

    public static async getFabricSqlEndpoints(workspace: IWorkspace | string, tenantId?: string) {
        const workspacePromise =
            typeof workspace === "string"
                ? this.getFabricWorkspace(workspace, tenantId)
                : workspace;

        const workspaceId = typeof workspace === "string" ? workspace : workspace.id;

        const result: FabricSqlDbInfo[] = [];

        try {
            const response = await this.fetchFromFabric<{ value: ISqlEndpointArtifact[] }>(
                `workspaces/${workspaceId}/sqlEndpoints`,
                `Listing Fabric SQL Endpoints for workspace '${workspaceId}'`,
                tenantId,
            );

            const resolvedWorkspace = await workspacePromise;

            for (const endpoint of response.value) {
                const connectionStringResponse = await this.fetchFromFabric<{
                    connectionString: string;
                }>(
                    `workspaces/${workspaceId}/sqlEndpoints/${endpoint.id}/connectionString`,
                    `Getting connection string for SQL Endpoint '${endpoint.id}' in workspace '${workspaceId}'`,
                    tenantId,
                );

                result.push({
                    server: connectionStringResponse.connectionString,
                    displayName: endpoint.displayName,
                    database: "TO VALIDATE", // TODO: validate that warehouses don't have a database
                    workspaceName: resolvedWorkspace.displayName,
                    type: endpoint.type,
                } as FabricSqlDbInfo);
            }
        } catch (error) {
            console.error("Error processing Fabric SQL Endpoints:", error);
            throw error;
        }

        return result;
    }

    public static async fetchFromFabric<TResponse>(
        api: string,
        reason: string,
        tenantId: string,
    ): Promise<TResponse> {
        const uri = vscode.Uri.joinPath(this.fabricUriBase, api);
        const httpHelper = new HttpHelper();

        const scopes = ["https://analysis.windows.net/powerbi/api/.default"];

        if (tenantId) {
            scopes.push(`VSCODE_TENANT:${tenantId}`);
        }

        const session = await this.getSession("microsoft", scopes, {
            createIfNone: true,
            requestReason: reason,
        });
        let token = session?.accessToken;

        const response = await httpHelper.makeGetRequest<TResponse>(uri.toString(), token);
        const result = response.data;

        if (isFabricError(result)) {
            const errorMessage = `Fabric API error occurred (${result.errorCode}): ${result.message}`;
            throw new Error(errorMessage);
        }

        return result;
    }

    private static async getSession(
        providerId: string,
        scopes: string[],
        options: TokenRequestOptions,
    ) {
        // const session = await vscode.authentication.getSession("microsoft", scopes, {
        //     createIfNone: true,
        // });

        // return session;

        if (!options || /*!options.callerId.trim() ||*/ !options.requestReason.trim()) {
            throw new Error("Please provide requestReason in TokenRequestOptions"); // Please provide callerId and requestReason in TokenRequestOptions
        }

        // In case there a session is not found, we would like to add a request reason to the modal dialog that will request it,
        // so we replace createIfNone with forceNewSession that behaves identically in this situation, but allows us to pass the request reason.
        if (options.createIfNone && !options.forceNewSession) {
            const session = await vscode.authentication.getSession(providerId, scopes, {
                silent: true,
            });
            if (session) {
                return session;
            } else {
                options.createIfNone = false;
                options.forceNewSession = true;
            }
        }

        if (options.forceNewSession === true) {
            options.forceNewSession = { detail: options.requestReason };
        }

        return await vscode.authentication.getSession(providerId, scopes, options);
    }
}

export interface TokenRequestOptions extends vscode.AuthenticationGetSessionOptions {
    /**
     * Identifier of caller partner (ex. NuGet or AvailabilityService) that would be used for telemetry.
     */
    callerId?: string;

    /**
     * Reason to request session from customer. This string could be displayed to customer in the future, so ideally should be localized.
     */
    requestReason: string;
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

export interface ISqlEndpointArtifact extends IArtifact {}
