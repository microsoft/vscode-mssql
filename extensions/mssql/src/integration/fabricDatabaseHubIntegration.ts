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
    getAzureSqlManagedInstanceName,
    getFabricDatabaseHubLink,
    getFabricEnvironment,
    getFabricSqlDatabaseDisplayName,
    getFabricSqlDatabaseItemId,
    hasFabricPortal,
    isSystemDatabaseName,
} from "../fabric/fabricDatabaseHub";
import ConnectionManager, { ConnectionSuccessfulEvent } from "../controllers/connectionManager";
import {
    AzureArcRegistration,
    AzureArcSqlServerInstance,
    getAzureArcRegistration,
    isAzureArcRegistrationCheckUri,
} from "./azureArcSqlServer";
import { AzureArcPrompt, AzureArcPromptTracker } from "./azureArcPromptTracker";
import { findAzureSqlDatabaseResourceId } from "./azureSqlDatabaseResource";
import { IConnectionProfile } from "../models/interfaces";
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
import { getCloudProviderSettings } from "../azure/providerSettings";
import { getServerTypes, ServerType } from "../models/connectionInfo";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";

/** ARM provider namespace for Azure SQL servers and databases. */
const azureSqlProviderNamespace = "microsoft.sql";

enum DatabaseHubTelemetrySource {
    AzureResources = "azureResources",
    FabricWorkspace = "fabricWorkspace",
    ObjectExplorer = "objectExplorer",
    /** The notification that a prompted server is now connected to Azure Arc. */
    ArcEnabledNotification = "arcEnabledNotification",
    Unknown = "unknown",
}

/** How a link picks out an Object Explorer Azure SQL database. */
enum DatabaseHubTelemetryLinkKind {
    /** Opens the database's details dialog by its resource ID. */
    DeepLink = "deepLink",
    /** Searches the estate grid for the database's name. */
    Search = "search",
}

/**
 * How long to look for an Object Explorer Azure SQL database's resource ID before searching the
 * Hub by name instead.
 */
const azureSqlDatabaseLookupTimeoutInMilliseconds = 10_000;

/** How a prompted server was found connected to Azure Arc. */
enum DatabaseHubTelemetryArcDetection {
    /** The user ran the action on the server again. */
    Action = "action",
    /** The server was checked in the background when the user connected to it again. */
    Connection = "connection",
}

/** The kind of tree node the action was run on. */
enum DatabaseHubTelemetryNodeKind {
    Database = "database",
    /** The Azure Resources "SQL databases" folder. */
    DatabaseGroup = "databaseGroup",
    /** An Object Explorer connection, scoped to a database or not. */
    Connection = "connection",
    Other = "other",
}

enum DatabaseHubTelemetryResult {
    Succeeded = "succeeded",
    Failed = "failed",
    LinkUnavailable = "linkUnavailable",
    SystemDatabase = "systemDatabase",
    /** The current cloud has no Fabric portal. */
    PortalUnavailable = "portalUnavailable",
    /** SQL Server couldn't be connected to, to check its Azure Arc registration. */
    ConnectionFailed = "connectionFailed",
    /** SQL Server isn't connected to Azure Arc, so the user was asked to connect it. */
    ArcNotRegistered = "arcNotRegistered",
    /** The user dismissed the offer to search the Hub for a server of unknown Arc registration. */
    Dismissed = "dismissed",
}

/** What the user did with the prompt to connect SQL Server to Azure Arc. */
enum DatabaseHubTelemetryFollowUp {
    LearnHow = "learnHow",
    Dismissed = "dismissed",
}

type SendDatabaseHubResult = (
    result: DatabaseHubTelemetryResult,
    additionalProps?: Record<string, string>,
    additionalMeasurements?: Record<string, number>,
) => void;

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
 * Returns the kind of database the Database Hub could track on a connection's server, judged by
 * its endpoint the same way Object Explorer tags the node's `serverPlatform` and `serverProduct`.
 *
 * A local server or one on no known platform is taken to be SQL Server, which the Hub tracks only
 * once it's connected to Azure Arc.
 *
 * @returns undefined for servers the Hub has no inventory for, such as a data warehouse or a
 * container, which can't be connected to Azure Arc.
 */
function getDatabaseTypeForConnection(
    connection: IConnectionInfo | undefined,
): FabricDatabaseHubDatabaseType | undefined {
    if (!connection || connection.containerName) {
        return undefined;
    }

    const serverTypes = getServerTypes(connection);
    if (serverTypes.includes(ServerType.Local) || serverTypes.includes(ServerType.Other)) {
        return FabricDatabaseHubDatabaseType.ArcSqlServer;
    }
    if (!serverTypes.includes(ServerType.Sql)) {
        return undefined;
    }
    if (serverTypes.includes(ServerType.Azure)) {
        return getAzureSqlManagedInstanceName(connection.server)
            ? FabricDatabaseHubDatabaseType.AzureSqlManagedInstance
            : FabricDatabaseHubDatabaseType.AzureSql;
    }
    if (serverTypes.includes(ServerType.Fabric)) {
        return FabricDatabaseHubDatabaseType.FabricSql;
    }
    return undefined;
}

/**
 * Returns the database an Object Explorer node stands for: the node's own database, or the one its
 * connection is scoped to.
 *
 * @returns undefined for a connection that names no database.
 */
function getObjectExplorerDatabaseName(node: TreeNodeInfo): string | undefined {
    const databaseName = ObjectExplorerUtils.getDatabaseName(node);
    return databaseName && databaseName !== LocalizedConstants.defaultDatabaseLabel
        ? databaseName
        : undefined;
}

/** Builds a link that opens an Arc-enabled SQL Server instance in the Hub's details dialog. */
function getArcSqlServerLink(instance: AzureArcSqlServerInstance): string | undefined {
    return getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.ArcSqlServer, {
        databaseResourceId: instance.resourceId,
    });
}

/**
 * Contributes the Database Hub action to the Azure Resources tree, the Fabric extension's
 * workspace tree, and Object Explorer.
 */
export class FabricDatabaseHubIntegration {
    private _logger: ILogger;
    private readonly _arcPrompts: AzureArcPromptTracker;
    /** Connections whose server is being checked in the background, so it's checked only once. */
    private readonly _backgroundChecks = new Set<string>();

    constructor(
        private readonly _connectionManager: ConnectionManager,
        globalState: vscode.Memento,
    ) {
        this._logger = getLogger("Fabric Database Hub");
        this._arcPrompts = new AzureArcPromptTracker(globalState);
    }

    /**
     * Registers the action, and the check that credits a prompt to connect SQL Server to Azure Arc
     * when the user later connects to the server and finds it connected.
     */
    public register(): vscode.Disposable {
        return vscode.Disposable.from(
            vscode.commands.registerCommand(
                Constants.cmdOpenInFabricDatabaseHub,
                (node: DatabaseHubTreeNode | undefined) => this.openInFabricDatabaseHub(node),
            ),
            this._connectionManager.onSuccessfulConnection(
                (event) => void this.checkPromptedServer(event),
            ),
        );
    }

    /** Opens the Database Hub for the given tree node; nodes with no Hub database are ignored. */
    private async openInFabricDatabaseHub(node: DatabaseHubTreeNode | undefined): Promise<void> {
        const telemetryProperties = this.getTelemetryProperties(node);
        const sendResult: SendDatabaseHubResult = (
            result,
            additionalProps = {},
            additionalMeasurements,
        ) =>
            sendActionEvent(TelemetryViews.FabricDatabaseHub, TelemetryActions.Open, {
                additionalProps: { ...telemetryProperties, ...additionalProps, result },
                ...(additionalMeasurements && { additionalMeasurements }),
            });
        try {
            if (this.warnIfSystemDatabase(node)) {
                sendResult(DatabaseHubTelemetryResult.SystemDatabase);
                return;
            }

            if (node instanceof TreeNodeInfo) {
                const databaseType = getDatabaseTypeForConnection(node.connectionProfile);
                if (databaseType === FabricDatabaseHubDatabaseType.ArcSqlServer) {
                    await this.openArcSqlServer(node.connectionProfile, sendResult);
                    return;
                }

                const databaseName = getObjectExplorerDatabaseName(node);
                if (databaseType === FabricDatabaseHubDatabaseType.AzureSql && databaseName) {
                    await this.openAzureSqlDatabase(
                        node.connectionProfile,
                        databaseName,
                        sendResult,
                    );
                    return;
                }
            }

            await this.openLink(this.getLinkForNode(node), sendResult);
        } catch (error) {
            sendErrorEvent(TelemetryViews.FabricDatabaseHub, TelemetryActions.Open, {
                error,
                additionalProps: telemetryProperties,
            });
            throw error;
        }
    }

    /**
     * Opens an Object Explorer Azure SQL database in the Hub's details dialog, once its resource ID
     * is found through the user's signed-in Azure accounts.
     *
     * A connection names only the server and database, so when the database can't be found in time
     * the Hub is searched for its name instead, which can also match other rows.
     */
    private async openAzureSqlDatabase(
        connection: IConnectionProfile,
        databaseName: string,
        sendResult: SendDatabaseHubResult,
    ): Promise<void> {
        const lookupStart = Date.now();
        const lookup = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: LocalizedConstants.Azure.findingDatabaseInAzure(databaseName),
            },
            () =>
                findAzureSqlDatabaseResourceId(
                    connection,
                    databaseName,
                    azureSqlDatabaseLookupTimeoutInMilliseconds,
                ),
        );

        await this.openLink(
            getFabricDatabaseHubLink(
                FabricDatabaseHubDatabaseType.AzureSql,
                lookup.resourceId
                    ? { databaseResourceId: lookup.resourceId }
                    : { resourceName: databaseName },
            ),
            (result) =>
                sendResult(
                    result,
                    {
                        linkKind: lookup.resourceId
                            ? DatabaseHubTelemetryLinkKind.DeepLink
                            : DatabaseHubTelemetryLinkKind.Search,
                        azureLookup: lookup.result,
                    },
                    { azureLookupMs: Date.now() - lookupStart },
                ),
        );
    }

    /**
     * Opens the Hub for a SQL Server it tracks only once the server is connected to Azure Arc, so
     * the server is asked for its Arc registration first.  A server that isn't connected gets a
     * prompt to connect it instead, which is remembered so that connecting it can be credited.
     */
    private async openArcSqlServer(
        connection: IConnectionProfile,
        sendResult: SendDatabaseHubResult,
    ): Promise<void> {
        // Don't connect to the server only to find there's no Hub to open.
        if (!hasFabricPortal()) {
            await this.openLink(undefined, sendResult);
            return;
        }

        const registration = await getAzureArcRegistration(this._connectionManager, connection);
        if (!registration) {
            sendResult(DatabaseHubTelemetryResult.ConnectionFailed);
            return;
        }

        const sendArcResult: SendDatabaseHubResult = (
            result,
            additionalProps = {},
            additionalMeasurements,
        ) =>
            sendResult(
                result,
                { ...additionalProps, arcRegistration: registration.status },
                additionalMeasurements,
            );
        switch (registration.status) {
            case "registered": {
                const arcPromptId = await this.creditArcPrompt(
                    connection.id,
                    DatabaseHubTelemetryArcDetection.Action,
                );
                await this.openLink(getArcSqlServerLink(registration.instance), (result) =>
                    sendArcResult(result, arcPromptId ? { arcPromptId } : {}),
                );
                return;
            }
            case "notRegistered": {
                const choice = await vscode.window.showInformationMessage(
                    LocalizedConstants.Azure.serverNotConnectedToAzureArc(connection.server),
                    LocalizedConstants.Azure.learnHowToConnectToAzureArc,
                );
                if (choice) {
                    await vscode.env.openExternal(
                        vscode.Uri.parse(Constants.azureArcConnectSqlServerLink),
                    );
                }
                const prompt = await this.recordArcPrompt(connection.id, !!choice);
                sendArcResult(
                    DatabaseHubTelemetryResult.ArcNotRegistered,
                    {
                        followUp: choice
                            ? DatabaseHubTelemetryFollowUp.LearnHow
                            : DatabaseHubTelemetryFollowUp.Dismissed,
                        ...(prompt && { arcPromptId: prompt.promptId }),
                    },
                    prompt && { promptCount: prompt.promptCount },
                );
                return;
            }
            case "unknown":
                await this.offerArcSqlServerSearch(connection, registration, sendArcResult);
                return;
        }
    }

    /**
     * Offers to search the Hub by machine name for a server whose Arc registration the login
     * can't read, since the Arc resource is named after the machine hosting the instance.
     */
    private async offerArcSqlServerSearch(
        connection: IConnectionInfo,
        registration: Extract<AzureArcRegistration, { status: "unknown" }>,
        sendResult: SendDatabaseHubResult,
    ): Promise<void> {
        const choice = await vscode.window.showInformationMessage(
            LocalizedConstants.Azure.azureArcRegistrationUnknown(connection.server),
            LocalizedConstants.Azure.searchFabricDatabaseHub,
        );
        if (!choice) {
            sendResult(DatabaseHubTelemetryResult.Dismissed);
            return;
        }

        await this.openLink(
            getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.ArcSqlServer, {
                resourceName: registration.machineName,
            }),
            sendResult,
        );
    }

    /**
     * Checks a prompted server again when the user connects to it, at most once a day, so a
     * server connected to Azure Arc after the prompt is credited, and its user offered the Hub,
     * even if they never run the action on it again.
     */
    private async checkPromptedServer(event: ConnectionSuccessfulEvent): Promise<void> {
        const connection = event.connection?.credentials as IConnectionProfile | undefined;
        const connectionId = connection?.id;
        if (
            !connectionId ||
            isAzureArcRegistrationCheckUri(event.fileUri) ||
            this._backgroundChecks.has(connectionId) ||
            !hasFabricPortal()
        ) {
            return;
        }

        this._backgroundChecks.add(connectionId);
        try {
            if (!(await this._arcPrompts.claimBackgroundCheck(connectionId))) {
                return;
            }

            const registration = await getAzureArcRegistration(
                this._connectionManager,
                connection,
                { reportErrors: false },
            );
            if (registration?.status !== "registered") {
                return;
            }

            const arcPromptId = await this.creditArcPrompt(
                connectionId,
                DatabaseHubTelemetryArcDetection.Connection,
            );
            const sendResult: SendDatabaseHubResult = (result) =>
                sendActionEvent(TelemetryViews.FabricDatabaseHub, TelemetryActions.Open, {
                    additionalProps: {
                        source: DatabaseHubTelemetrySource.ArcEnabledNotification,
                        databaseType: FabricDatabaseHubDatabaseType.ArcSqlServer,
                        arcRegistration: registration.status,
                        arcPromptId,
                        result,
                    },
                });
            const choice = await vscode.window.showInformationMessage(
                LocalizedConstants.Azure.serverNowConnectedToAzureArc(connection.server),
                LocalizedConstants.Azure.openInFabricDatabaseHub,
            );
            if (!choice) {
                sendResult(DatabaseHubTelemetryResult.Dismissed);
                return;
            }
            await this.openLink(getArcSqlServerLink(registration.instance), sendResult);
        } catch (error) {
            this._logger.error("Failed to check a server's Azure Arc registration.", error);
        } finally {
            this._backgroundChecks.delete(connectionId);
        }
    }

    /** Remembers that the user was prompted to connect a server to Azure Arc. */
    private async recordArcPrompt(
        connectionId: string | undefined,
        learnHowOpened: boolean,
    ): Promise<AzureArcPrompt | undefined> {
        return connectionId
            ? await this._arcPrompts.recordPrompt(connectionId, learnHowOpened)
            : undefined;
    }

    /**
     * Credits the prompt to connect a server to Azure Arc once the server turns up connected,
     * joining the two in telemetry by the prompt's random ID.
     *
     * @returns the prompt's ID, or undefined when the user was never prompted for the server.
     */
    private async creditArcPrompt(
        connectionId: string | undefined,
        detectedBy: DatabaseHubTelemetryArcDetection,
    ): Promise<string | undefined> {
        const prompt = connectionId
            ? await this._arcPrompts.completePrompt(connectionId)
            : undefined;
        if (!prompt) {
            return undefined;
        }

        sendActionEvent(TelemetryViews.FabricDatabaseHub, TelemetryActions.ArcEnabledAfterPrompt, {
            additionalProps: {
                arcPromptId: prompt.promptId,
                detectedBy,
                learnHowOpened: String(prompt.learnHowOpened),
            },
            additionalMeasurements: {
                daysSincePrompt: this._arcPrompts.getDaysSincePrompt(prompt),
                promptCount: prompt.promptCount,
            },
        });
        return prompt.promptId;
    }

    /** Opens a Hub link and reports the outcome, explaining why when there's no link to open. */
    private async openLink(
        link: string | undefined,
        sendResult: SendDatabaseHubResult,
    ): Promise<void> {
        if (!link) {
            // The menus can't tell which cloud is selected, so explain why nothing opens.
            if (!hasFabricPortal()) {
                void vscode.window.showInformationMessage(
                    LocalizedConstants.Azure.fabricDatabaseHubUnavailableInCloud(
                        getCloudProviderSettings().displayName,
                    ),
                );
                sendResult(DatabaseHubTelemetryResult.PortalUnavailable);
                return;
            }

            this._logger.debug("No Fabric Database Hub link could be built for the selected node.");
            sendResult(DatabaseHubTelemetryResult.LinkUnavailable);
            return;
        }

        // VS Code opens a string link as is, but decodes a Uri and re-encodes it with encodeURI,
        // which turns a '+' or '#' in a database name into something else.
        const opened = await vscode.env.openExternal(link as unknown as vscode.Uri);
        sendResult(
            opened ? DatabaseHubTelemetryResult.Succeeded : DatabaseHubTelemetryResult.Failed,
        );
    }

    /**
     * Tells the user that a system database has no place in the Database Hub, rather than sending
     * them to an estate view that can never list it.
     *
     * Only kinds the Hub lists by database are checked; for a managed instance or SQL Server the
     * Hub lists the instance, which a system database still belongs to.
     *
     * @returns whether the node named a system database, in which case no link is opened.
     */
    private warnIfSystemDatabase(node: DatabaseHubTreeNode | undefined): boolean {
        let databaseName: string | undefined;
        if (isWrapper(node)) {
            databaseName = parseAzureSqlResourceId(getAzureResource(node).id)?.databaseName;
        } else if (node instanceof TreeNodeInfo) {
            const databaseType = getDatabaseTypeForConnection(node.connectionProfile);
            if (
                databaseType === FabricDatabaseHubDatabaseType.AzureSql ||
                databaseType === FabricDatabaseHubDatabaseType.FabricSql
            ) {
                databaseName = getObjectExplorerDatabaseName(node);
            }
        }
        if (!isSystemDatabaseName(databaseName)) {
            return false;
        }

        void vscode.window.showInformationMessage(
            LocalizedConstants.Azure.systemDatabaseNotInFabricDatabaseHub(databaseName),
        );
        return true;
    }

    /** Returns only low-cardinality, non-identifying properties for command telemetry. */
    private getTelemetryProperties(node: DatabaseHubTreeNode | undefined): Record<string, string> {
        if (isWrapper(node)) {
            return {
                source: DatabaseHubTelemetrySource.AzureResources,
                databaseType: FabricDatabaseHubDatabaseType.AzureSql,
                nodeKind: parseAzureSqlResourceId(getAzureResource(node).id)?.databaseName
                    ? DatabaseHubTelemetryNodeKind.Database
                    : DatabaseHubTelemetryNodeKind.Other,
            };
        }
        if (isAzureResourceTypeGroupNode(node)) {
            return {
                source: DatabaseHubTelemetrySource.AzureResources,
                databaseType: FabricDatabaseHubDatabaseType.AzureSql,
                nodeKind: DatabaseHubTelemetryNodeKind.DatabaseGroup,
            };
        }
        if (node instanceof TreeNodeInfo) {
            return {
                source: DatabaseHubTelemetrySource.ObjectExplorer,
                databaseType:
                    getDatabaseTypeForConnection(node.connectionProfile) ?? unknownDatabaseType,
                nodeKind:
                    node.nodeType === Constants.databaseString
                        ? DatabaseHubTelemetryNodeKind.Database
                        : DatabaseHubTelemetryNodeKind.Connection,
            };
        }
        if (isFabricWorkspaceItemNode(node)) {
            const isDatabase = isFabricSqlDatabaseNode(node);
            return {
                source: DatabaseHubTelemetrySource.FabricWorkspace,
                databaseType: isDatabase
                    ? FabricDatabaseHubDatabaseType.FabricSql
                    : unknownDatabaseType,
                nodeKind: isDatabase
                    ? DatabaseHubTelemetryNodeKind.Database
                    : DatabaseHubTelemetryNodeKind.Other,
            };
        }
        return {
            source: DatabaseHubTelemetrySource.Unknown,
            databaseType: unknownDatabaseType,
            nodeKind: DatabaseHubTelemetryNodeKind.Other,
        };
    }

    private getLinkForNode(node: DatabaseHubTreeNode | undefined): string | undefined {
        if (isWrapper(node)) {
            return this.getAzureDatabaseLink(getAzureResource(node).id);
        }

        if (isAzureResourceTypeGroupNode(node)) {
            return this.getAzureSubscriptionLink(node);
        }

        if (node instanceof TreeNodeInfo) {
            return this.getObjectExplorerLink(node);
        }

        if (isFabricWorkspaceItemNode(node)) {
            return this.getFabricWorkspaceItemLink(node);
        }

        return undefined;
    }

    /**
     * Builds a link that opens an Azure SQL database node's database in the Hub's details dialog,
     * over the estate grid of Azure SQL databases.
     *
     * @returns undefined for a logical server, which the estate inventory has no row for.
     */
    private getAzureDatabaseLink(azureResourceId: string): string | undefined {
        if (!parseAzureSqlResourceId(azureResourceId)?.databaseName) {
            return undefined;
        }

        return getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.AzureSql, {
            databaseResourceId: decodeResourceId(azureResourceId),
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

    /**
     * Builds a link for an Object Explorer managed instance or Fabric SQL database; Azure SQL
     * databases are deep-linked by {@link openAzureSqlDatabase} instead.
     *
     * A Fabric SQL database opens in the Hub's details dialog by the item ID its catalog name
     * carries.  A connection carries no subscription or resource group to build a managed
     * instance's resource ID from, so a managed instance is searched for by name, and same-named
     * ones elsewhere share the view.  The Hub lists a managed instance rather than its databases,
     * so any of its databases opens the instance.
     *
     * @returns undefined for a Fabric SQL connection that names no database, and for servers the
     * Hub has no inventory for.
     */
    private getObjectExplorerLink(node: TreeNodeInfo): string | undefined {
        const connection = node.connectionProfile;
        switch (getDatabaseTypeForConnection(connection)) {
            case FabricDatabaseHubDatabaseType.AzureSqlManagedInstance:
                return getFabricDatabaseHubLink(
                    FabricDatabaseHubDatabaseType.AzureSqlManagedInstance,
                    { resourceName: getAzureSqlManagedInstanceName(connection.server) },
                );
            case FabricDatabaseHubDatabaseType.FabricSql: {
                const databaseName = getObjectExplorerDatabaseName(node);
                // An unknown pre-production ring has no portal, and production wouldn't list it.
                const environment = getFabricEnvironment(connection.server);
                if (!databaseName || !environment) {
                    return undefined;
                }
                // Fabric SQL catalogs carry the item ID to open; without it, search by name.
                const itemId = getFabricSqlDatabaseItemId(databaseName);
                return getFabricDatabaseHubLink(
                    FabricDatabaseHubDatabaseType.FabricSql,
                    itemId
                        ? { environment, databaseResourceId: itemId }
                        : {
                              environment,
                              resourceName: getFabricSqlDatabaseDisplayName(databaseName),
                          },
                );
            }
            default:
                return undefined;
        }
    }

    /**
     * Builds a link that opens a SQL database node from the Fabric extension's workspace tree in
     * the Hub's details dialog, by its item ID.
     */
    private getFabricWorkspaceItemLink(node: FabricWorkspaceItemNode): string | undefined {
        if (!isFabricSqlDatabaseNode(node)) {
            return undefined;
        }

        return getFabricDatabaseHubLink(FabricDatabaseHubDatabaseType.FabricSql, {
            environment: getFabricWorkspaceItemEnvironment(node),
            databaseResourceId: node.artifact.id,
        });
    }
}
