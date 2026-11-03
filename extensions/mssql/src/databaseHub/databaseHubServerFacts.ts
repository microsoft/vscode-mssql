/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Server facts for the Database Hub, saved in global state for each connection ID.
 *
 * - On each connection, the engine edition and machine name come from the server info that the
 *   connection already returned.
 * - A query reads `@@SERVERNAME` and the SQL Server Azure Arc table, through the SQL data plane
 *   sessions of performance monitoring. It runs when a SQL Server's Arc state is missing or a day
 *   old, or when an Azure SQL connection's host doesn't name the logical server.
 * - Facts read for another server are ignored, so editing a profile's server discards them.
 */

import * as vscode from "vscode";
import type { SqlResultSet, SqlValue } from "sql-core";
import type { IServerInfo } from "vscode-mssql";
import { parseArmResourceId } from "../fabric/fabricDatabaseHub";
import { ILogger } from "../sharedInterfaces/logger";
import { isPerformanceUnavailable } from "../sharedInterfaces/performanceDashboard";
import type { PerformanceConnectionResolver } from "../performance/performanceConnections";
import type { PerformanceSessionPool } from "../performance/performanceSessionPool";
import {
    DatabaseHubArcRegistration,
    DatabaseHubConnection,
    DatabaseHubPlatform,
    DatabaseHubServerFacts,
    classifyDatabaseHubTarget,
    getAzureSqlServerName,
    getServerHost,
    isContainerMachineName,
    isLocalServer,
} from "./databaseHubTarget";

const serverFactsKey = "mssql.databaseHub.serverFacts";

/** How long the Arc state of a SQL Server is trusted before it is read again. */
export const arcRefreshIntervalMs = 24 * 60 * 60_000;

const detectionTimeoutMs = 15_000;

/** A saved profile, as far as server facts need it. */
export interface DatabaseHubProfile extends DatabaseHubConnection {
    readonly id: string;
}

/** Saves server facts in global state, keyed by connection ID. */
export class DatabaseHubServerFactsStore implements vscode.Disposable {
    private readonly _onDidChange = new vscode.EventEmitter<string>();
    /** Fires with the connection ID whose facts changed. */
    public readonly onDidChange = this._onDidChange.event;

    constructor(private readonly _memento: vscode.Memento) {}

    /** Returns the facts saved for a connection's current server. */
    public get(connection: DatabaseHubProfile): DatabaseHubServerFacts | undefined {
        const facts = this.all()[connection.id];
        return facts && sameServer(facts.server, connection.server) ? facts : undefined;
    }

    public async set(connectionId: string, facts: DatabaseHubServerFacts): Promise<void> {
        await this._memento.update(serverFactsKey, { ...this.all(), [connectionId]: facts });
        this._onDidChange.fire(connectionId);
    }

    public dispose(): void {
        this._onDidChange.dispose();
    }

    private all(): Record<string, DatabaseHubServerFacts> {
        return this._memento.get<Record<string, DatabaseHubServerFacts>>(serverFactsKey) ?? {};
    }
}

function sameServer(first: string, second: string): boolean {
    return first.trim().toLowerCase() === second.trim().toLowerCase();
}

/** Reads and saves server facts. */
export class DatabaseHubServerFactsDetector {
    private readonly _running = new Map<string, Promise<DatabaseHubServerFacts | undefined>>();

    constructor(
        private readonly _store: DatabaseHubServerFactsStore,
        private readonly _connections: PerformanceConnectionResolver,
        private readonly _pool: PerformanceSessionPool,
        private readonly _logger: ILogger,
    ) {}

    /**
     * Saves the facts that a new connection returned, then reads the rest in the background when
     * they are missing or old.
     */
    public async onConnected(profile: DatabaseHubProfile, serverInfo: IServerInfo): Promise<void> {
        const machineName = (serverInfo as { machineName?: string }).machineName || undefined;
        const facts: DatabaseHubServerFacts = {
            ...this._store.get(profile),
            server: profile.server,
            engineEdition: serverInfo.engineEditionId,
            machineName,
            serverVersion: serverInfo.serverVersion || undefined,
            serverEdition: serverInfo.serverEdition || undefined,
            isCloud: serverInfo.isCloud,
            isContainer:
                !!profile.containerName ||
                (isLocalServer(profile.server) && isContainerMachineName(machineName)),
        };
        await this._store.set(profile.id, facts);
        if (needsQuery(profile, facts)) {
            void this.detect(profile);
        }
    }

    /**
     * Returns the facts of a connection, reading them first when they are missing or old. Facts
     * that can't be read are left as they were.
     */
    public async ensure(profile: DatabaseHubProfile): Promise<DatabaseHubServerFacts | undefined> {
        const facts = this._store.get(profile);
        return needsQuery(profile, facts ?? { server: profile.server })
            ? ((await this.detect(profile)) ?? facts)
            : facts;
    }

    private detect(profile: DatabaseHubProfile): Promise<DatabaseHubServerFacts | undefined> {
        const running = this._running.get(profile.id);
        if (running) {
            return running;
        }
        const detection = this.read(profile).finally(() => this._running.delete(profile.id));
        this._running.set(profile.id, detection);
        return detection;
    }

    private async read(profile: DatabaseHubProfile): Promise<DatabaseHubServerFacts | undefined> {
        if (this._pool.availability()) {
            this._logger.debug("The SQL data plane is off; server facts are not read.");
            return undefined;
        }
        const resolved = await this._connections.resolve(profile.id);
        if (isPerformanceUnavailable(resolved)) {
            this._logger.debug(`Server facts can't be read: ${resolved.reason}`);
            return undefined;
        }
        try {
            const resultSets = await this._pool
                .session(resolved.connection, resolved.database, "read")
                .read(serverFactsQuery, { timeoutMs: detectionTimeoutMs });
            const facts = toServerFacts(resultSets, {
                ...this._store.get(profile),
                server: profile.server,
            });
            await this._store.set(profile.id, facts);
            return facts;
        } catch (error) {
            this._logger.debug(
                `Reading server facts failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            return undefined;
        }
    }
}

/** Whether the saved facts lack something that only a query can tell. */
function needsQuery(profile: DatabaseHubConnection, facts: DatabaseHubServerFacts): boolean {
    const { platform } = classifyDatabaseHubTarget(profile, profile.database, facts);
    if (platform === DatabaseHubPlatform.AzureSqlDatabase) {
        return !facts.logicalServerName && !getAzureSqlServerName(profile.server);
    }
    if (platform === DatabaseHubPlatform.SqlServer) {
        return (
            !facts.arc ||
            facts.arcCheckedAt === undefined ||
            Date.now() - facts.arcCheckedAt > arcRefreshIntervalMs
        );
    }
    return false;
}

/**
 * Reads the engine edition, `@@SERVERNAME`, the machine name, and, on SQL Server, the first row
 * of the Azure Arc table. Errors reading the table are caught, so a login that can't read it
 * still gets the other facts. The table's columns aren't documented, so the row is read whole.
 */
export const serverFactsQuery = `SET NOCOUNT ON;
DECLARE @engineEdition int = CONVERT(int, SERVERPROPERTY('EngineEdition'));
DECLARE @arcState nvarchar(16) = N'skipped';
IF @engineEdition IN (1, 2, 3, 4)
BEGIN
    IF HAS_DBACCESS(N'msdb') = 1 AND OBJECT_ID(N'msdb.dbo.SQLServerAzureArcProperties') IS NOT NULL
    BEGIN
        BEGIN TRY
            EXEC (N'SELECT TOP (1) * FROM msdb.dbo.SQLServerAzureArcProperties;');
            SET @arcState = N'read';
        END TRY
        BEGIN CATCH
            SET @arcState = N'unknown';
        END CATCH
    END
    ELSE IF HAS_DBACCESS(N'msdb') = 1
        AND (IS_SRVROLEMEMBER(N'sysadmin') = 1
            OR HAS_PERMS_BY_NAME(NULL, NULL, N'VIEW ANY DEFINITION') = 1)
        SET @arcState = N'missing';
    ELSE
        SET @arcState = N'unknown';
END
SELECT @engineEdition AS EngineEdition,
    CONVERT(nvarchar(256), @@SERVERNAME) AS ServerName,
    CONVERT(nvarchar(256), SERVERPROPERTY('MachineName')) AS MachineName,
    CONVERT(nvarchar(128), SERVERPROPERTY('ProductVersion')) AS ProductVersion,
    CONVERT(nvarchar(128), SERVERPROPERTY('Edition')) AS Edition,
    @arcState AS ArcState;`;

/** Engine editions of SQL Server itself, rather than an Azure or Fabric service. */
const sqlServerEngineEditions: ReadonlySet<number> = new Set([1, 2, 3, 4, 9]);

/** Builds server facts from the result sets of {@link serverFactsQuery}. */
export function toServerFacts(
    resultSets: readonly SqlResultSet[],
    previous: DatabaseHubServerFacts,
    now: number = Date.now(),
): DatabaseHubServerFacts {
    const summary = resultSets[resultSets.length - 1];
    const value = (column: string): SqlValue | undefined =>
        summary?.rows[0]?.[summary.columns.indexOf(column)];
    const text = (column: string) => {
        const cell = value(column);
        return typeof cell === "string" && cell.trim() ? cell.trim() : undefined;
    };
    const engineEdition = Number(value("EngineEdition"));
    const arcState = text("ArcState");
    const arcRow = arcState === "read" ? resultSets[resultSets.length - 2] : undefined;

    let arc: DatabaseHubArcRegistration | undefined;
    switch (arcState) {
        case "read":
            arc = toArcRegistration(arcRow);
            break;
        case "missing":
            arc = { state: "notRegistered" };
            break;
        case "unknown":
            arc = { state: "unknown" };
            break;
    }
    return {
        ...previous,
        ...(Number.isFinite(engineEdition) ? { engineEdition } : {}),
        ...(text("ServerName") ? { logicalServerName: text("ServerName") } : {}),
        ...(text("MachineName") ? { machineName: text("MachineName") } : {}),
        ...(text("ProductVersion") ? { serverVersion: text("ProductVersion") } : {}),
        ...(text("Edition") ? { serverEdition: text("Edition") } : {}),
        ...(Number.isFinite(engineEdition)
            ? { isCloud: !sqlServerEngineEditions.has(engineEdition) }
            : {}),
        ...(arc ? { arc, arcCheckedAt: now } : {}),
    };
}

/**
 * Finds the instance's ARM ID in the Arc table row: a value shaped like a
 * `Microsoft.AzureArcData/sqlServerInstances` ID, or one built from subscription, resource group
 * and name columns. An empty table means the instance isn't registered.
 */
function toArcRegistration(row: SqlResultSet | undefined): DatabaseHubArcRegistration {
    const values = row?.rows[0];
    if (!row || !values) {
        return { state: "notRegistered" };
    }
    const strings = values.filter((cell): cell is string => typeof cell === "string");
    const typeOf = (cell: string) => parseArmResourceId(cell)?.resourceType;
    const onAzureVm = strings.some((cell) => typeOf(cell) === "microsoft.compute/virtualmachines");
    const resourceId = strings.find(
        (cell) => typeOf(cell) === "microsoft.azurearcdata/sqlserverinstances",
    );
    if (resourceId) {
        return { state: "registered", resourceId: resourceId.trim(), onAzureVm };
    }

    const column = (pattern: RegExp) => {
        const index = row.columns.findIndex((name) => pattern.test(name));
        const cell = index < 0 ? undefined : values[index];
        return typeof cell === "string" && cell.trim() ? cell.trim() : undefined;
    };
    const subscriptionId = column(/^subscription(_?id)?$/i);
    const resourceGroup = column(/^resource_?group(_?name)?$/i);
    const name = column(/^(resource_?)?name$/i);
    return subscriptionId && resourceGroup && name
        ? {
              state: "registered",
              resourceId: `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.AzureArcData/sqlServerInstances/${name}`,
              onAzureVm,
          }
        : { state: "unknown" };
}

/** The host to search the Hub for when a SQL Server's machine name isn't known. */
export function searchNameOf(
    connection: DatabaseHubConnection,
    facts: DatabaseHubServerFacts | undefined,
): string {
    return facts?.machineName ?? getServerHost(connection.server).split(".")[0];
}
