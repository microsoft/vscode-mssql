/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as vscodeMssql from "vscode-mssql";
import MainController from "./controllers/mainController";
import VscodeWrapper from "./controllers/vscodeWrapper";
import { ConnectionDetails, IConnectionInfo, IExtension } from "vscode-mssql";
import { Deferred } from "./protocol";
import * as utils from "./models/utils";
import { ObjectExplorerUtils } from "./objectExplorer/objectExplorerUtils";
import SqlToolsServerClient from "./languageservice/serviceclient";
import { ConnectionProfile } from "./models/connectionProfile";
import { FirewallRuleError } from "./languageservice/interfaces";
import { RequestType } from "vscode-languageclient";
import { createSqlAgentRequestHandler, ISqlChatResult } from "./copilot/chatAgentRequestHandler";
import { sendActionEvent } from "./telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "./sharedInterfaces/telemetry";
import { ChatResultFeedbackKind } from "vscode";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import express from "express";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types";

/** exported for testing purposes only */
export let controller: MainController = undefined;

export async function activate(context: vscode.ExtensionContext): Promise<IExtension> {
    console.log(McpServer);

    const app = express();
    app.use(express.json());

    // Map to store transports by session ID
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

    // Handle POST requests for client-to-server communication
    app.post("/mcp", async (req, res) => {
        // Check for existing session ID
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports[sessionId]) {
            // Reuse existing transport
            transport = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
            // New initialization request
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sessionId) => {
                    // Store the transport by session ID
                    transports[sessionId] = transport;
                },
                // DNS rebinding protection is disabled by default for backwards compatibility. If you are running this server
                // locally, make sure to set:
                // enableDnsRebindingProtection: true,
                // allowedHosts: ['127.0.0.1'],
            });

            // Clean up transport when closed
            transport.onclose = () => {
                if (transport.sessionId) {
                    delete transports[transport.sessionId];
                }
            };
            // Create an MCP server
            const server = new McpServer({
                name: "demo-server",
                version: "1.0.0",
            });

            // Add an addition tool
            server.registerTool(
                "add",
                {
                    title: "Addition Tool",
                    description: "Add two numbers",
                    inputSchema: { a: z.number(), b: z.number() },
                },
                async ({ a, b }) => ({
                    content: [{ type: "text", text: String(a + b) }],
                }),
            );

            // Add a dynamic greeting resource
            server.registerResource(
                "greeting",
                new ResourceTemplate("greeting://{name}", { list: undefined }),
                {
                    title: "Greeting Resource", // Display name for UI
                    description: "Dynamic greeting generator",
                },
                async (uri, { name }) => ({
                    contents: [
                        {
                            uri: uri.href,
                            text: `Hello, ${name}!`,
                        },
                    ],
                }),
            );

            // Connect to the MCP server
            await server.connect(transport);
        } else {
            // Invalid request
            res.status(400).json({
                jsonrpc: "2.0",
                error: {
                    code: -32000,
                    message: "Bad Request: No valid session ID provided",
                },
                id: null,
            });
            return;
        }

        // Handle the request
        await transport.handleRequest(req, res, req.body);
    });

    // Reusable handler for GET and DELETE requests
    const handleSessionRequest = async (req: express.Request, res: express.Response) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
            res.status(400).send("Invalid or missing session ID");
            return;
        }

        const transport = transports[sessionId];
        await transport.handleRequest(req, res);
    };

    // Handle GET requests for server-to-client notifications via SSE
    app.get("/mcp", handleSessionRequest);

    // Handle DELETE requests for session termination
    app.delete("/mcp", handleSessionRequest);

    app.listen(3000);

    let vscodeWrapper = new VscodeWrapper();
    controller = new MainController(context, undefined, vscodeWrapper);
    context.subscriptions.push(controller);

    // Checking if localization should be applied
    //let config = vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);
    //let applyLocalization = config[Constants.configApplyLocalization];
    // if (applyLocalization) {
    // 	LocalizedConstants.loadLocalizedConstants(vscode.env.language);
    // }

    // Check if GitHub Copilot is installed
    const copilotExtension = vscode.extensions.getExtension("GitHub.copilot");
    vscode.commands.executeCommand(
        "setContext",
        "mssql.copilot.isGHCInstalled",
        !!copilotExtension,
    );

    // Exposed for testing purposes
    vscode.commands.registerCommand("mssql.getControllerForTests", () => controller);
    await controller.activate();
    const participant = vscode.chat.createChatParticipant(
        "mssql.agent",
        createSqlAgentRequestHandler(controller.copilotService, vscodeWrapper, context, controller),
    );
    participant.iconPath = vscode.Uri.joinPath(
        context.extensionUri,
        "images",
        "mssql-chat-avatar.jpg",
    );

    const receiveFeedbackDisposable = participant.onDidReceiveFeedback(
        (feedback: vscode.ChatResultFeedback) => {
            sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.Feedback, {
                kind: feedback.kind === ChatResultFeedbackKind.Helpful ? "Helpful" : "Unhelpful",
                correlationId: (feedback.result as ISqlChatResult).metadata.correlationId,
            });
        },
    );

    context.subscriptions.push(controller, participant, receiveFeedbackDisposable);

    return {
        sqlToolsServicePath: SqlToolsServerClient.instance.sqlToolsServicePath,
        promptForConnection: async (ignoreFocusOut?: boolean) => {
            const connectionProfileList =
                await controller.connectionManager.connectionStore.getPickListItems();
            return controller.connectionManager.connectionUI.promptForConnection(
                connectionProfileList,
                ignoreFocusOut,
            );
        },
        connect: async (connectionInfo: IConnectionInfo, saveConnection?: boolean) => {
            const uri = utils.generateQueryUri().toString();
            const connectionPromise = new Deferred<boolean>();
            // First wait for initial connection request to succeed
            const requestSucceeded = await controller.connect(
                uri,
                connectionInfo,
                connectionPromise,
                saveConnection,
            );
            if (!requestSucceeded) {
                if (controller.connectionManager.failedUriToFirewallIpMap.has(uri)) {
                    throw new FirewallRuleError(
                        uri,
                        `Connection request for ${JSON.stringify(connectionInfo)} failed because of invalid firewall rule settings`,
                    );
                } else {
                    throw new Error(
                        `Connection request for ${JSON.stringify(connectionInfo)} failed`,
                    );
                }
            }
            // Next wait for the actual connection to be made
            const connectionSucceeded = await connectionPromise;
            if (!connectionSucceeded) {
                throw new Error(`Connection for ${JSON.stringify(connectionInfo)} failed`);
            }
            return uri;
        },
        listDatabases: (connectionUri: string) => {
            return controller.connectionManager.listDatabases(connectionUri);
        },
        getDatabaseNameFromTreeNode: (node: vscodeMssql.ITreeNodeInfo) => {
            return ObjectExplorerUtils.getDatabaseName(node);
        },
        dacFx: controller.dacFxService,
        schemaCompare: controller.schemaCompareService,
        sqlProjects: controller.sqlProjectsService,
        getConnectionString: (
            connectionUriOrDetails: string | ConnectionDetails,
            includePassword?: boolean,
            includeApplicationName?: boolean,
        ) => {
            return controller.connectionManager.getConnectionString(
                connectionUriOrDetails,
                includePassword,
                includeApplicationName,
            );
        },
        promptForFirewallRule: (connectionUri: string, connectionInfo: IConnectionInfo) => {
            const connectionProfile = new ConnectionProfile(connectionInfo);
            return controller.connectionManager.connectionUI.addFirewallRule(
                connectionUri,
                connectionProfile,
            );
        },
        azureAccountService: controller.azureAccountService,
        azureResourceService: controller.azureResourceService,
        createConnectionDetails: (connectionInfo: IConnectionInfo) => {
            return controller.connectionManager.createConnectionDetails(connectionInfo);
        },
        sendRequest: async <P, R, E, R0>(requestType: RequestType<P, R, E, R0>, params?: P) => {
            return await controller.connectionManager.sendRequest(requestType, params);
        },
        getServerInfo: (connectionInfo: IConnectionInfo) => {
            return controller.connectionManager.getServerInfo(connectionInfo);
        },
        connectionSharing: <vscodeMssql.IConnectionSharingService>{
            getActiveEditorConnectionId: (extensionId: string) => {
                return controller.connectionSharingService.getActiveEditorConnectionId(extensionId);
            },
            connect: async (extensionId: string, connectionId: string): Promise<string> => {
                return controller.connectionSharingService.connect(extensionId, connectionId);
            },
            disconnect: (connectionUri: string): void => {
                return controller.connectionSharingService.disconnect(connectionUri);
            },
            isConnected: (connectionUri: string): boolean => {
                return controller.connectionSharingService.isConnected(connectionUri);
            },
            executeSimpleQuery: (
                connectionUri: string,
                queryString: string,
            ): Promise<vscodeMssql.SimpleExecuteResult> => {
                return controller.connectionSharingService.executeSimpleQuery(
                    connectionUri,
                    queryString,
                );
            },
            getServerInfo: (connectionUri: string): vscodeMssql.IServerInfo => {
                return controller.connectionSharingService.getServerInfo(connectionUri);
            },
            listDatabases: (connectionUri: string): Promise<string[]> => {
                return controller.connectionSharingService.listDatabases(connectionUri);
            },
            scriptObject: (connectionUri, operation, scriptingObject) => {
                return controller.connectionSharingService.scriptObject(
                    connectionUri,
                    operation,
                    scriptingObject,
                );
            },
        },
    };
}

// this method is called when your extension is deactivated
export async function deactivate(): Promise<void> {
    if (controller) {
        await controller.deactivate();
        controller.dispose();
    }
}

/**
 * Exposed for testing purposes
 */
export async function getController(): Promise<MainController> {
    if (!controller) {
        let savedController: MainController = await vscode.commands.executeCommand(
            "mssql.getControllerForTests",
        );
        return savedController;
    }
    return controller;
}
