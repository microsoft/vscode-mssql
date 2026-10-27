/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LocalDatabaseSource } from "../sharedInterfaces/azureSqlDatabase";
import type ConnectionManager from "../controllers/connectionManager";
import type { ConnectionInfo } from "../controllers/connectionManager";
import { randomUUID } from "node:crypto";
import type { IServerInfo, SimpleExecuteResult } from "vscode-mssql";
import { DatabaseEngineEdition } from "../databaseProjects/common/enums";
import { RequestType } from "vscode-languageclient";
import type SqlToolsServiceClient from "../languageservice/serviceclient";

const azureSqlContainerEngineEdition = -978196525;
const versionRequest = new RequestType<
    { ownerUri: string; queryString: string },
    SimpleExecuteResult,
    void
>("query/simpleexecute");

export function isAzureSqlDatabaseSource(serverInfo?: IServerInfo): boolean {
    return (
        serverInfo?.engineEditionId === azureSqlContainerEngineEdition ||
        serverInfo?.engineEditionId === DatabaseEngineEdition.SqlDatabase
    );
}

export function getLocalDatabaseConnectionId(connection: ConnectionInfo): string {
    return "id" in connection.credentials &&
        typeof connection.credentials.id === "string" &&
        connection.credentials.id
        ? connection.credentials.id
        : connection.connectionId;
}

export async function connectLocalDatabaseSource(
    manager: ConnectionManager,
    id: string,
    client: SqlToolsServiceClient,
): Promise<LocalDatabaseSource> {
    const profiles = await manager.connectionStore.readAllConnections(true);
    const profile = profiles.find((connection) => connection.id === id);
    const active = Object.entries(manager.activeConnections).find(
        ([uri, connection]) =>
            getLocalDatabaseConnectionId(connection) === id && manager.isConnected(uri),
    );
    const credentials = active?.[1].credentials ?? profile;
    const source = getLocalDatabaseSources(
        credentials
            ? [
                  {
                      ...credentials,
                      id,
                      profileName: profile?.profileName,
                      isConnected: !!active,
                      serverVersion: active?.[1].serverInfo?.serverVersion,
                  },
              ]
            : [],
    )[0];
    if (!source || !credentials) {
        throw new Error("The selected local database connection is no longer available.");
    }
    const uri = active?.[0] ?? `mssql-deployment:${randomUUID()}`;
    if (
        !active &&
        !(await manager.connect(
            uri,
            { ...credentials },
            {
                shouldHandleErrors: false,
                connectionSource: "localToCloudDeployment",
            },
        ))
    ) {
        throw new Error("Unable to connect to the selected local database.");
    }
    const serverInfo = active?.[1].serverInfo ?? manager.getConnectionInfo(uri)?.serverInfo;
    const isAzureSql = isAzureSqlDatabaseSource(serverInfo);
    let serverVersion = serverInfo?.serverVersion;
    if (!isAzureSql) {
        const result = await client.sendRequest(versionRequest, {
            ownerUri: uri,
            queryString: "SELECT @@VERSION AS version;",
        });
        const cell = result.rows?.[0]?.[0];
        const year = !cell?.isNull
            ? cell?.displayValue.match(/\bMicrosoft SQL Server\s+(\d{4})\b/i)?.[1]
            : undefined;
        if (!year || result.messages?.some((message) => message.isError)) {
            throw new Error("Unable to determine the selected SQL Server release year.");
        }
        serverVersion = year;
    }
    return {
        ...source,
        isConnected: true,
        serverVersion,
        ...(isAzureSql ? { isAzureSql: true } : {}),
    };
}

export function getLocalDatabaseSources(
    connections: {
        id?: string;
        profileName?: string;
        server?: string;
        database?: string;
        isConnected?: boolean;
        serverVersion?: string;
        isAzureSql?: boolean;
    }[],
): LocalDatabaseSource[] {
    const sources = new Map<string, LocalDatabaseSource>();
    for (const connection of connections) {
        const server = connection.server?.trim();
        // Match the host, not a prefix such as localhost.example.com.
        if (
            !connection.id ||
            !server ||
            !connection.database?.trim() ||
            !/^(?:tcp:|np:|lpc:)?\s*(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1|\(local\)|\.)(?=$|[,\\])/i.test(
                server,
            ) ||
            (sources.has(connection.id) && !connection.isConnected)
        ) {
            continue;
        }

        sources.set(connection.id, {
            id: connection.id,
            profileName: connection.profileName || sources.get(connection.id)?.profileName || "",
            server,
            database: connection.database,
            isConnected: connection.isConnected ?? false,
            serverVersion: connection.serverVersion,
            ...(connection.isAzureSql ? { isAzureSql: true } : {}),
        });
    }
    return [...sources.values()];
}
