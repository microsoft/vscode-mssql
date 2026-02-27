/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type ConnectionManager from "../controllers/connectionManager";
import { UriOwnershipCoordinator } from "./uriOwnershipCore";

const HIDE_UI_ELEMENTS_CONTEXT_VARIABLE = "mssql.hideUIElements";

export function createUriOwnershipCoordinator(
    context: vscode.ExtensionContext,
): UriOwnershipCoordinator {
    return new UriOwnershipCoordinator(context, {
        hideUiContextKey: HIDE_UI_ELEMENTS_CONTEXT_VARIABLE,
    });
}

export function initializeUriOwnershipCoordinator(
    coordinator: UriOwnershipCoordinator,
    connectionManager: ConnectionManager,
): void {
    coordinator.initialize({
        ownsUri: (uri: string) =>
            connectionManager.isConnected(uri) || connectionManager.isConnecting(uri),
        onDidChangeOwnership: connectionManager.onConnectionsChanged,
        releaseUri: (uri: string) => {
            void connectionManager.disconnect(uri);
        },
    });
}
