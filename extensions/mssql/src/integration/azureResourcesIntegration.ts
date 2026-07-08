/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { getLogger } from "../models/logger";

import { AzureResource } from "@microsoft/vscode-azureresources-api";
import { ConnectionNode } from "../objectExplorer/nodes/connectionNode";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { cmdOpenInMssqlExtensionFromAzureResources } from "../constants/constants";
import { ILogger } from "../sharedInterfaces/logger";
import { MssqlProtocolHandler } from "../mssqlProtocolHandler";

/**
 * Lightweight placeholder returned synchronously by `getResourceItem`.
 * The OE session is created lazily the first time the user expands the node.
 */
export interface SqlServerRootModel {
    /** ARM resource ID — required by ResourceModelBase */
    readonly id: string;
    readonly resource: AzureResource;
    /** Populated on first expansion */
    connectionNode?: ConnectionNode;
    /** Populated on first expansion */
    sessionId?: string;
}

/** Union type covering both the server root and any OE child node */
export type SqlBranchModel = SqlServerRootModel | TreeNodeInfo;

export function isSqlServerRootModel(node: unknown): node is SqlServerRootModel {
    return typeof node === "object" && node !== null && "resource" in node && !("nodePath" in node);
}

export class AzureResourcesExtensionIntegration {
    private _logger: ILogger;

    constructor(private protocolHandler: MssqlProtocolHandler) {
        this._logger = getLogger("Azure Resources");
    }

    public registerOpenInMssqlCommand(): vscode.Disposable {
        const openInMssqlExtensionCommand = vscode.commands.registerCommand(
            cmdOpenInMssqlExtensionFromAzureResources,
            async (rawNode: unknown) => {
                const maybeWrapper = rawNode as { unwrap?: () => unknown } | null | undefined;
                const inner =
                    maybeWrapper && typeof maybeWrapper.unwrap === "function"
                        ? maybeWrapper.unwrap()
                        : rawNode;

                if (!isSqlServerRootModel(inner)) {
                    return;
                }

                const serverName = `${inner.resource.name}.database.windows.net`;
                const profileName = inner.resource.name;

                const uri = vscode.Uri.parse(
                    `${vscode.env.uriScheme}://ms-mssql.mssql/connect` +
                        `?server=${encodeURIComponent(serverName)}` +
                        `&authenticationType=AzureMFA` +
                        `&profileName=${encodeURIComponent(profileName)}` +
                        `&source=vscode-azureresourcegroups}`,
                );

                this._logger.info(
                    `Invoking mssql extension to open connection to ${serverName} (profile name: ${profileName}); URI: ${uri.toString()}`,
                );

                await this.protocolHandler.handleUri(uri);
            },
        );

        return openInMssqlExtensionCommand;
    }
}
