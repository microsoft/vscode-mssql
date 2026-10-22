/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { getLogger } from "../models/logger";

import { AzureResource, Wrapper } from "@microsoft/vscode-azureresources-api";
import { cmdOpenInMssqlExtensionFromAzureResources } from "../constants/constants";
import { AuthenticationType } from "../sharedInterfaces/connectionDialog";
import { CloudId, getCloudProviderSettings } from "../azure/providerSettings";
import { extractFromResourceId } from "../connectionconfig/azureHelpers";
import { ILogger } from "../sharedInterfaces/logger";
import { MssqlProtocolHandler } from "../mssqlProtocolHandler";

/**
 * The resource item returned by unwrapping an Azure Resources tree command argument.
 * This mirrors AzureResourceItem from vscode-azureresourcegroups.
 */
export interface AzureResourceItem {
    readonly resource: AzureResource;
}

/**
 * Grouping node in the Azure Resources tree, one per resource type within a subscription (the
 * "SQL databases" folder, for example).  This mirrors ResourceTypeGroupingItem from
 * vscode-azureresourcegroups.
 *
 * Declared locally because that class is internal to the Azure Resources extension.  Unlike a
 * resource item it is not a {@link Wrapper}, so commands receive it unwrapped and must recognize it
 * structurally.
 */
export interface AzureResourceTypeGroupNode {
    readonly subscription?: { readonly subscriptionId?: string };
}

/** Unwraps the command argument using the API published by the Azure Resources extension. */
export function getAzureResource(node: Wrapper): AzureResource {
    return node.unwrap<AzureResourceItem>().resource;
}

/**
 * Whether a command argument is an Azure Resources grouping node carrying a subscription.
 *
 * Grouping nodes have no `unwrap`, so `isWrapper` rejects them; without this check they fall
 * through to whichever branch handles nodes from other trees.
 */
export function isAzureResourceTypeGroupNode(node: unknown): node is AzureResourceTypeGroupNode {
    const subscriptionId = (node as AzureResourceTypeGroupNode | undefined)?.subscription
        ?.subscriptionId;
    return typeof subscriptionId === "string" && subscriptionId.length > 0;
}

export class AzureResourcesExtensionIntegration {
    private _logger: ILogger;

    constructor(private protocolHandler: MssqlProtocolHandler) {
        this._logger = getLogger("Azure Resources");
    }

    public registerOpenInMssqlCommand(): vscode.Disposable {
        const openInMssqlExtensionCommand = vscode.commands.registerCommand(
            cmdOpenInMssqlExtensionFromAzureResources,
            (node: Wrapper | undefined) => this.invokeForAzureSqlResource(node),
        );

        return openInMssqlExtensionCommand;
    }

    private async invokeForAzureSqlResource(node: Wrapper | undefined): Promise<void> {
        if (!node) {
            return;
        }
        const resource = getAzureResource(node);
        const { subscription } = resource;

        const dnsSuffix =
            subscription.environment.sqlServerHostnameSuffix ??
            getCloudProviderSettings().settings.sqlResource.dnsSuffix ??
            getCloudProviderSettings(CloudId.AzureCloud).settings.sqlResource!.dnsSuffix;

        const serverResourceName = extractFromResourceId(resource.id, "servers") ?? resource.name;
        const databaseName = extractFromResourceId(resource.id, "databases");

        const serverName = `${serverResourceName}${dnsSuffix}`;
        const profileName = databaseName
            ? `${serverResourceName}/${databaseName}`
            : serverResourceName;

        const params = new URLSearchParams({
            server: serverName,
            authenticationType: AuthenticationType.AzureMFA,
            profileName,
            source: "vscode-azureresourcegroups",
        });

        if (databaseName) {
            params.set("database", databaseName);
        }

        // Connect using the same account and tenant the user was browsing with
        if (subscription.account?.id) {
            params.set("accountId", subscription.account.id);
        }
        if (subscription.tenantId) {
            params.set("tenantId", subscription.tenantId);
        }

        const uri = vscode.Uri.parse(
            `${vscode.env.uriScheme}://ms-mssql.mssql/connect?${params.toString()}`,
        );

        this._logger.debug(
            `Invoking mssql extension to open connection to ${serverName} (profile name: ${profileName}); URI: ${uri.toString()}`,
        );

        await this.protocolHandler.handleUri(uri);
    }
}
