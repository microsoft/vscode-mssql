/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import ConnectionManager from "../controllers/connectionManager";
import { QueryNotificationHandler } from "../controllers/queryNotificationHandler";
import VscodeWrapper from "../controllers/vscodeWrapper";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { Logger } from "../models/logger";
import { HeadlessQueryExecutor } from "../queryExecution/headlessQueryExecutor";
import { SqlToolsMcpBridgeManager } from "./sqlToolsMcpBridgeManager";
import { SqlToolsMcpRuntime } from "./sqlToolsMcpRuntime";
import {
    canRegisterSqlToolsMcpProvider,
    registerProvider,
    SqlToolsMcpServerDefinitionProvider,
} from "./sqlToolsMcpServerDefinitionProvider";

export function registerSqlToolsMcpServer(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    client: SqlToolsServiceClient,
    vscodeWrapper: VscodeWrapper,
): void {
    const logger = Logger.create(vscodeWrapper.outputChannel, "SqlToolsMcp");
    if (!canRegisterSqlToolsMcpProvider()) {
        logger.info("VS Code MCP server definition API is not available.");
        return;
    }

    const executor = new HeadlessQueryExecutor(client, QueryNotificationHandler.instance);
    const runtime = new SqlToolsMcpRuntime(connectionManager, executor, logger);
    const bridgeManager = new SqlToolsMcpBridgeManager(
        runtime,
        logger,
        getExtensionVersion(context),
    );
    const provider = new SqlToolsMcpServerDefinitionProvider(
        context,
        bridgeManager,
        logger,
        () => client.sqlToolsServicePath,
    );

    context.subscriptions.push(bridgeManager, provider, registerProvider(provider));
}

function getExtensionVersion(context: vscode.ExtensionContext): string | undefined {
    return (
        context as vscode.ExtensionContext & { extension?: { packageJSON?: { version?: string } } }
    ).extension?.packageJSON?.version;
}
