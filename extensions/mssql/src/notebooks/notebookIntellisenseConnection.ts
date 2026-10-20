/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type { ConnectionDetails } from "vscode-mssql";
import type ConnectionManager from "../controllers/connectionManager";
import { Logger } from "../models/logger";
import {
    ConnectionCompleteParams,
    ConnectionRequest,
    DisconnectRequest,
    CancelConnectRequest,
} from "../models/contracts/connection";

const log = Logger.global("NotebookIntellisenseConnection");
const attempts = new WeakMap<ConnectionManager, Map<string, object>>();

export async function connectNotebookIntellisense(
    manager: ConnectionManager,
    ownerUri: string,
    connection: ConnectionDetails,
    token: vscode.CancellationToken,
): Promise<ConnectionCompleteParams | undefined> {
    if (token.isCancellationRequested) return undefined;
    let owners = attempts.get(manager);
    if (!owners) {
        owners = new Map();
        attempts.set(manager, owners);
    }
    const attempt = {};
    owners.set(ownerUri, attempt);
    const current = () => owners.get(ownerUri) === attempt;
    const complete = manager.expectConnectionComplete(ownerUri);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let listener: vscode.Disposable | undefined;
    const abandoned = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), 30000);
        listener = token.onCancellationRequested(() => resolve(undefined));
    });
    let connected = false;
    try {
        const accepted = await Promise.race([
            manager.sendRequest(ConnectionRequest.type, { ownerUri, connection }),
            abandoned,
        ]);
        if (accepted !== true || token.isCancellationRequested || !current()) return undefined;
        const result = await Promise.race([complete, abandoned]);
        if (!result?.connectionId || token.isCancellationRequested || !current()) return undefined;
        connected = true;
        return result;
    } finally {
        if (timer) clearTimeout(timer);
        listener?.dispose();
        if (!connected) {
            manager.cancelConnectionCompleteExpectation(ownerUri, complete);
            if (current()) {
                await manager
                    .sendRequest(CancelConnectRequest.type, { ownerUri })
                    .catch(() => log.warn("Notebook IntelliSense connection cancellation failed."));
                if (current()) {
                    await manager
                        .sendRequest(DisconnectRequest.type, { ownerUri })
                        .catch(() => log.warn("Notebook IntelliSense connection cleanup failed."));
                }
            }
        }
        if (current()) owners.delete(ownerUri);
    }
}
