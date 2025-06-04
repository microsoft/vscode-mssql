/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import ConnectionManager from "../controllers/connectionManager";
import * as vscode from "vscode";
import * as LocalizedConstants from "../constants/localizedConstants";

const CONNECTION_SHARING_PERMISSIONS_KEY = "mssql.connectionSharing.extensionPermissions";

type ConnectionSharingApproval = "approved" | "denied" | "neveragain";
// Map of extension IDs to connection sharing approval status
type ConnectionSharingApprovalMap = Record<string, ConnectionSharingApproval>;

export class ConnectionSharingService implements mssql.IConnectionSharingService {
    constructor(
        private context: vscode.ExtensionContext,
        private _connectionManager: ConnectionManager,
    ) {}

    private async getApprovedExtensions(): Promise<ConnectionSharingApprovalMap> {
        const serializedList = await this.context.secrets.get(CONNECTION_SHARING_PERMISSIONS_KEY);
        if (!serializedList) {
            // If no approved extensions are found, initialize with an empty array
            await this.context.secrets.store(
                CONNECTION_SHARING_PERMISSIONS_KEY,
                JSON.stringify({} as ConnectionSharingApprovalMap),
            );
            return {};
        }
        return JSON.parse(serializedList) as ConnectionSharingApprovalMap;
    }

    private async setApprovedExtensions(extensions: ConnectionSharingApprovalMap): Promise<void> {
        await this.context.secrets.store(
            CONNECTION_SHARING_PERMISSIONS_KEY,
            JSON.stringify(extensions),
        );
    }

    private async isExtensionApproved(extensionId: string): Promise<boolean> {
        const approvedExtensions = await this.getApprovedExtensions();
        return approvedExtensions[extensionId] === "approved";
    }

    async requestConnectionSharingApproval(extensionId: string): Promise<boolean> {
        if (await this.isExtensionApproved(extensionId)) {
            return true; // Already approved
        }
        const addToApprovedRequest = await vscode.window.showInformationMessage(
            LocalizedConstants.ConnectionSharing.connectionSharingRequestNotification(extensionId),
            {},
            LocalizedConstants.Common.approve,
            LocalizedConstants.Common.deny,
        );

        switch (addToApprovedRequest) {
            case LocalizedConstants.Common.approve:
                await this.setApprovedExtensions({
                    ...(await this.getApprovedExtensions()),
                    [extensionId]: "approved",
                });
                return true;
            case LocalizedConstants.Common.deny:
                await this.setApprovedExtensions({
                    ...(await this.getApprovedExtensions()),
                    [extensionId]: "denied",
                });
                return false;
        }
    }

    private isExtensionApproved(extensionId: string): boolean {}

    getConnectionIdForActiveEditor(extensionId: string): string | undefined {
        throw new Error("Method not implemented.");
    }
    connect(extensionId: string, connectionId: string): string | undefined {
        throw new Error("Method not implemented.");
    }
    disconnect(connectionUri: string): void {
        throw new Error("Method not implemented.");
    }
    isConnected(connectionUri: string): boolean {
        throw new Error("Method not implemented.");
    }
    executeSimpleQuery(connectionUri: string, query: string): Promise<mssql.QueryExecuteResult> {
        throw new Error("Method not implemented.");
    }
    getServerInfo(connectionUri: string): Promise<mssql.ServerInfo> {
        throw new Error("Method not implemented.");
    }
}
