/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConnectionInfo, IServerInfo } from "vscode-mssql";
import {
    HeadlessQueryExecutor,
    HeadlessQueryResult,
} from "../queryExecution/headlessQueryExecutor";
import { BridgeErrorCode, BridgePlatformContext, BridgeRequestError } from "./contracts";

const contextKeys = {
    databaseName: "DatabaseName",
    compatibilityLevel: "CompatibilityLevel",
    machineName: "MachineName",
    serverName: "ServerName",
    instanceName: "InstanceName",
    isClustered: "IsClustered",
    edition: "Edition",
    engineEdition: "EngineEdition",
    productVersion: "ProductVersion",
    productLevel: "ProductLevel",
    isIntegratedSecurityOnly: "IsIntegratedSecurityOnly",
    isHadrEnabled: "IsHadrEnabled",
    version: "Version",
    productUpdateType: "ProductUpdateType",
    isQueryStoreEnabled: "IsQueryStoreEnabled",
};

export class PlatformContextDetector {
    constructor(private readonly executor: HeadlessQueryExecutor) {}

    async detect(
        ownerUri: string,
        connectionInfo: IConnectionInfo | undefined,
        serverInfo: IServerInfo | undefined,
    ): Promise<BridgePlatformContext> {
        const result = await this.executor.execute(ownerUri, buildPlatformDetectionQuery());
        if (
            result.canceled ||
            result.batches.some((batch) => batch.hasError) ||
            result.batches.some((batch) => batch.messages.some((message) => message.isError))
        ) {
            throw new BridgeRequestError(
                BridgeErrorCode.ExecutionFailed,
                "Platform detection query failed.",
                true,
            );
        }

        return toPlatformContext(result, connectionInfo, serverInfo);
    }
}

export function toFallbackPlatformContext(
    connectionInfo: IConnectionInfo | undefined,
    serverInfo: IServerInfo | undefined,
): BridgePlatformContext {
    const databaseName = connectionInfo?.database;
    const serverName = connectionInfo?.server;
    const engineEdition = serverInfo?.serverEdition;
    const version = serverInfo?.serverVersion;
    const contextSettings: Record<string, string> = {};

    addSetting(contextSettings, contextKeys.databaseName, databaseName);
    addSetting(contextSettings, contextKeys.serverName, serverName);
    addSetting(contextSettings, contextKeys.edition, serverInfo?.serverEdition);
    addSetting(contextSettings, contextKeys.engineEdition, engineEdition);
    addSetting(contextSettings, contextKeys.productVersion, serverInfo?.serverVersion);
    addSetting(contextSettings, contextKeys.version, version);

    return {
        databaseName,
        serverName,
        engineEdition,
        version,
        contextSettings,
    };
}

function toPlatformContext(
    result: HeadlessQueryResult,
    connectionInfo: IConnectionInfo | undefined,
    serverInfo: IServerInfo | undefined,
): BridgePlatformContext {
    const contextSettings: Record<string, string> = {};

    for (const batch of result.batches) {
        for (const resultSet of batch.resultSets) {
            for (const row of resultSet.rows) {
                for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
                    const columnName = resultSet.columnInfo[columnIndex]?.columnName;
                    if (!columnName) {
                        continue;
                    }
                    const cell = row[columnIndex];
                    contextSettings[columnName] = cell?.isNull ? "" : (cell?.displayValue ?? "");
                }
            }
        }
    }

    return {
        databaseName: contextSettings[contextKeys.databaseName] || connectionInfo?.database,
        serverName: contextSettings[contextKeys.serverName] || connectionInfo?.server,
        engineEdition:
            contextSettings[contextKeys.engineEdition] || serverInfo?.serverEdition?.toString(),
        version:
            contextSettings[contextKeys.version] ||
            contextSettings[contextKeys.productVersion] ||
            serverInfo?.serverVersion,
        contextSettings,
    };
}

function addSetting(settings: Record<string, string>, key: string, value: unknown): void {
    if (value !== undefined && value !== null && value !== "") {
        settings[key] = String(value);
    }
}

function buildPlatformDetectionQuery(): string {
    return `
DECLARE @IsFabricSQLDW bit;
SET @IsFabricSQLDW = CASE
    WHEN CONVERT(int, SERVERPROPERTY('EngineEdition')) = 11 THEN 1
    ELSE 0
END;

DECLARE @SupportsQueryStore bit = CASE
    WHEN OBJECT_ID('sys.database_query_store_options') IS NOT NULL THEN 1
    ELSE 0
END;

DECLARE @sql nvarchar(max) = N'
DECLARE @ProductVersion nvarchar(128) = CONVERT(nvarchar(128), SERVERPROPERTY(''ProductVersion''));
DECLARE @ProductMajorVersion int = CAST(SUBSTRING(@ProductVersion, 1, 2) AS int);
DECLARE @EngineEdition int = CONVERT(int, SERVERPROPERTY(''EngineEdition''));

SELECT
    db.name AS ${contextKeys.databaseName},
    CASE
        WHEN db.compatibility_level > 170 THEN 170
        ELSE db.compatibility_level
    END AS ${contextKeys.compatibilityLevel},
    SERVERPROPERTY(''MachineName'') AS ${contextKeys.machineName},
    SERVERPROPERTY(''ServerName'') AS ${contextKeys.serverName},
    SERVERPROPERTY(''InstanceName'') AS ${contextKeys.instanceName},
    CASE SERVERPROPERTY(''IsClustered'')
        WHEN 1 THEN ''Yes''
        WHEN 0 THEN ''No''
        ELSE ''Unknown''
    END AS ${contextKeys.isClustered},
    SERVERPROPERTY(''Edition'') AS ${contextKeys.edition},
    CASE
        WHEN @EngineEdition = 2 THEN ''SQL Server Standard''
        WHEN @EngineEdition = 3 THEN ''SQL Server Enterprise''
        WHEN @EngineEdition = 4 THEN ''SQL Server Express''
        WHEN @EngineEdition = 5 THEN ''Azure SQL DB''
        WHEN @EngineEdition = 6 THEN ''SQL DW''
        WHEN @EngineEdition = 8 THEN ''Azure SQL Managed Instance''
        WHEN @EngineEdition = 11 THEN ''Fabric SQL DW''
        WHEN @EngineEdition = 12 THEN ''Fabric SQL DB''
        ELSE ''Unknown''
    END AS ${contextKeys.engineEdition},
    SERVERPROPERTY(''ProductVersion'') AS ${contextKeys.productVersion},
    SERVERPROPERTY(''ProductLevel'') AS ${contextKeys.productLevel},
    CASE SERVERPROPERTY(''IsIntegratedSecurityOnly'')
        WHEN 1 THEN ''Yes''
        WHEN 0 THEN ''No''
        ELSE ''Unknown''
    END AS ${contextKeys.isIntegratedSecurityOnly},
    CASE SERVERPROPERTY(''IsHadrEnabled'')
        WHEN 1 THEN ''Enabled''
        WHEN 0 THEN ''Disabled''
        ELSE ''Unknown''
    END AS ${contextKeys.isHadrEnabled},
    SERVERPROPERTY(''HadrManagerStatus'') AS HadrManagerStatus,
    CASE
        WHEN @EngineEdition IN (2, 3, 4) AND @ProductMajorVersion = 9 THEN ''SQL2005''
        WHEN @EngineEdition IN (2, 3, 4) AND @ProductMajorVersion = 10 THEN ''SQL2008''
        WHEN @EngineEdition IN (2, 3, 4) AND @ProductMajorVersion = 11 THEN ''SQL2012''
        WHEN @EngineEdition IN (2, 3, 4) AND @ProductMajorVersion = 12 THEN ''SQL2014''
        WHEN @EngineEdition IN (2, 3, 4) AND @ProductMajorVersion = 13 THEN ''SQL2016''
        WHEN @EngineEdition IN (2, 3, 4) AND @ProductMajorVersion = 14 THEN ''SQL2017''
        WHEN @EngineEdition IN (2, 3, 4) AND @ProductMajorVersion = 15 THEN ''SQL2019''
        WHEN @EngineEdition IN (2, 3, 4) AND @ProductMajorVersion = 16 THEN ''SQL2022''
        WHEN @EngineEdition IN (2, 3, 4) AND @ProductMajorVersion >= 17 THEN ''SQL2025''
        WHEN @EngineEdition = 5 THEN ''SQLDB''
        WHEN @EngineEdition = 6 THEN ''SQLDW''
        WHEN @EngineEdition = 8 THEN ''SQLMI''
';

IF @IsFabricSQLDW = 1
BEGIN
    SET @sql += N'
        WHEN @EngineEdition = 11 THEN
            CASE db.data_lake_log_publishing_desc
                WHEN ''AUTO'' THEN ''FabricSQLDW''
                WHEN ''UNSUPPORTED'' THEN ''FabricAnalyticsEndpoint''
                ELSE ''Unknown''
            END
    ';
END;

SET @sql += N'
        WHEN @EngineEdition = 12 THEN ''FabricSQLDB''
        ELSE ''Unknown''
    END AS ${contextKeys.version},
    CASE UPPER(CAST(SERVERPROPERTY(''ProductUpdateType'') AS nvarchar(20)))
        WHEN ''CU'' THEN ''VersionedMI''
        WHEN ''CONTINUOUS'' THEN ''VersionlessMI''
        ELSE ''Unknown''
    END AS ${contextKeys.productUpdateType},
';

IF @SupportsQueryStore = 1
BEGIN
    SET @sql += N'
    CASE
        WHEN qso.actual_state_desc = ''READ_WRITE'' OR qso.actual_state_desc = ''READ_ONLY'' THEN ''Enabled''
        ELSE ''Disabled''
    END AS ${contextKeys.isQueryStoreEnabled}
FROM sys.databases AS db
LEFT JOIN sys.database_query_store_options AS qso ON db.name = DB_NAME()
WHERE db.name = DB_NAME();
';
END;
ELSE
BEGIN
    SET @sql += N'
    ''Unknown'' AS ${contextKeys.isQueryStoreEnabled}
FROM sys.databases AS db
WHERE db.name = DB_NAME();
';
END;

EXEC sp_executesql @sql;
`;
}
