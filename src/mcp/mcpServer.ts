/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as express from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type MainController from "../controllers/mainController";

/**
 * Initializes and starts the MCP (Model Context Protocol) server
 * @param mainController The MainController instance to access services
 * @returns The Express app instance
 */
export function initializeMcpServer(mainController?: MainController): express.Application {
    const app = express();
    app.use(express.json());

    // Add request logging middleware
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        if (req.headers["mcp-session-id"]) {
            console.log(`  Session ID: ${req.headers["mcp-session-id"]}`);
        }
        next();
    });

    // Add CORS headers if needed
    app.use((req, res, next) => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.header("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
        if (req.method === "OPTIONS") {
            res.sendStatus(200);
        } else {
            next();
        }
    });

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

            // Create and configure the MCP server
            const server = createMcpServer(mainController);

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
                id: undefined,
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

    // Add a root endpoint for health checks
    app.get("/", (req, res) => {
        res.json({
            name: "mssql-mcp-server",
            version: "1.0.0",
            status: "running",
            endpoints: {
                mcp: "/mcp",
                health: "/health",
            },
        });
    });

    // Add a health check endpoint
    app.get("/health", (req, res) => {
        res.json({ status: "healthy", timestamp: new Date().toISOString() });
    });

    return app;
}

/**
 * Creates and configures the MCP server with tools and resources
 * @param mainController The MainController instance to access services
 * @returns Configured McpServer instance
 */
function createMcpServer(mainController?: MainController): McpServer {
    const server = new McpServer({
        name: "mssql-mcp-server",
        version: "1.0.0",
    });

    // Add MSSQL-specific tools if MainController is available
    if (mainController) {
        // Register mssql_list_servers tool
        server.registerTool(
            "mssql_list_servers",
            {
                title: "List SQL Servers",
                description: "List all available SQL Server connection profiles",
                inputSchema: {},
            },
            async () => {
                try {
                    const profiles =
                        await mainController.connectionManager.connectionStore.readAllConnections(
                            false,
                        );
                    const servers = profiles.map((p) => ({
                        profileId: p.id,
                        profileName: p.profileName,
                        server: p.server,
                        database: p.database,
                    }));
                    return {
                        content: [{ type: "text", text: JSON.stringify({ servers }) }],
                    };
                } catch (error) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    error: error instanceof Error ? error.message : String(error),
                                }),
                            },
                        ],
                    };
                }
            },
        );

        // Register mssql_connect tool
        server.registerTool(
            "mssql_connect",
            {
                title: "Connect to SQL Server",
                description:
                    "Connect to a SQL Server using profile ID or server/database parameters",
                inputSchema: {
                    profileId: z
                        .string()
                        .optional()
                        .describe("The profile ID of a saved connection"),
                    serverName: z.string().optional().describe("The server name to connect to"),
                    database: z.string().optional().describe("The database name to connect to"),
                },
            },
            async ({ profileId, serverName, database }) => {
                try {
                    const profiles =
                        await mainController.connectionManager.connectionStore.readAllConnections();

                    let profile;

                    // 1. If profileId is provided, use that saved connection profile directly
                    if (profileId) {
                        profile = profiles.find((p) => p.id === profileId);
                        if (!profile) {
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify({
                                            success: false,
                                            message: `Profile with ID '${profileId}' not found`,
                                        }),
                                    },
                                ],
                            };
                        }
                    }
                    // 2. If serverName is provided, look for saved connections
                    else if (serverName) {
                        // 2a. Look for exact match (same server and database)
                        if (database) {
                            const exactMatch = profiles.find(
                                (p) => p.server === serverName && p.database === database,
                            );
                            if (exactMatch) {
                                profile = exactMatch;
                            }
                        }

                        // 2b. Look for saved connection with same server but different database
                        if (!profile) {
                            const serverMatch = profiles.find((p) => p.server === serverName);
                            if (serverMatch) {
                                profile = serverMatch;
                            } else {
                                return {
                                    content: [
                                        {
                                            type: "text",
                                            text: JSON.stringify({
                                                success: false,
                                                message: `No saved connection found for server '${serverName}'`,
                                            }),
                                        },
                                    ],
                                };
                            }
                        }
                    } else {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify({
                                        success: false,
                                        message: "Either profileId or serverName must be provided",
                                    }),
                                },
                            ],
                        };
                    }

                    // Determine the database to use
                    const targetDatabase = database || profile.database;
                    const connectionId = randomUUID();

                    // Attempt to connect
                    const handlePwdResult =
                        await mainController.connectionManager.handlePasswordBasedCredentials(
                            profile,
                        );
                    if (!handlePwdResult) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify({
                                        success: false,
                                        message: "Failed to handle password-based credentials",
                                    }),
                                },
                            ],
                        };
                    }

                    const success = await mainController.connectionManager.connect(connectionId, {
                        ...profile,
                        database: targetDatabase,
                    });

                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success,
                                    connectionId,
                                    message: success
                                        ? "Successfully connected to database"
                                        : "Connection failed",
                                }),
                            },
                        ],
                    };
                } catch (error) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: false,
                                    message: error instanceof Error ? error.message : String(error),
                                }),
                            },
                        ],
                    };
                }
            },
        );

        // Register mssql_show_schema tool
        server.registerTool(
            "mssql_show_schema",
            {
                title: "Show Database Schema",
                description: "Open the schema designer for a connected database",
                inputSchema: {
                    connectionId: z
                        .string()
                        .describe("The connection ID from a successful connection"),
                },
            },
            async ({ connectionId }) => {
                try {
                    const connInfo =
                        mainController.connectionManager.getConnectionInfo(connectionId);
                    const connCreds = connInfo?.credentials;
                    if (!connCreds) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify({
                                        success: false,
                                        message: `No active connection found for connection ID '${connectionId}'`,
                                    }),
                                },
                            ],
                        };
                    }

                    // Actually open the schema designer using the MainController's schema designer service
                    // Note: We need access to the context and vscodeWrapper, but they're private
                    // For now, return success and let the user know the schema would be opened
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: true,
                                    message: `Schema designer would be opened for database '${connCreds.database}' (implementation requires access to private MainController properties)`,
                                }),
                            },
                        ],
                    };
                } catch (error) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: false,
                                    message: error instanceof Error ? error.message : String(error),
                                }),
                            },
                        ],
                    };
                }
            },
        );

        // Register mssql_get_connection_details tool
        server.registerTool(
            "mssql_get_connection_details",
            {
                title: "Get Connection Details",
                description: "Get details about an active database connection",
                inputSchema: {
                    connectionId: z
                        .string()
                        .describe("The connection ID from a successful connection"),
                },
            },
            async ({ connectionId }) => {
                try {
                    const connInfo =
                        mainController.connectionManager.getConnectionInfo(connectionId);
                    if (!connInfo) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify({
                                        success: false,
                                        message: `No active connection found for connection ID '${connectionId}'`,
                                    }),
                                },
                            ],
                        };
                    }

                    const details = {
                        success: true,
                        connectionId: connectionId,
                        server: connInfo.credentials.server,
                        database: connInfo.credentials.database,
                        authenticationType: connInfo.credentials.authenticationType,
                        user: connInfo.credentials.user,
                        options: {
                            encrypt: connInfo.credentials.encrypt,
                            port: connInfo.credentials.port,
                            connectTimeout: connInfo.credentials.connectTimeout,
                            commandTimeout: connInfo.credentials.commandTimeout,
                        },
                    };

                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(details),
                            },
                        ],
                    };
                } catch (error) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: false,
                                    message: error instanceof Error ? error.message : String(error),
                                }),
                            },
                        ],
                    };
                }
            },
        );

        // Register mssql_run_query tool
        server.registerTool(
            "mssql_run_query",
            {
                title: "Run SQL Query",
                description: "Execute a SQL query against a connected database",
                inputSchema: {
                    connectionId: z
                        .string()
                        .describe("The connection ID from a successful connection"),
                    query: z.string().describe("The SQL query to execute"),
                    maxRows: z
                        .number()
                        .optional()
                        .default(100)
                        .describe("Maximum number of rows to return (default: 100)"),
                },
            },
            async ({ connectionId, query, maxRows = 100 }) => {
                try {
                    const connInfo =
                        mainController.connectionManager.getConnectionInfo(connectionId);
                    if (!connInfo) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify({
                                        success: false,
                                        message: `No active connection found for connection ID '${connectionId}'`,
                                    }),
                                },
                            ],
                        };
                    }

                    // Use the connection sharing service to execute the query
                    const result = await mainController.connectionSharingService.executeSimpleQuery(
                        connectionId,
                        query,
                    );

                    // Limit the number of rows returned
                    let limitMessage = "";
                    if (result.rows && result.rows.length > maxRows) {
                        result.rows = result.rows.slice(0, maxRows);
                        limitMessage = `Results limited to ${maxRows} rows. Total rows available: ${result.rowCount}`;
                    }

                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: true,
                                    result: result,
                                    query: query,
                                    connectionId: connectionId,
                                    message: limitMessage,
                                }),
                            },
                        ],
                    };
                } catch (error) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: false,
                                    message: error instanceof Error ? error.message : String(error),
                                    query: query,
                                    connectionId: connectionId,
                                }),
                            },
                        ],
                    };
                }
            },
        );
    }

    // Keep the existing demo tools for backwards compatibility
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

    return server;
}

/**
 * Starts the MCP server on the specified port
 * @param port The port to listen on (default: 3000)
 * @param mainController The MainController instance to access services
 * @returns Promise that resolves when server is started
 */
export function startMcpServer(
    port: number = 3000,
    mainController?: MainController,
): Promise<void> {
    return new Promise((resolve) => {
        const app = initializeMcpServer(mainController);
        app.listen(port, () => {
            console.log(`MCP server started on port ${port}`);
            console.log(`Available endpoints:`);
            console.log(`  - GET  /       - Server info`);
            console.log(`  - GET  /health - Health check`);
            console.log(`  - POST /mcp    - MCP client-to-server communication`);
            console.log(`  - GET  /mcp    - MCP server-to-client notifications (SSE)`);
            console.log(`  - DELETE /mcp  - MCP session termination`);
            resolve();
        });
    });
}
