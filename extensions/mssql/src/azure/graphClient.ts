/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, GraphError } from "@microsoft/microsoft-graph-client";
import { AccessToken, AzureCliCredential } from "@azure/identity";
import * as vscode from "vscode";
import { Azure, AzureSqlContainer, ConnectionDialog } from "../constants/locConstants";
import { UserGroup } from "../models/contracts/azure";
import { getLogger } from "../models/logger";
import { getErrorMessage } from "../utils/utils";

interface GraphServicePrincipal {
    id: string;
    appId: string;
    displayName?: string | null;
}

const guidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

interface GraphToken {
    accessToken: string;
    expiresOnTimestamp?: number;
}

interface GraphConnection {
    client: Client;
    account: vscode.AuthenticationSessionAccountInformation;
    scopes: string[];
    tenantId?: string;
    azureCliCredential?: AzureCliCredential;
    token?: GraphToken;
    authentication?: Promise<GraphToken>;
    generation: number;
}

interface GraphPage<T> {
    value: T[];
    "@odata.nextLink"?: string;
}

function getGraphErrorDetails(error: unknown, depth = 0): Record<string, unknown> {
    const details: Record<string, unknown> = { message: getErrorMessage(error) };
    if (!error || typeof error !== "object") {
        return details;
    }
    const source = error as Record<string, unknown>;
    for (const field of [
        "name",
        "stack",
        "errorCode",
        "errorMessage",
        "subError",
        "correlationId",
        "statusCode",
        "tag",
        "code",
        "requestId",
    ]) {
        const value = source[field];
        if (typeof value === "string" || typeof value === "number") {
            details[field] = value;
        }
    }
    if (depth < 1) {
        for (const field of ["platformBrokerError", "cause"]) {
            if (source[field]) {
                details[field] = getGraphErrorDetails(source[field], depth + 1);
            }
        }
    }
    return details;
}

export class GraphClient implements vscode.Disposable {
    private readonly _connections = new Map<string, GraphConnection>();
    private readonly _sessionListener: vscode.Disposable;
    private readonly _logger = getLogger("MicrosoftGraph");
    private _disposed = false;

    constructor(
        private readonly _createAzureCliCredential = (tenantId: string) =>
            new AzureCliCredential({ tenantId, processTimeoutInMs: 30_000 }),
    ) {
        this._sessionListener = vscode.authentication.onDidChangeSessions((event) => {
            if (event.provider.id !== "microsoft") {
                return;
            }
            for (const connection of this._connections.values()) {
                // VS Code exposes only the provider, not which session changed.
                if (connection.token) {
                    this.invalidate(connection);
                }
            }
        });
    }

    public async fetchUserGroups(
        userId: string,
        account: vscode.AuthenticationSessionAccountInformation,
        tenantId?: string,
    ): Promise<UserGroup[]> {
        try {
            const connection = this.getConnection(account, "User.Read", tenantId);
            const groups = await this.getAll<UserGroup>(
                connection,
                `/users/${encodeURIComponent(userId)}/memberOf`,
            );
            return groups.map(({ id, displayName }) => ({ id, displayName }));
        } catch (error) {
            this._logger.error(`Error fetching user groups: ${getErrorMessage(error)}`);
            throw error;
        }
    }

    public async fetchCurrentUser(
        account: vscode.AuthenticationSessionAccountInformation,
        tenantId: string,
        signal?: AbortSignal,
    ): Promise<{ id: string; userPrincipalName: string }> {
        try {
            const user = await this.sendRequest<{ id: string; userPrincipalName: string }>(
                this.getConnection(account, "User.Read", tenantId),
                "/me?$select=id,userPrincipalName",
                undefined,
                true,
                signal,
            );
            if (
                !user ||
                typeof user.id !== "string" ||
                !guidPattern.test(user.id) ||
                typeof user.userPrincipalName !== "string" ||
                !user.userPrincipalName.trim()
            ) {
                throw new Error(AzureSqlContainer.invalidEntraAdministrator);
            }
            return { id: user.id, userPrincipalName: user.userPrincipalName };
        } catch (error) {
            this._logger.error(
                "Error fetching container Entra administrator",
                getGraphErrorDetails(error),
            );
            throw error;
        }
    }

    public async ensureServicePrincipal(
        applicationId: string,
        account: vscode.AuthenticationSessionAccountInformation,
        tenantId: string,
        signal?: AbortSignal,
    ): Promise<{ id: string; displayName: string }> {
        try {
            if (!guidPattern.test(applicationId)) {
                throw new Error(AzureSqlContainer.invalidApplicationClientId);
            }
            const connection = this.getConnection(account, ".default", tenantId);
            let principal: GraphServicePrincipal;
            try {
                principal = await this.sendRequest<GraphServicePrincipal>(
                    connection,
                    `/servicePrincipals(appId='${applicationId}')?$select=id,appId,displayName`,
                    undefined,
                    true,
                    signal,
                );
            } catch (error) {
                if (!(error instanceof GraphError) || error.statusCode !== 404) {
                    throw error;
                }
                principal = await this.sendRequest<GraphServicePrincipal>(
                    connection,
                    "/servicePrincipals",
                    { appId: applicationId },
                    true,
                    signal,
                );
            }
            if (
                !principal ||
                typeof principal.id !== "string" ||
                !guidPattern.test(principal.id) ||
                typeof principal.appId !== "string" ||
                principal.appId.toLowerCase() !== applicationId.toLowerCase()
            ) {
                throw new Error(AzureSqlContainer.invalidServicePrincipal);
            }
            return {
                id: principal.id,
                displayName: principal.displayName?.trim() || applicationId,
            };
        } catch (error) {
            this._logger.error(
                "Error resolving container service principal",
                getGraphErrorDetails(error),
            );
            throw error;
        }
    }

    public dispose(): void {
        this._disposed = true;
        this._sessionListener.dispose();
        for (const connection of this._connections.values()) {
            this.invalidate(connection);
        }
        this._connections.clear();
    }

    private getConnection(
        account: vscode.AuthenticationSessionAccountInformation,
        permission: "User.Read" | ".default",
        tenantId?: string,
    ): GraphConnection {
        if (this._disposed) {
            throw new Error(Azure.unableToAcquireEntraTokenFromVsCode(account.label));
        }
        if (permission === ".default" && !tenantId) {
            throw new Error(ConnectionDialog.tenantIdIsRequired);
        }
        const scopes = [`https://graph.microsoft.com/${permission}`];
        if (tenantId) {
            scopes.push(`VSCODE_TENANT:${tenantId}`);
        }
        const key = JSON.stringify([account.id, scopes]);
        let connection = this._connections.get(key);
        if (!connection) {
            const newConnection: GraphConnection = {
                account,
                scopes,
                tenantId,
                azureCliCredential:
                    permission === ".default" && tenantId
                        ? this._createAzureCliCredential(tenantId)
                        : undefined,
                generation: 0,
                client: Client.initWithMiddleware({
                    authProvider: {
                        getAccessToken: () => this.getAccessToken(newConnection),
                    },
                }),
            };
            this._connections.set(key, newConnection);
            connection = newConnection;
        }
        return connection;
    }

    private async getAccessToken(connection: GraphConnection): Promise<string> {
        if (this._disposed) {
            throw new Error(Azure.unableToAcquireEntraTokenFromVsCode(connection.account.label));
        }
        if (connection.token) {
            if (
                connection.token.expiresOnTimestamp === undefined ||
                connection.token.expiresOnTimestamp > Date.now() + 60_000
            ) {
                return connection.token.accessToken;
            }
            this.invalidate(connection);
        }
        if (!connection.authentication) {
            const generation = connection.generation;
            const authentication = (
                connection.azureCliCredential
                    ? this.acquireAzureCliToken(connection)
                    : this.acquireSession(connection)
            )
                .catch((error) => {
                    this._logger.error(
                        "Microsoft Graph authentication failed",
                        getGraphErrorDetails(error),
                    );
                    throw error;
                })
                .then((token) => {
                    if (generation !== connection.generation || this._disposed) {
                        throw new Error(
                            Azure.unableToAcquireEntraTokenFromVsCode(connection.account.label),
                        );
                    }
                    connection.token = token;
                    return token;
                })
                .finally(() => {
                    if (connection.authentication === authentication) {
                        connection.authentication = undefined;
                    }
                });
            connection.authentication = authentication;
        }
        return (await connection.authentication).accessToken;
    }

    private async acquireAzureCliToken(connection: GraphConnection): Promise<GraphToken> {
        const { azureCliCredential, tenantId, account } = connection;
        if (!azureCliCredential || !tenantId) {
            throw new Error(ConnectionDialog.tenantIdIsRequired);
        }
        let token: AccessToken;
        try {
            token = await azureCliCredential.getToken("https://graph.microsoft.com/.default");
        } catch (error) {
            // CLI errors can contain command output, so do not log the raw response or token.
            this._logger.error("Azure CLI Graph authentication failed", {
                name: error instanceof Error ? error.name : typeof error,
            });
            throw new Error(Azure.unableToAcquireGraphTokenFromAzureCli(tenantId));
        }
        if (
            typeof token?.token !== "string" ||
            !token.token ||
            !Number.isFinite(token.expiresOnTimestamp) ||
            token.expiresOnTimestamp <= Date.now()
        ) {
            throw new Error(Azure.unableToAcquireGraphTokenFromAzureCli(tenantId));
        }

        // Compare tenant-local Graph identities, not display names or opaque home-account IDs.
        const vscodeConnection = this.getConnection(account, "User.Read", tenantId);
        const expectedUser = await this.sendRequest<unknown>(vscodeConnection, "/me?$select=id");
        const cliClient = Client.initWithMiddleware({
            authProvider: { getAccessToken: async () => token.token },
        });
        const actualUser: unknown = await cliClient.api("/me?$select=id").get();
        if (
            !expectedUser ||
            typeof expectedUser !== "object" ||
            !("id" in expectedUser) ||
            typeof expectedUser.id !== "string" ||
            !expectedUser.id ||
            !actualUser ||
            typeof actualUser !== "object" ||
            !("id" in actualUser) ||
            typeof actualUser.id !== "string" ||
            !actualUser.id
        ) {
            throw new Error(Azure.unableToVerifyGraphAccount);
        }
        if (actualUser.id.toLowerCase() !== expectedUser.id.toLowerCase()) {
            throw new Error(Azure.azureCliGraphAccountMismatch(account.label, tenantId));
        }
        return { accessToken: token.token, expiresOnTimestamp: token.expiresOnTimestamp };
    }

    private async acquireSession(
        connection: GraphConnection,
    ): Promise<vscode.AuthenticationSession> {
        const { account, scopes } = connection;
        const session =
            (await vscode.authentication.getSession("microsoft", scopes, {
                account,
                silent: true,
            })) ??
            (await vscode.authentication.getSession("microsoft", scopes, {
                account,
                createIfNone: true,
            }));
        if (!session?.accessToken) {
            throw new Error(Azure.unableToAcquireEntraTokenFromVsCode(account.label));
        }
        return session;
    }

    private async getAll<T>(connection: GraphConnection, url: string): Promise<T[]> {
        const values: T[] = [];
        let nextUrl: string | undefined = url;
        while (nextUrl) {
            const page = await this.sendRequest<GraphPage<T>>(connection, nextUrl);
            values.push(...page.value);
            nextUrl = page["@odata.nextLink"];
        }
        return values;
    }

    private async sendRequest<T>(
        connection: GraphConnection,
        url: string,
        body?: Record<string, unknown>,
        retryOnUnauthorized = true,
        signal?: AbortSignal,
    ): Promise<T> {
        const generation = connection.generation;
        try {
            signal?.throwIfAborted();
            const request = connection.client.api(url);
            if (signal) {
                request.options({ signal });
            }
            return body === undefined ? await request.get() : await request.post(body);
        } catch (error) {
            if (!(error instanceof GraphError) || error.statusCode !== 401) {
                throw error;
            }
            // Graph tokens can be opaque; reacquire on rejection rather than parsing their expiry.
            if (generation === connection.generation) {
                this.invalidate(connection);
            }
            if (!retryOnUnauthorized) {
                throw error;
            }
            return await this.sendRequest<T>(connection, url, body, false, signal);
        }
    }

    private invalidate(connection: GraphConnection): void {
        connection.generation++;
        connection.token = undefined;
        connection.authentication = undefined;
    }
}

export const graphClient = new GraphClient();
