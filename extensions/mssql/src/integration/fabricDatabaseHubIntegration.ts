/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import * as Constants from "../constants/constants";
import * as ConnInfo from "../models/connectionInfo";
import { ServerType } from "../models/connectionInfo";
import { extractFromResourceId, VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import {
    FabricDatabaseHubDatabaseType,
    getFabricDatabaseHubLink,
    getFabricEnvironment,
    getFabricSqlDatabaseDisplayName,
} from "../fabric/fabricDatabaseHub";
import {
    FabricWorkspaceItemNode,
    getFabricWorkspaceItemEnvironment,
    isFabricSqlDatabaseNode,
    isFabricWorkspaceItemNode,
} from "./fabricIntegration";
import { getLogger } from "../models/logger";
import { ILogger } from "../sharedInterfaces/logger";
import { isAzureResourceNode } from "./azureResourcesIntegration";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";

/** ARM provider namespace for Azure SQL servers and databases. */
const azureSqlProviderNamespace = "microsoft.sql";

/** Object Explorer node types that represent a server or a database. */
const serverAndDatabaseNodeTypes: string[] = [
    Constants.serverLabel,
    Constants.disconnectedServerNodeType,
    Constants.databaseString,
];

/** Azure Resources nodes can carry percent-encoded resource IDs; the Hub expects decoded ones. */
function decodeResourceId(resourceId: string): string {
    try {
        return decodeURIComponent(resourceId);
    } catch {
        return resourceId;
    }
}

/**
 * Contributes the "View in Fabric Database Hub" action to the Azure Resources tree, the Fabric
 * extension's workspace tree, and Object Explorer.
 */
export class FabricDatabaseHubIntegration {
    private _logger: ILogger;

    constructor() {
        this._logger = getLogger("Fabric Database Hub");
    }

    public registerOpenInFabricDatabaseHubCommand(): vscode.Disposable {
        return vscode.commands.registerCommand(
            Constants.cmdOpenInFabricDatabaseHub,
            (node: unknown) => this.openInFabricDatabaseHub(node),
        );
    }

    /** Opens the Database Hub for the given tree node; nodes with no Hub database are ignored. */
    private async openInFabricDatabaseHub(node: unknown): Promise<void> {
        const link = await this.getLinkForNode(node);
        if (!link) {
            this._logger.debug("No Fabric Database Hub link could be built for the selected node.");
            return;
        }

        await vscode.env.openExternal(vscode.Uri.parse(link, true));
    }

    private async getLinkForNode(node: unknown): Promise<string | undefined> {
        if (isAzureResourceNode(node)) {
            return this.getAzureResourceLink(node.resource.id);
        }
        if (isFabricWorkspaceItemNode(node)) {
            return this.getFabricWorkspaceItemLink(node);
        }
        if (node instanceof TreeNodeInfo) {
            return this.getObjectExplorerLink(node);
        }
        return undefined;
    }

    /** Builds a link for a node from the Azure Resources tree. */
    private getAzureResourceLink(azureResourceId: string): string | undefined {
        const resourceId = decodeResourceId(azureResourceId);
        const provider = extractFromResourceId(resourceId, "providers");
        const serverName = extractFromResourceId(resourceId, "servers");
        if (provider?.toLowerCase() !== azureSqlProviderNamespace || !serverName) {
            return undefined;
        }

        const databaseName = extractFromResourceId(resourceId, "databases");
        return databaseName
            ? this.getAzureSqlDatabaseLink(resourceId, databaseName)
            : getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.AzureSql);
    }

    /** Builds a link for a SQL database node from the Fabric extension's workspace tree. */
    private getFabricWorkspaceItemLink(node: FabricWorkspaceItemNode): string | undefined {
        if (!isFabricSqlDatabaseNode(node)) {
            return undefined;
        }

        return getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.FabricSql, {
            environment: getFabricWorkspaceItemEnvironment(node),
            databaseName: getFabricSqlDatabaseDisplayName(node.artifact.displayName),
        });
    }

    /** Builds a link for a server or database node from Object Explorer. */
    private async getObjectExplorerLink(node: TreeNodeInfo): Promise<string | undefined> {
        const profile = node.connectionProfile;
        if (!profile || !serverAndDatabaseNodeTypes.includes(node.nodeType)) {
            return undefined;
        }

        const serverTypes = ConnInfo.getServerTypes(profile);
        if (!serverTypes.includes(ServerType.Sql)) {
            return undefined;
        }

        const server = ConnInfo.getServerName(profile);
        const database =
            node.nodeType === Constants.databaseString
                ? ObjectExplorerUtils.getDatabaseName(node)
                : ConnInfo.getDatabaseName(profile);

        if (serverTypes.includes(ServerType.Fabric)) {
            return getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.FabricSql, {
                environment: getFabricEnvironment(server),
                databaseName: getFabricSqlDatabaseDisplayName(database),
            });
        }

        if (!serverTypes.includes(ServerType.Azure)) {
            return undefined;
        }

        const resourceId = await this.findAzureSqlDatabaseResourceId(
            VsCodeAzureHelper.getAzureSqlServerName(server),
            database,
            profile.accountId,
        );

        // Without the ARM resource ID the Hub cannot be deep-linked, so fall back to the estate view.
        return resourceId
            ? this.getAzureSqlDatabaseLink(resourceId, database)
            : getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.AzureSql);
    }

    /** Resolves the ARM resource ID of an Azure SQL database through the connection's account. */
    private async findAzureSqlDatabaseResourceId(
        serverName: string | undefined,
        database: string | undefined,
        accountId: string | undefined,
    ): Promise<string | undefined> {
        if (!serverName || !database || !accountId) {
            return undefined;
        }

        const resource = await VsCodeAzureHelper.findSqlResource(accountId, serverName);
        if (resource === "UnableToCheck") {
            this._logger.debug(
                `Could not locate the Azure SQL server "${serverName}" for the signed-in account.`,
            );
            return undefined;
        }

        return `/subscriptions/${resource.subscriptionId}/resourceGroups/${resource.resourceGroup}/providers/Microsoft.Sql/servers/${serverName}/databases/${database}`;
    }

    private getAzureSqlDatabaseLink(
        resourceId: string,
        databaseName: string | undefined,
    ): string | undefined {
        return getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.AzureSql, {
            databaseName,
            databaseResourceId: resourceId,
        });
    }
}
