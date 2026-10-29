/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { azureMfa } from "../constants/constants";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import { IConnectionProfile } from "../models/interfaces";
import { withTimeout } from "../models/utils";

/** How a search for an Azure SQL database's resource ID ended. */
export enum AzureSqlDatabaseLookupResult {
    Found = "found",
    /** No signed-in account can see the database's server. */
    NotFound = "notFound",
    /** No Azure account is signed in to VS Code. */
    NoAccount = "noAccount",
    TimedOut = "timedOut",
}

export interface AzureSqlDatabaseLookup {
    result: AzureSqlDatabaseLookupResult;
    /** Set when the database was found. */
    resourceId?: string;
}

/**
 * Finds the Azure resource ID of a database on an Azure SQL logical server, using the Azure
 * accounts already signed in to VS Code: the connection's own account first, then the rest.
 *
 * Nothing prompts the user to sign in.  The search reuses the per-session server lookup the
 * firewall flow uses, so one that times out keeps running in the background and a later search
 * for the same server finds it cached.
 */
export async function findAzureSqlDatabaseResourceId(
    connection: IConnectionProfile,
    databaseName: string,
    timeoutMs: number,
): Promise<AzureSqlDatabaseLookup> {
    const serverName = VsCodeAzureHelper.getAzureSqlServerName(
        connection.server?.replace(/^tcp:/i, ""),
    );
    if (!serverName) {
        return { result: AzureSqlDatabaseLookupResult.NotFound };
    }

    const search = async (): Promise<AzureSqlDatabaseLookup> => {
        const accountIds = new Set<string>();
        if (connection.authenticationType === azureMfa && connection.accountId) {
            accountIds.add(connection.accountId);
        }
        for (const account of await VsCodeAzureHelper.getAccounts()) {
            accountIds.add(account.id);
        }
        if (accountIds.size === 0) {
            return { result: AzureSqlDatabaseLookupResult.NoAccount };
        }

        for (const accountId of accountIds) {
            const server = await VsCodeAzureHelper.findSqlResource(accountId, serverName);
            if (server !== "UnableToCheck") {
                return {
                    result: AzureSqlDatabaseLookupResult.Found,
                    resourceId: `/subscriptions/${server.subscriptionId}/resourceGroups/${server.resourceGroup}/providers/Microsoft.Sql/servers/${serverName}/databases/${databaseName}`,
                };
            }
        }
        return { result: AzureSqlDatabaseLookupResult.NotFound };
    };

    try {
        return await withTimeout(search(), timeoutMs, "Timed out finding the database in Azure.");
    } catch {
        return { result: AzureSqlDatabaseLookupResult.TimedOut };
    }
}
