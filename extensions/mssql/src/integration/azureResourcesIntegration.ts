/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { getLogger } from "../models/logger";

import { AzureResource } from "@microsoft/vscode-azureresources-api";
import { cmdOpenInMssqlExtensionFromAzureResources } from "../constants/constants";
import { AuthenticationType } from "../sharedInterfaces/connectionDialog";
import { CloudId, getCloudProviderSettings } from "../azure/providerSettings";
import { extractFromResourceId } from "../connectionconfig/azureHelpers";
import { ILogger } from "../sharedInterfaces/logger";
import { MssqlProtocolHandler } from "../mssqlProtocolHandler";

/**
 * Node from the Azure Resources tree
 */
interface AzureResourceNode {
    readonly resource: AzureResource;
}

function isAzureResourceNode(node: unknown): node is AzureResourceNode {
    return typeof node === "object" && !!node && "resource" in node;
}

export class AzureResourcesExtensionIntegration {
    private _logger: ILogger;

    constructor(private protocolHandler: MssqlProtocolHandler) {
        this._logger = getLogger("Azure Resources");
    }

    public registerOpenInMssqlCommand(): vscode.Disposable {
        const openInMssqlExtensionCommand = vscode.commands.registerCommand(
            cmdOpenInMssqlExtensionFromAzureResources,
            (node: unknown) => this.invokeForAzureSqlResource(node),
        );

        return openInMssqlExtensionCommand;
    }

    private async invokeForAzureSqlResource(node: unknown): Promise<void> {
        if (!isAzureResourceNode(node)) {
            return;
        }

        const { resource } = node;
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

        this._logger.info(
            `Invoking mssql extension to open connection to ${serverName} (profile name: ${profileName}); URI: ${uri.toString()}`,
        );

        await this.protocolHandler.handleUri(uri);
    }
}
