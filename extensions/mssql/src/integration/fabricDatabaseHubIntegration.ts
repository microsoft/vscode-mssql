/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { sendActionEvent, sendErrorEvent } from "extension-toolkit/vscode";
import { isWrapper, Wrapper } from "@microsoft/vscode-azureresources-api";
import { IConnectionInfo } from "vscode-mssql";

import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import {
    FabricDatabaseHubDatabaseType,
    getFabricDatabaseHubLink,
    getFabricEnvironment,
    getFabricSqlDatabaseDisplayName,
    isSystemDatabaseName,
} from "../fabric/fabricDatabaseHub";
import {
    FabricWorkspaceItemNode,
    getFabricWorkspaceItemEnvironment,
    isFabricSqlDatabaseNode,
    isFabricWorkspaceItemNode,
} from "./fabricIntegration";
import { getLogger } from "../models/logger";
import { ILogger } from "../sharedInterfaces/logger";
import {
    AzureResourceTypeGroupNode,
    getAzureResource,
    isAzureResourceTypeGroupNode,
} from "./azureResourcesIntegration";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { getServerTypes, ServerType } from "../models/connectionInfo";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";

/** ARM provider namespace for Azure SQL servers and databases. */
const azureSqlProviderNamespace = "microsoft.sql";

enum DatabaseHubTelemetrySource {
    AzureResources = "azureResources",
    FabricWorkspace = "fabricWorkspace",
    ObjectExplorer = "objectExplorer",
    PerformanceDashboard = "performanceDashboard",
    Unknown = "unknown",
}

enum DatabaseHubTelemetryResult {
    Succeeded = "succeeded",
    Failed = "failed",
    LinkUnavailable = "linkUnavailable",
    SystemDatabase = "systemDatabase",
}

const unknownDatabaseType = "unknown";

type DatabaseHubTreeNode =
    | Wrapper
    | AzureResourceTypeGroupNode
    | FabricWorkspaceItemNode
    | TreeNodeInfo;

/** The parts of an Azure SQL resource ID the estate view can be filtered by. */
interface AzureSqlResourceIdParts {
    subscriptionId: string;
    resourceGroupName: string;
    /** Undefined for a logical server, which the Hub's estate inventory has no row for. */
    databaseName: string | undefined;
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
 * Parses an Azure SQL resource ID into the pieces the estate view filters on.
 *
 * Segment names are matched case-insensitively, the way ARM treats them, so a resource ID that
 * spells `resourcegroups` still yields a resource group rather than silently dropping that filter.
 *
 * @returns undefined when the ID does not name an Azure SQL server or one of its databases.
 */
function parseAzureSqlResourceId(resourceId: string): AzureSqlResourceIdParts | undefined {
    const segments = decodeResourceId(resourceId).split("/").filter(Boolean);
    const [subscriptions, subscriptionId, resourceGroups, resourceGroupName, providers, provider] =
        segments;

    if (
        subscriptions?.toLowerCase() !== "subscriptions" ||
        resourceGroups?.toLowerCase() !== "resourcegroups" ||
        providers?.toLowerCase() !== "providers" ||
        provider?.toLowerCase() !== azureSqlProviderNamespace ||
        segments[6]?.toLowerCase() !== "servers" ||
        !segments[7]
    ) {
        return undefined;
    }

    const databaseName = segments[8]?.toLowerCase() === "databases" ? segments[9] : undefined;
    return { subscriptionId, resourceGroupName, databaseName };
}

/**
 * Returns the kind of database the Database Hub tracks on a server, by its endpoint.
 *
 * @returns undefined for servers the Hub has no inventory for, such as on-premises SQL Server or
 * a data warehouse.
 */
export function getFabricDatabaseHubDatabaseType(
    server: string | undefined,
): FabricDatabaseHubDatabaseType | undefined {
    const serverTypes = getServerTypes({ server } as IConnectionInfo);
    if (!serverTypes.includes(ServerType.Sql)) {
        return undefined;
    }
    if (serverTypes.includes(ServerType.Azure)) {
        return FabricDatabaseHubDatabaseType.AzureSql;
    }
    if (serverTypes.includes(ServerType.Fabric)) {
        return FabricDatabaseHubDatabaseType.FabricSql;
    }
    return undefined;
}

/**
 * Builds a link for a connection's database, or for its server's kind of database when the
 * connection names no database.
 *
 * A connection carries no subscription or resource group, so an Azure SQL database is narrowed by
 * name alone; same-named databases on other servers share the view.
 *
 * @returns undefined for servers the Hub has no inventory for, and for Fabric rings it can't link to.
 */
export function getFabricDatabaseHubLinkForConnection(
    server: string | undefined,
    database: string | undefined,
): string | undefined {
    const databaseType = getFabricDatabaseHubDatabaseType(server);
    if (databaseType === FabricDatabaseHubDatabaseType.AzureSql) {
        return getFabricDatabaseHubLink(databaseType, { databaseName: database });
    }
    if (databaseType === FabricDatabaseHubDatabaseType.FabricSql) {
        // An unknown pre-production ring has no portal, and production would not list its database.
        const environment = getFabricEnvironment(server);
        if (!environment) {
            return undefined;
        }
        return getFabricDatabaseHubLink(databaseType, {
            environment,
            databaseName: getFabricSqlDatabaseDisplayName(database),
        });
    }
    return undefined;
}

/**
 * Opens the Database Hub for the database a performance dashboard shows.
 *
 * @returns whether the link opened; false when the dashboard's server has no Hub link.
 */
export async function openFabricDatabaseHubForDashboard(
    server: string,
    database: string,
): Promise<boolean> {
    const additionalProps = {
        source: DatabaseHubTelemetrySource.PerformanceDashboard,
        databaseType: getFabricDatabaseHubDatabaseType(server) ?? unknownDatabaseType,
    };
    const link = getFabricDatabaseHubLinkForConnection(server, database);
    if (!link) {
        sendActionEvent(TelemetryViews.FabricDatabaseHub, TelemetryActions.Open, {
            additionalProps: {
                ...additionalProps,
                result: DatabaseHubTelemetryResult.LinkUnavailable,
            },
        });
        return false;
    }
    const opened = await vscode.env.openExternal(vscode.Uri.parse(link, true));
    sendActionEvent(TelemetryViews.FabricDatabaseHub, TelemetryActions.Open, {
        additionalProps: {
            ...additionalProps,
            result: opened
                ? DatabaseHubTelemetryResult.Succeeded
                : DatabaseHubTelemetryResult.Failed,
        },
    });
    return opened;
}

/**
 * Returns the database an Object Explorer node stands for, or undefined for a server node whose
 * connection names no database.
 */
function getObjectExplorerDatabaseName(node: TreeNodeInfo): string | undefined {
    const databaseName = ObjectExplorerUtils.getDatabaseName(node);
    return databaseName && databaseName !== LocalizedConstants.defaultDatabaseLabel
        ? databaseName
        : undefined;
}

/**
 * Contributes the Database Hub action to the Azure Resources tree, the Fabric extension's
 * workspace tree, and Object Explorer.
 */
export class FabricDatabaseHubIntegration {
    private _logger: ILogger;

    constructor() {
        this._logger = getLogger("Fabric Database Hub");
    }

    public registerOpenInFabricDatabaseHubCommand(): vscode.Disposable {
        return vscode.commands.registerCommand(
            Constants.cmdOpenInFabricDatabaseHub,
            (node: DatabaseHubTreeNode | undefined) => this.openInFabricDatabaseHub(node),
        );
    }

    /** Opens the Database Hub for the given tree node; nodes with no Hub database are ignored. */
    private async openInFabricDatabaseHub(node: DatabaseHubTreeNode | undefined): Promise<void> {
        const telemetryProperties = this.getTelemetryProperties(node);
        try {
            if (this.warnIfSystemDatabase(node)) {
                sendActionEvent(TelemetryViews.FabricDatabaseHub, TelemetryActions.Open, {
                    additionalProps: {
                        ...telemetryProperties,
                        result: DatabaseHubTelemetryResult.SystemDatabase,
                    },
                });
                return;
            }

            const link = this.getLinkForNode(node);
            if (!link) {
                this._logger.debug(
                    "No Fabric Database Hub link could be built for the selected node.",
                );
                // Object Explorer offers the action on every server, so explain why nothing opens.
                if (node instanceof TreeNodeInfo) {
                    void vscode.window.showInformationMessage(
                        LocalizedConstants.Azure.serverNotInFabricDatabaseHub(
                            node.connectionProfile?.server ?? node.label?.toString() ?? "",
                        ),
                    );
                }
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

    /**
     * Tells the user that a system database has no place in the Database Hub, rather than sending
     * them to an estate view that can never list it.
     *
     * @returns whether the node named a system database, in which case no link is opened.
     */
    private warnIfSystemDatabase(node: DatabaseHubTreeNode | undefined): boolean {
        let databaseName: string | undefined;
        if (isWrapper(node)) {
            databaseName = parseAzureSqlResourceId(getAzureResource(node).id)?.databaseName;
        } else if (node instanceof TreeNodeInfo) {
            databaseName = getObjectExplorerDatabaseName(node);
        }
        if (!databaseName || !isSystemDatabaseName(databaseName)) {
            return false;
        }

        void vscode.window.showInformationMessage(
            LocalizedConstants.Azure.systemDatabaseNotInFabricDatabaseHub(databaseName),
        );
        return true;
    }

    /** Returns only low-cardinality, non-identifying properties for command telemetry. */
    private getTelemetryProperties(node: DatabaseHubTreeNode | undefined): Record<string, string> {
        if (isWrapper(node) || isAzureResourceTypeGroupNode(node)) {
            return {
                source: DatabaseHubTelemetrySource.AzureResources,
                databaseType: FabricDatabaseHubDatabaseType.AzureSql,
            };
        }
        if (node instanceof TreeNodeInfo) {
            return {
                source: DatabaseHubTelemetrySource.ObjectExplorer,
                databaseType:
                    getFabricDatabaseHubDatabaseType(node.connectionProfile?.server) ??
                    unknownDatabaseType,
            };
        }
        if (isFabricWorkspaceItemNode(node)) {
            return {
                source: DatabaseHubTelemetrySource.FabricWorkspace,
                databaseType: isFabricSqlDatabaseNode(node)
                    ? FabricDatabaseHubDatabaseType.FabricSql
                    : unknownDatabaseType,
            };
        }
        return {
            source: DatabaseHubTelemetrySource.Unknown,
            databaseType: unknownDatabaseType,
        };
    }

    private getLinkForNode(node: DatabaseHubTreeNode | undefined): string | undefined {
        if (isWrapper(node)) {
            return this.getAzureDatabaseLink(getAzureResource(node).id);
        }

        if (isAzureResourceTypeGroupNode(node)) {
            return this.getAzureSubscriptionLink(node);
        }

        if (isFabricWorkspaceItemNode(node)) {
            return this.getFabricWorkspaceItemLink(node);
        }

        if (node instanceof TreeNodeInfo) {
            return getFabricDatabaseHubLinkForConnection(
                node.connectionProfile?.server,
                getObjectExplorerDatabaseName(node),
            );
        }

        return undefined;
    }

    /**
     * Builds a link for an Azure SQL database node, narrowing the estate grid to that database.
     *
     * The estate view has no server filter, so a database is pinned down by subscription, resource
     * group and name.  Same-named databases on sibling servers in one resource group still share
     * the view; the Hub has no exact-name filter to separate them.
     *
     * @returns undefined for a logical server, which the estate inventory has no row for.
     */
    private getAzureDatabaseLink(azureResourceId: string): string | undefined {
        const resourceIdParts = parseAzureSqlResourceId(azureResourceId);
        if (!resourceIdParts?.databaseName) {
            return undefined;
        }

        return getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.AzureSql, {
            databaseName: resourceIdParts.databaseName,
            subscriptionId: resourceIdParts.subscriptionId,
            resourceGroupName: resourceIdParts.resourceGroupName,
        });
    }

    /**
     * Builds a link for the "SQL databases" folder, which groups a single subscription's databases.
     *
     * Only the subscription is filtered on, since the folder spans every resource group under it.
     */
    private getAzureSubscriptionLink(node: AzureResourceTypeGroupNode): string | undefined {
        return getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.AzureSql, {
            subscriptionId: node.subscription?.subscriptionId,
        });
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
}
