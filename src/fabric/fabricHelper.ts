/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    FabricSqlDbInfo,
    IWorkspace,
    IFabricError,
    ICapacity,
    IOperationState,
    IOperationStatus,
    ISqlDbArtifact,
    ISqlEndpointArtifact,
    IWorkspaceRoleAssignment,
} from "../sharedInterfaces/fabric";
import { HttpHelper } from "../http/httpHelper";
import { AxiosResponse } from "axios";

export class FabricHelper {
    static readonly fabricUriBase = vscode.Uri.parse("https://api.fabric.microsoft.com/v1/");
    static readonly fabricTokenRequestUriBase = vscode.Uri.parse(
        "https://analysis.windows.net/powerbi/api/",
    );
    static readonly longRunningOperationCode = 202;
    constructor() {}

    public static async getFabricCapacities(tenantId: string): Promise<ICapacity[]> {
        const response = await this.fetchFromFabric<{ value: ICapacity[] }>(
            "capacities",
            `listing Fabric capacities for tenant '${tenantId}'`,
            tenantId,
        );

        return response.value;
    }

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
                        id: db.id,
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

            result.push(
                ...response.value.map((endpoint) => {
                    return {
                        id: endpoint.id,
                        server: undefined, // requires a second Fabric API call to populate; fill later to avoid throttling
                        displayName: endpoint.displayName,
                        database: "TO VALIDATE", // TODO: validate that warehouses don't have a database
                        workspaceName: resolvedWorkspace.displayName,
                        type: endpoint.type,
                    } as FabricSqlDbInfo;
                }),
            );
        } catch (error) {
            console.error("Error processing Fabric SQL Endpoints:", error);
            throw error;
        }

        return result;
    }

    public static async getRoleForWorkspace(
        workspaceId: string,
        tenantId?: string,
    ): Promise<IWorkspaceRoleAssignment[] | undefined> {
        try {
            const response = await this.fetchFromFabric<{ value: IWorkspaceRoleAssignment[] }>(
                `workspaces/${workspaceId}/roleAssignments`,
                `listing role assignements for workspace '${workspaceId}'`,
                tenantId,
            );
            return response.value;
        } catch (err) {
            // console.log(err);
        }
    }

    public static async fetchFromFabric<TResponse>(
        api: string,
        reason: string,
        tenantId: string | undefined,
    ): Promise<TResponse> {
        const uri = vscode.Uri.joinPath(this.fabricUriBase, api);
        const httpHelper = new HttpHelper();

        const session = await this.createScopedFabricSession(tenantId, reason);
        let token = session?.accessToken;

        const response = await httpHelper.makeGetRequest<TResponse>(uri.toString(), token);
        const result = response.data;

        if (isFabricError(result)) {
            const errorMessage = `Fabric API error occurred (${result.errorCode}): ${result.message}`;
            throw new Error(errorMessage);
        }

        return result;
    }

    public static async createWorkspace(
        capacityId: string,
        displayName: string,
        description: string,
        tenantId?: string,
    ) {
        const response = await this.postToFabric<
            IWorkspace,
            { displayName: string; capacityId: string; description: string }
        >(
            `workspaces`,
            {
                displayName: displayName,
                capacityId: capacityId,
                description: description,
            },
            `Create workspace with capacity ${capacityId}`,
            tenantId,
        );

        return response;
    }

    public static async createFabricSqlDatabase(
        workspaceId: string,
        displayName: string,
        description: string,
        tenantId?: string,
    ) {
        const response = await this.postToFabric<
            ISqlDbArtifact,
            { displayName: string; description: string }
        >(
            `workspaces/${workspaceId}/sqlDatabases`,
            {
                displayName: displayName,
                description: description,
            },
            `Create SQL Database for workspace ${workspaceId}`,
            tenantId,
        );

        return response;
    }

    public static async postToFabric<TResponse, TPayload>(
        api: string,
        payload: TPayload,
        reason: string,
        tenantId?: string,
        scopes?: string[],
    ): Promise<TResponse> {
        const uri = vscode.Uri.joinPath(this.fabricUriBase, api);
        const httpHelper = new HttpHelper();

        const session = await this.createScopedFabricSession(tenantId, reason, scopes);
        const token = session?.accessToken;

        let response = await httpHelper.makePostRequest<TResponse, TPayload>(
            uri.toString(),
            token,
            payload,
        );

        if (response.status === this.longRunningOperationCode) {
            response = await this.handleLongRunningOperation(
                response.headers["retry-after"] as string,
                response.headers["location"],
                httpHelper,
                token,
            );
        }

        const result = response.data;
        if (isFabricError(result)) {
            throw new Error(`Fabric API error occurred (${result.errorCode}): ${result.message}`);
        }
        return result;
    }

    /**
     * Polls a long-running Fabric API operation until it completes, then fetches the final result.
     *
     * @param retryAfter - Initial retry interval in seconds from the POST response.
     * @param location - The URL to poll for operation status.
     * @param httpHelper - HttpHelper instance used to make requests.
     * @param token - Optional authentication token.
     * @returns The final response containing the completed operation’s result.
     */
    private static async handleLongRunningOperation<TResponse>(
        retryAfter: string,
        location: string,
        httpHelper: HttpHelper,
        token?: string,
    ): Promise<AxiosResponse<TResponse, any>> {
        const retryAfterInMs = parseInt(retryAfter, 10) || 30;

        let longRunningResponse;
        while (
            !longRunningResponse ||
            longRunningResponse.data.status === IOperationStatus.Running ||
            longRunningResponse.data.status === IOperationStatus.NotStarted
        ) {
            await new Promise((resolve) => setTimeout(resolve, retryAfterInMs * 1000));
            longRunningResponse = await httpHelper.makeGetRequest<IOperationState>(location, token);
        }

        if (longRunningResponse.data.status === IOperationStatus.Failed) {
            throw new Error(
                `Fabric API error occurred (${longRunningResponse.status}): ${longRunningResponse.data.error}`,
            );
        }

        return await httpHelper.makeGetRequest<TResponse>(
            longRunningResponse.headers["location"],
            token,
        );
    }

    /**
     * Creates or retrieves a Fabric authentication session with the given scopes.
     *
     * Always requests the `.default` scope to ensure baseline permissions
     *
     * @param tenantId - Optional tenant ID to scope the session to a specific tenant.
     * @param reason - A user-facing string explaining why the session is requested.
     * @param fabricScopes - Additional Fabric scopes to request.
     * @returns A VS Code AuthenticationSession with the requested scopes.
     */
    private static async createScopedFabricSession(
        tenantId: string | undefined,
        reason: string,
        fabricScopes: string[] = [".default"],
    ): Promise<vscode.AuthenticationSession> {
        let scopes = fabricScopes.map((scope) => `${this.fabricTokenRequestUriBase}${scope}`);

        if (tenantId) {
            scopes.push(`VSCODE_TENANT:${tenantId}`);
        }

        return await this.getSession("microsoft", scopes, {
            createIfNone: true,
            requestReason: reason,
        });
    }

    // Logic copied from vscode-fabric's TokenService
    private static async getSession(
        providerId: string,
        scopes: string[],
        options: TokenRequestOptions,
    ): Promise<vscode.AuthenticationSession> {
        if (!options || !options.requestReason.trim()) {
            throw new Error("RequestReason required in TokenRequestOptions");
        }

        // In case there a session is not found, we would like to add a request reason to the modal dialog that will request it,
        // so we replace createIfNone with forceNewSession that behaves identically in this situation,
        // but allows us to pass the request reason for display to the user.
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
