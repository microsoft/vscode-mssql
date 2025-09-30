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
import { getErrorMessage } from "../utils/utils";
import { Fabric as Loc } from "../constants/locConstants";
import { getCloudSettings } from "../azure/providerSettings";

export class FabricHelper {
    static getFabricApiUriBase(): vscode.Uri {
        const cloudSettings = getCloudSettings();

        if (!cloudSettings.fabric.fabricApiUriBase) {
            throw new Error(
                Loc.fabricNotSupportedInCloud(
                    cloudSettings.displayName,
                    "mssql.customCloud.fabricApiUriBase",
                ),
            );
        }

        return vscode.Uri.parse(cloudSettings.fabric.fabricApiUriBase);
    }

    static getFabricScopeUriBase(): vscode.Uri {
        const cloudSettings = getCloudSettings();

        if (!cloudSettings.fabric.fabricScopeUriBase) {
            throw new Error(
                Loc.fabricNotSupportedInCloud(
                    cloudSettings.displayName,
                    "mssql.customCloud.fabricScopeUriBase",
                ),
            );
        }

        return vscode.Uri.parse(cloudSettings.fabric.fabricScopeUriBase);
    }

    static readonly longRunningOperationCode = 202;
    static readonly defaultRetryInMs = 30;
    static readonly defaultScope = ".default";
    constructor() {}

    public static async getFabricCapacities(tenantId: string): Promise<ICapacity[]> {
        const response = await this.fetchFromFabric<{ value: ICapacity[] }>(
            "capacities",
            Loc.listingCapacitiesForTenant(tenantId),
            tenantId,
        );

        return response.value;
    }

    public static async getFabricWorkspaces(tenantId: string): Promise<IWorkspace[]> {
        const response = await this.fetchFromFabric<{ value: IWorkspace[] }>(
            "workspaces",
            Loc.listingWorkspacesForTenant(tenantId),
            tenantId,
        );

        return response.value;
    }

    /**
     * Retrieves a specific Fabric workspace by its ID for a given tenant.
     *
     * @param workspaceId The ID of the workspace to fetch.
     * @param tenantId The ID of the tenant that owns the workspace.
     * @returns A promise that resolves to the `IWorkspace` object.
     * @throws {Error} Throws an error if the underlying Fabric API request fails.
     */
    public static async getFabricWorkspace(
        workspaceId: string,
        tenantId: string,
    ): Promise<IWorkspace> {
        const response = await this.fetchFromFabric<IWorkspace>(
            `workspaces/${workspaceId}`,
            Loc.gettingWorkspace(workspaceId),
            tenantId,
        );

        return response;
    }

    /**
     * Retrieves the list of Fabric SQL databases for a given workspace.
     *
     * @param workspace The workspace object or workspace ID for which to fetch databases.
     * @param tenantId Optional tenant ID for scoping the request.
     * @returns A promise that resolves to an array of `FabricSqlDbInfo` objects
     * @throws {Error} Throws an error if the underlying Fabric API request fails or if database
     *         processing encounters an error.
     */
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
                Loc.listingSqlDatabasesForWorkspace(workspaceId),
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

    /**
     * Retrieves the list of Fabric SQL endpoints for a given workspace.
     *
     * @param workspace The workspace object or workspace ID to fetch SQL endpoints from.
     * @param tenantId Optional tenant ID for scoping the request.
     * @returns A promise that resolves to an array of `FabricSqlDbInfo` objects.
     */
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
                Loc.listingSqlEndpointsForWorkspace(workspaceId),
                tenantId,
            );

            const resolvedWorkspace = await workspacePromise;

            result.push(
                ...response.value.map((endpoint) => {
                    return {
                        id: endpoint.id,
                        server: undefined, // requires a second Fabric API call to populate; fill later to avoid rate-limiting (50/API/user/minute)
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

    public static async getFabricSqlEndpointServerUri(
        sqlEndpointId: string,
        workspaceId: string,
        tenantId?: string,
    ): Promise<string> {
        try {
            const connectionStringResponse = await this.fetchFromFabric<{
                connectionString: string;
            }>(
                `workspaces/${workspaceId}/sqlEndpoints/${sqlEndpointId}/connectionString`,
                Loc.gettingConnectionStringForSqlEndpoint(sqlEndpointId, workspaceId),
                tenantId,
            );

            // Server URL is returned as the connectionString field.
            return connectionStringResponse.connectionString;
        } catch (error) {
            console.error(`Error fetching server URL for SQL Endpoints: ${getErrorMessage(error)}`);
            throw error;
        }
    }

    public static async getRolesForWorkspace(
        workspaceId: string,
        tenantId?: string,
    ): Promise<IWorkspaceRoleAssignment[] | undefined> {
        try {
            const response = await this.fetchFromFabric<{ value: IWorkspaceRoleAssignment[] }>(
                `workspaces/${workspaceId}/roleAssignments`,
                Loc.listingRoleAssignmentsForWorkspace(workspaceId),
                tenantId,
            );
            return response.value;
        } catch (err) {
            console.error(err);
        }
    }

    public static async getFabricDatabase(
        workspaceId: string,
        databaseId: string,
        tenantId?: string,
    ): Promise<ISqlDbArtifact> {
        const response = await this.fetchFromFabric<ISqlDbArtifact>(
            `workspaces/${workspaceId}/sqlDatabases/${databaseId}`,
            Loc.gettingFabricDatabase(databaseId),
            tenantId,
        );

        return response;
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
            Loc.createWorkspaceWithCapacity(capacityId),
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
            Loc.createSqlDatabaseForWorkspace(workspaceId),
            tenantId,
        );

        return response;
    }

    public static async fetchFromFabric<TResponse>(
        api: string,
        reason: string,
        tenantId: string | undefined,
    ): Promise<TResponse> {
        const uri = vscode.Uri.joinPath(this.getFabricScopeUriBase(), api);
        const httpHelper = new HttpHelper();

        const session = await this.createScopedFabricSession(tenantId, reason);
        let token = session?.accessToken;

        const response = await httpHelper.makeGetRequest<TResponse>(uri.toString(), token);
        const result = response.data;

        if (isFabricError(result)) {
            throw new Error(Loc.fabricApiError(result.errorCode, result.message));
        }

        return result;
    }

    public static async postToFabric<TResponse, TPayload>(
        api: string,
        payload: TPayload,
        reason: string,
        tenantId?: string,
        scopes?: string[],
    ): Promise<TResponse> {
        const uri = vscode.Uri.joinPath(this.getFabricApiUriBase(), api);
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
            throw new Error(Loc.fabricApiError(result.errorCode, result.message));
        }

        return result;
    }

    /**
     * Polls a long-running Fabric API operation until it completes, then fetches the final result.
     */
    private static async handleLongRunningOperation<TResponse>(
        retryAfter: string,
        location: string,
        httpHelper: HttpHelper,
        token?: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Promise<AxiosResponse<TResponse, any>> {
        const retryAfterInMs = parseInt(retryAfter, 10) || this.defaultRetryInMs;

        let longRunningResponse: AxiosResponse<IOperationState> | undefined;
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
                Loc.fabricLongRunningApiError(
                    longRunningResponse.status.toString(),
                    longRunningResponse.data.error,
                ),
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
        fabricScopes: string[] = [this.defaultScope],
    ): Promise<vscode.AuthenticationSession> {
        let scopes = fabricScopes.map((scope) => `${this.getFabricScopeUriBase()}${scope}`);

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
