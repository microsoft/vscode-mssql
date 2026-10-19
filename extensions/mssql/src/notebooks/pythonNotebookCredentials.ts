/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IConnectionInfo } from "vscode-mssql";
import ConnectionManager from "../controllers/connectionManager";
import * as Constants from "../constants/constants";
import { PythonNotebooks } from "../constants/locConstants";
import { getUseMsalEntraMfaAuthConfig } from "../azure/utils";
import { getCloudProviderSettings } from "../azure/providerSettings";
import {
    acquireTokenFromVscodeAccountForResource,
    getCloudResourceEndpoint,
} from "../azure/vscodeEntraMfaUtils";

export interface PythonNotebookConnectionReference {
    version: 1;
    connectionId: string;
    database?: string;
}

export interface PythonNotebookDriverConfiguration {
    settings: {
        server: string;
        database?: string;
        encrypt: string;
        trustServerCertificate: boolean;
        hostNameInCertificate?: string;
        loginTimeout: number;
        queryTimeout: number;
        applicationName?: string;
        applicationIntent?: string;
        connectRetryCount?: number;
        connectRetryInterval?: number;
        multiSubnetFailover?: boolean;
    };
    authentication:
        | { kind: "sql"; username: string; password: string }
        | { kind: "integrated" }
        | { kind: "entra" };
}

export interface PythonNotebookSqlToken {
    token: string;
    expiresOn: number;
}

export class PythonNotebookError extends Error {
    constructor(public readonly code: keyof typeof PythonNotebooks.errors) {
        super(PythonNotebooks.errors[code]);
    }
}

export function isPythonNotebookReference(
    value: unknown,
): value is PythonNotebookConnectionReference {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        "version" in value &&
        value.version === 1 &&
        "connectionId" in value &&
        typeof value.connectionId === "string" &&
        value.connectionId.length > 0 &&
        (!("database" in value) ||
            value.database === undefined ||
            typeof value.database === "string")
    );
}

const unsupportedOptions: readonly (keyof IConnectionInfo)[] = [
    "secureEnclaves",
    "columnEncryptionSetting",
    "attestationProtocol",
    "enclaveAttestationUrl",
    "attachDbFilename",
    "failoverPartner",
    "multipleActiveResultSets",
    "replication",
    "typeSystemVersion",
    "currentLanguage",
    "persistSecurityInfo",
    "maxPoolSize",
    "minPoolSize",
    "loadBalanceTimeout",
    "packetSize",
    "workstationId",
];

const identityOptions: readonly (keyof IConnectionInfo)[] = [
    "server",
    "port",
    "database",
    "authenticationType",
    "accountId",
    "tenantId",
    "user",
    "email",
    "password",
    "encrypt",
    "trustServerCertificate",
    "hostNameInCertificate",
    "connectTimeout",
    "commandTimeout",
    "connectRetryCount",
    "connectRetryInterval",
    "applicationName",
    "applicationIntent",
    "multiSubnetFailover",
    "pooling",
    ...unsupportedOptions,
];

function fingerprint(info: IConnectionInfo): string {
    return JSON.stringify(identityOptions.map((key) => info[key]));
}

function timeout(value: number | undefined, defaultValue: number): number {
    if (value === undefined) return defaultValue;
    if (!Number.isInteger(value) || value < 0) throw new PythonNotebookError("unsupported");
    return value;
}

export class PythonNotebookCredentialsProvider {
    private readonly approvedFingerprint: string;
    private readonly approvedReference: string;
    private prepared?: IConnectionInfo;

    constructor(
        private readonly manager: ConnectionManager,
        profile: IConnectionInfo,
        reference: PythonNotebookConnectionReference,
    ) {
        this.approvedFingerprint = fingerprint(profile);
        this.approvedReference = JSON.stringify(reference);
    }

    private async resolve(reference: PythonNotebookConnectionReference): Promise<IConnectionInfo> {
        if (!isPythonNotebookReference(reference))
            throw new PythonNotebookError("connectionMissing");
        const profiles = await this.manager.connectionStore.connectionConfig.getConnections();
        const profile = profiles.find((item) => item.id === reference.connectionId);
        if (!profile) throw new PythonNotebookError("connectionMissing");
        if (
            this.approvedFingerprint !== fingerprint(profile) ||
            this.approvedReference !== JSON.stringify(reference)
        ) {
            throw new PythonNotebookError("profileChanged");
        }
        return profile;
    }

    public async getConfiguration(
        reference: PythonNotebookConnectionReference,
    ): Promise<PythonNotebookDriverConfiguration> {
        const profile = await this.resolve(reference);
        if (!this.prepared) {
            if (
                profile.pooling === false ||
                unsupportedOptions.some(
                    (key) =>
                        profile[key] !== undefined &&
                        profile[key] !== null &&
                        profile[key] !== false &&
                        profile[key] !== "" &&
                        profile[key] !== "Disabled",
                )
            ) {
                throw new PythonNotebookError("unsupported");
            }
            if (
                ![
                    Constants.sqlAuthentication,
                    Constants.integratedauth,
                    Constants.azureMfa,
                ].includes(profile.authenticationType)
            ) {
                throw new PythonNotebookError("unsupported");
            }
            if (
                profile.authenticationType === Constants.azureMfa &&
                (!profile.accountId ||
                    !profile.tenantId ||
                    getCloudResourceEndpoint("sqlResource") !== "https://database.windows.net/")
            ) {
                throw new PythonNotebookError("identity");
            }
            const prepared = await this.manager.prepareConnectionInfo({
                ...profile,
                database: reference.database ?? profile.database,
            });
            if (
                !prepared ||
                prepared.authenticationType !== profile.authenticationType ||
                prepared.accountId !== profile.accountId ||
                prepared.tenantId !== profile.tenantId
            ) {
                throw new PythonNotebookError("identity");
            }
            this.prepared = prepared;
            await this.resolve(reference);
        }
        const info = this.prepared;
        let authentication: PythonNotebookDriverConfiguration["authentication"];
        if (info.authenticationType === Constants.sqlAuthentication) {
            if (!info.user || !info.password) throw new PythonNotebookError("credentials");
            authentication = { kind: "sql", username: info.user, password: info.password };
        } else if (info.authenticationType === Constants.integratedauth) {
            authentication = { kind: "integrated" };
        } else {
            authentication = { kind: "entra" };
        }
        const encrypt = info.encrypt;
        const encryption =
            encrypt === undefined ||
            encrypt === true ||
            encrypt === "Mandatory" ||
            encrypt === "True"
                ? "yes"
                : encrypt === false || encrypt === "Optional" || encrypt === "False"
                  ? "no"
                  : encrypt === "Strict"
                    ? "strict"
                    : undefined;
        if (
            !encryption ||
            !info.server ||
            (info.port !== undefined &&
                (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535))
        ) {
            throw new PythonNotebookError("unsupported");
        }
        return {
            settings: {
                server:
                    info.port && !info.server.includes(",")
                        ? `${info.server},${info.port}`
                        : info.server,
                database: info.database || undefined,
                encrypt: encryption,
                trustServerCertificate: info.trustServerCertificate ?? false,
                hostNameInCertificate: info.hostNameInCertificate,
                loginTimeout: timeout(info.connectTimeout, 15),
                queryTimeout: timeout(info.commandTimeout, 30),
                applicationName: info.applicationName,
                applicationIntent: info.applicationIntent,
                connectRetryCount: info.connectRetryCount,
                connectRetryInterval: info.connectRetryInterval,
                multiSubnetFailover: info.multiSubnetFailover,
            },
            authentication,
        };
    }

    public async getLanguageServiceConnectionInfo(
        reference: PythonNotebookConnectionReference,
        actualDatabase: string,
    ): Promise<IConnectionInfo> {
        if (!actualDatabase) throw new PythonNotebookError("initialization");
        await this.getConfiguration(reference);
        const info = { ...this.prepared, database: actualDatabase };
        if (info.authenticationType === Constants.azureMfa) {
            const token = await this.getSqlToken(reference);
            info.azureAccountToken = token.token;
            info.expiresOn = token.expiresOn;
        }
        await this.resolve(reference);
        return info;
    }

    public async validate(reference: PythonNotebookConnectionReference): Promise<void> {
        await this.resolve(reference);
    }

    public async getSqlToken(
        reference: PythonNotebookConnectionReference,
    ): Promise<PythonNotebookSqlToken> {
        await this.resolve(reference);
        const info = this.prepared;
        if (
            !info ||
            info.authenticationType !== Constants.azureMfa ||
            !info.accountId ||
            !info.tenantId
        ) {
            throw new PythonNotebookError("identity");
        }
        let result: PythonNotebookSqlToken | undefined;
        if (!getUseMsalEntraMfaAuthConfig()) {
            const acquired = await acquireTokenFromVscodeAccountForResource(
                "https://database.windows.net/",
                info.accountId,
                info.tenantId,
            );
            if (acquired.account.id !== info.accountId || acquired.tenantId !== info.tenantId) {
                throw new PythonNotebookError("identity");
            }
            result = { token: acquired.token.token, expiresOn: acquired.token.expiresOn };
        } else {
            const account = await this.manager.accountStore.getAccount(info.accountId);
            if (!account) throw new PythonNotebookError("identity");
            const resource = getCloudProviderSettings(account.key.providerId).settings.sqlResource;
            if (resource?.endpoint !== "https://database.windows.net/") {
                throw new PythonNotebookError("unsupported");
            }
            const acquired = await this.manager.azureController.refreshAccessToken(
                account,
                this.manager.accountStore,
                info.tenantId,
                resource,
            );
            if (acquired) result = { token: acquired.token, expiresOn: acquired.expiresOn };
        }
        if (
            !result?.token ||
            !Number.isFinite(result.expiresOn) ||
            result.expiresOn <= Date.now() / 1000
        ) {
            throw new PythonNotebookError("identity");
        }
        await this.resolve(reference);
        return result;
    }
}
