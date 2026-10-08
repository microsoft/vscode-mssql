/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConnectionInfo } from "vscode-mssql";
import ConnectionManager from "../controllers/connectionManager";
import {
    acquireTokenFromVscodeAccountForResource,
    getCloudResourceEndpoint,
} from "../azure/vscodeEntraMfaUtils";
import { getUseMsalEntraMfaAuthConfig } from "../azure/utils";
import {
    PreparedConnection,
    ProfileSecretSource,
    ProfileTokenSource,
    StoredConnectionProfile,
    prepareConnection,
    profilePrincipal,
} from "../services/metadata/profileAuthAdapter";
import {
    PerformanceConnectionReference,
    PerformanceUnavailable,
} from "../sharedInterfaces/performance";
import { unavailable, unavailableFromError } from "./performanceSessionPool";

export interface ResolvedPerformanceConnection {
    readonly connection: PreparedConnection;
    /** The connection's database, or an empty string for the login's default database. */
    readonly database: string;
}

/** Finds the connection that a surface names. */
export interface PerformanceConnectionResolver {
    resolve(
        reference: PerformanceConnectionReference,
    ): Promise<ResolvedPerformanceConnection | PerformanceUnavailable>;
}

/**
 * Resolves owner URIs of active connections (the `connectionId` of Copilot tools and webviews)
 * and saved profile IDs through the connection manager. The data plane opens its own sessions
 * with the same credentials: the password of the active connection or from the credential store,
 * or a Microsoft Entra token from the VS Code account.
 */
export class ConnectionManagerPerformanceResolver implements PerformanceConnectionResolver {
    private readonly _secrets: ProfileSecretSource;

    constructor(
        private readonly _connectionManager: ConnectionManager,
        private readonly _tokens: ProfileTokenSource = vscodeAccountTokenSource,
        private readonly _usesMsalEntraAccounts: () => boolean = getUseMsalEntraMfaAuthConfig,
    ) {
        this._secrets = {
            lookupPassword: async (credentials) => {
                const info = credentials as IConnectionInfo;
                return info.password
                    ? info.password
                    : this._connectionManager.connectionStore.lookupPassword(info);
            },
        };
    }

    async resolve(
        reference: PerformanceConnectionReference,
    ): Promise<ResolvedPerformanceConnection | PerformanceUnavailable> {
        const profile = await this.findProfile(reference);
        if (!profile) {
            return unavailable("connectionNotFound");
        }
        let connection: PreparedConnection;
        try {
            connection = prepareConnection(
                profile as StoredConnectionProfile,
                this._secrets,
                this._tokens,
            );
        } catch (error) {
            return unavailableFromError(error);
        }
        if (connection.authKind === "aad" && this._usesMsalEntraAccounts()) {
            // Entra connections that use the MSAL token cache have no token to give the data plane.
            return unavailable("authenticationUnsupported", {
                detail: "Microsoft Entra connections need VS Code accounts.",
            });
        }
        return { connection, database: profile.database ?? "" };
    }

    private async findProfile(
        reference: PerformanceConnectionReference,
    ): Promise<IConnectionInfo | undefined> {
        if (reference.ownerUri !== undefined) {
            return this._connectionManager.getConnectionInfo(reference.ownerUri)?.credentials;
        }
        return this._connectionManager.connectionStore.connectionConfig.getConnectionById(
            reference.profileId,
        );
    }
}

/** Gets a SQL access token for an Entra profile from its VS Code account. */
export const vscodeAccountTokenSource: ProfileTokenSource = {
    async acquireSqlAccessToken(profile: StoredConnectionProfile): Promise<string | undefined> {
        const tokenInfo = await acquireTokenFromVscodeAccountForResource(
            getCloudResourceEndpoint("sqlResource"),
            profile.accountId,
            profile.tenantId,
            profilePrincipal(profile),
        );
        return tokenInfo.token.token;
    },
};
