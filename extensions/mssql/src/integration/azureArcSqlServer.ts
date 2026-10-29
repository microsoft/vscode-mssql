/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import { IConnectionInfo, SimpleExecuteResult } from "vscode-mssql";

import ConnectionManager from "../controllers/connectionManager";
import { uuid } from "../utils/utils";

/** Prefix of the owner URI of every connection opened to check an Arc registration. */
const registrationCheckUriPrefix = "fabric-database-hub-arc-check-";

/** Whether a connection was opened only to check an instance's Azure Arc registration. */
export function isAzureArcRegistrationCheckUri(ownerUri: string): boolean {
    return ownerUri.startsWith(registrationCheckUriPrefix);
}

const simpleExecuteRequest = new RequestType<
    { ownerUri: string; queryString: string },
    SimpleExecuteResult,
    void
>("query/simpleexecute");

/**
 * Reads the table the Azure extension for SQL Server keeps in msdb on every Arc-enabled instance,
 * which records the instance's Azure resource ID.
 *
 * The table's columns aren't documented, so its rows are read whole as XML and searched for the
 * resource ID.  The read is dynamic so the batch still compiles where the table doesn't exist, and
 * failures are swallowed so they surface as an unknown registration instead of an error.
 */
const arcRegistrationQuery = `
DECLARE @arcProperties nvarchar(max);
DECLARE @arcPropertiesVisible int =
    CASE WHEN OBJECT_ID(N'msdb.dbo.SQLServerAzureArcProperties', N'U') IS NULL THEN 0 ELSE 1 END;
IF @arcPropertiesVisible = 1
BEGIN
    BEGIN TRY
        EXEC sys.sp_executesql
            N'SET @properties = (SELECT * FROM msdb.dbo.SQLServerAzureArcProperties FOR XML RAW);',
            N'@properties nvarchar(max) OUTPUT',
            @properties = @arcProperties OUTPUT;
    END TRY
    BEGIN CATCH
        SET @arcProperties = NULL;
    END CATCH
END;
SELECT
    CAST(SERVERPROPERTY('MachineName') AS nvarchar(128)) AS machineName,
    @arcPropertiesVisible AS arcPropertiesVisible,
    HAS_PERMS_BY_NAME(N'msdb', N'DATABASE', N'VIEW DEFINITION') AS canViewMsdbMetadata,
    @arcProperties AS arcProperties;`;

const arcSqlServerInstanceResourceIdPattern =
    /\/subscriptions\/([^/\s"<>]+)\/resourceGroups\/([^/\s"<>]+)\/providers\/Microsoft\.AzureArcData\/sqlServerInstances\/([^/\s"<>]+)/i;

/** The Azure resource an Arc-enabled SQL Server instance is registered as. */
export interface AzureArcSqlServerInstance {
    resourceId: string;
    subscriptionId: string;
    resourceGroupName: string;
    name: string;
}

/** Whether a SQL Server instance is connected to Azure Arc, as far as the login can tell. */
export type AzureArcRegistration =
    | { status: "registered"; instance: AzureArcSqlServerInstance }
    /** The login can see msdb's metadata and found no Arc table, so the instance isn't connected. */
    | { status: "notRegistered" }
    /** The login can't see or read the Arc table, so the instance may still be connected. */
    | { status: "unknown"; machineName: string | undefined };

/** Reads a SQL Server instance's Azure Arc registration from the result of the registration query. */
export function parseAzureArcRegistration(result: SimpleExecuteResult): AzureArcRegistration {
    const [machineName, arcPropertiesVisible, canViewMsdbMetadata, arcProperties] = (
        result?.rows?.[0] ?? []
    ).map((cell) => (cell && !cell.isNull ? cell.displayValue : undefined));

    const match = arcProperties?.match(arcSqlServerInstanceResourceIdPattern);
    if (match) {
        const [resourceId, subscriptionId, resourceGroupName, name] = match;
        return {
            status: "registered",
            instance: { resourceId, subscriptionId, resourceGroupName, name },
        };
    }
    if (arcPropertiesVisible === "0" && canViewMsdbMetadata === "1") {
        return { status: "notRegistered" };
    }
    return { status: "unknown", machineName: machineName?.trim() || undefined };
}

/**
 * Asks a SQL Server instance whether it's connected to Azure Arc, over a connection of its own.
 *
 * @param options.reportErrors whether the connection manager tells the user why a connection
 * failed; off for checks the user didn't ask for.
 * @returns undefined when the instance couldn't be connected to.
 */
export async function getAzureArcRegistration(
    connectionManager: ConnectionManager,
    connection: IConnectionInfo,
    { reportErrors = true }: { reportErrors?: boolean } = {},
): Promise<AzureArcRegistration | undefined> {
    const ownerUri = `${registrationCheckUriPrefix}${uuid()}`;
    const connected = await connectionManager.connect(
        ownerUri,
        { ...connection },
        { connectionSource: "fabricDatabaseHub", shouldHandleErrors: reportErrors },
    );
    if (!connected) {
        return undefined;
    }

    try {
        const result = await connectionManager.client.sendRequest(simpleExecuteRequest, {
            ownerUri,
            queryString: arcRegistrationQuery,
        });
        return parseAzureArcRegistration(result);
    } finally {
        await connectionManager.disconnect(ownerUri);
    }
}
