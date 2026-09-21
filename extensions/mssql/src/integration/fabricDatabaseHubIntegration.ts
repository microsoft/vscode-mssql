/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { sendActionEvent, sendErrorEvent } from "extension-toolkit/vscode";

import * as Constants from "../constants/constants";
import { extractFromResourceId } from "../connectionconfig/azureHelpers";
import {
    FabricDatabaseHubDatabaseType,
    getFabricDatabaseHubLink,
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
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

/** ARM provider namespace for Azure SQL servers and databases. */
const azureSqlProviderNamespace = "microsoft.sql";

enum DatabaseHubTelemetrySource {
    AzureResources = "azureResources",
    FabricWorkspace = "fabricWorkspace",
    Unknown = "unknown",
}

enum DatabaseHubTelemetryResult {
    Succeeded = "succeeded",
    Failed = "failed",
    LinkUnavailable = "linkUnavailable",
}

/** Azure Resources nodes can carry percent-encoded resource IDs; the Hub expects decoded ones. */
function decodeResourceId(resourceId: string): string {
    try {
        return decodeURIComponent(resourceId);
    } catch {
        return resourceId;
    }
}

/**
 * Contributes the Database Hub action to the Azure Resources tree and the Fabric extension's
 * workspace tree.
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
        const telemetryProperties = this.getTelemetryProperties(node);
        try {
            const link = await this.getLinkForNode(node);
            if (!link) {
                this._logger.debug(
                    "No Fabric Database Hub link could be built for the selected node.",
                );
                sendActionEvent(TelemetryViews.FabricDatabaseHub, TelemetryActions.Open, {
                    additionalProps: {
                        ...telemetryProperties,
                        result: DatabaseHubTelemetryResult.LinkUnavailable,
                    },
                });
                return;
            }

            const opened = await vscode.env.openExternal(vscode.Uri.parse(link, true));
            sendActionEvent(TelemetryViews.FabricDatabaseHub, TelemetryActions.Open, {
                additionalProps: {
                    ...telemetryProperties,
                    result: opened
                        ? DatabaseHubTelemetryResult.Succeeded
                        : DatabaseHubTelemetryResult.Failed,
                },
            });
        } catch (error) {
            sendErrorEvent(TelemetryViews.FabricDatabaseHub, TelemetryActions.Open, {
                error,
                additionalProps: telemetryProperties,
            });
            throw error;
        }
    }

    /** Returns only low-cardinality, non-identifying properties for command telemetry. */
    private getTelemetryProperties(node: unknown): Record<string, string> {
        if (isAzureResourceNode(node)) {
            return {
                source: DatabaseHubTelemetrySource.AzureResources,
                databaseType: FabricDatabaseHubDatabaseType.AzureSql,
            };
        }
        if (isFabricWorkspaceItemNode(node)) {
            return {
                source: DatabaseHubTelemetrySource.FabricWorkspace,
                databaseType: isFabricSqlDatabaseNode(node)
                    ? FabricDatabaseHubDatabaseType.FabricSql
                    : DatabaseHubTelemetrySource.Unknown,
            };
        }
        return {
            source: DatabaseHubTelemetrySource.Unknown,
            databaseType: DatabaseHubTelemetrySource.Unknown,
        };
    }

    private async getLinkForNode(node: unknown): Promise<string | undefined> {
        if (isAzureResourceNode(node)) {
            return this.getAzureResourceLink(node.resource.id);
        }
        if (isFabricWorkspaceItemNode(node)) {
            return this.getFabricWorkspaceItemLink(node);
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
