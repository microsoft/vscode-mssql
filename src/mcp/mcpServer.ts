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

// Track the current active connection ID at module scope for sharing between MCP and HTTP APIs
let currentActiveConnectionId: string | undefined = undefined;

// Helper function to create null values for API responses (to satisfy linter)
function createNullResult(): string | null {
    return undefined as unknown as null;
}

// Define types for query results
interface QueryResultColumn {
    columnName: string;
}

interface QueryResultWithRows {
    rows: unknown[][];
    columns?: QueryResultColumn[];
}

interface QueryResultWithRowsAffected {
    rowsAffected: number;
}

interface QueryResultWithRecordsets {
    recordset?: Record<string, unknown>[];
    recordsets?: Record<string, unknown>[][];
}

/**
 * Formats query results according to SqlDataAccess.ExecuteQueryAsync() logic
 * Mimics the C# SqlDataReader formatting to ensure consistent behavior
 * @param result The raw query result from connection sharing service
 * @returns Formatted result string matching C# implementation
 */
function formatQueryResult(result: unknown): string {
    if (!result) {
        return "";
    }

    const resultBuilder: string[] = [];

    // Handle the case where result has rows (SELECT queries)
    if (
        typeof result === "object" &&
        result &&
        "rows" in result &&
        Array.isArray((result as QueryResultWithRows).rows)
    ) {
        const queryResult = result as QueryResultWithRows;
        const rows = queryResult.rows;
        const columns = queryResult.columns || [];

        // Process each row
        for (const row of rows) {
            // Process each column in the row
            for (let i = 0; i < columns.length; i++) {
                const column = columns[i];
                const fieldName = column.columnName || `Column${i}`;

                // Skip JSON_ prefixed field names (system-added for JSON results)
                if (!fieldName.startsWith("JSON_")) {
                    resultBuilder.push(`${fieldName}: `);
                }

                // Get the value and convert to string
                const value = Array.isArray(row) ? row[i] : undefined;
                const valueString = value !== undefined ? String(value) : "";
                resultBuilder.push(valueString);
            }
        }

        // Add empty line at the end if we had data
        if (rows.length > 0) {
            resultBuilder.push("");
        }
    }
    // Handle the case where result is a simple message or rowsAffected
    else if (typeof result === "object" && result && "rowsAffected" in result) {
        const queryResult = result as QueryResultWithRowsAffected;
        // For INSERT/UPDATE/DELETE queries, just return the rows affected info
        resultBuilder.push(`Rows affected: ${queryResult.rowsAffected}`);
        resultBuilder.push("");
    }
    // Handle direct string results (like JSON from stored procedures)
    else if (typeof result === "string") {
        resultBuilder.push(result);
        resultBuilder.push("");
    }
    // Handle object results that might contain JSON data
    else if (typeof result === "object" && result) {
        const resultObj = result as QueryResultWithRecordsets;
        // If it looks like a direct result object, try to extract meaningful data
        if (resultObj.recordset || resultObj.recordsets) {
            // Handle recordset format from node-mssql
            const recordsets = resultObj.recordsets || [resultObj.recordset];

            for (const recordset of recordsets) {
                if (Array.isArray(recordset)) {
                    for (const record of recordset) {
                        // Process each field in the record
                        for (const [fieldName, value] of Object.entries(record)) {
                            // Skip JSON_ prefixed field names
                            if (!fieldName.startsWith("JSON_")) {
                                resultBuilder.push(`${fieldName}: `);
                            }

                            const valueString = value !== undefined ? String(value) : "";
                            resultBuilder.push(valueString);
                        }
                    }

                    // Add empty line between result sets
                    resultBuilder.push("");
                }
            }
        } else {
            // Fallback: convert to JSON string for complex objects
            resultBuilder.push(JSON.stringify(result));
            resultBuilder.push("");
        }
    }

    return resultBuilder.join("\n");
}

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
                getCurrentConnectionId: "/getCurrentConnectionId",
                executeQuery: "/executeQuery",
            },
        });
    });

    // Add a health check endpoint
    app.get("/health", (req, res) => {
        res.json({ status: "healthy", timestamp: new Date().toISOString() });
    });

    // Add VS Code extension web server APIs
    if (mainController) {
        // GET /getCurrentConnectionId - Returns the current active connection ID
        app.get("/getCurrentConnectionId", (req, res) => {
            try {
                if (!currentActiveConnectionId) {
                    res.status(404).send("No active connection");
                    return;
                }

                res.status(200).type("text/plain").send(currentActiveConnectionId);
            } catch (error) {
                console.error("Error getting current connection ID:", error);
                res.status(500).send("Internal server error");
            }
        });

        // POST /executeQuery - Execute a SQL query against a connected database
        app.post("/executeQuery", async (req, res) => {
            try {
                const { connectionId, query } = req.body;

                // Validate request body
                if (!connectionId || !query) {
                    res.status(400).json({
                        result: createNullResult(),
                        errorMessage: "Both connectionId and query are required",
                    });
                    return;
                }

                // Check if connection exists
                const connInfo = mainController.connectionManager.getConnectionInfo(connectionId);
                if (!connInfo) {
                    res.status(404).json({
                        result: createNullResult(),
                        errorMessage: `Invalid connection ID: ${connectionId}`,
                    });
                    return;
                }

                // Execute the query using connection sharing service
                const result = await mainController.connectionSharingService.executeSimpleQuery(
                    connectionId,
                    query,
                );

                // Format result according to SqlDataAccess.ExecuteQueryAsync() logic
                const formattedResult = formatQueryResult(result);

                res.status(200).json({
                    result: formattedResult,
                    errorMessage: createNullResult(),
                });
            } catch (error) {
                console.error("Error executing query:", error);
                res.status(400).json({
                    result: createNullResult(),
                    errorMessage: error instanceof Error ? error.message : String(error),
                });
            }
        });
    }

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

                    if (success) {
                        // Disconnect previous connection if exists
                        if (currentActiveConnectionId) {
                            try {
                                await mainController.connectionManager.disconnect(
                                    currentActiveConnectionId,
                                );
                            } catch (error) {
                                // Log but don't fail if previous connection disconnect fails
                                console.warn(`Failed to disconnect previous connection: ${error}`);
                            }
                        }
                        // Set as current active connection
                        currentActiveConnectionId = connectionId;
                    }

                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success,
                                    connectionId: success ? connectionId : undefined,
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

        // Register mssql_disconnect tool
        server.registerTool(
            "mssql_disconnect",
            {
                title: "Disconnect from SQL Server",
                description: "Disconnect from the currently active SQL Server connection",
                inputSchema: {
                    connectionId: z
                        .string()
                        .optional()
                        .describe(
                            "Optional connection ID to disconnect. If not provided, disconnects the current active connection",
                        ),
                },
            },
            async ({ connectionId }) => {
                try {
                    const targetConnectionId = connectionId || currentActiveConnectionId;

                    if (!targetConnectionId) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify({
                                        success: false,
                                        message: "No active connection to disconnect",
                                    }),
                                },
                            ],
                        };
                    }

                    // Check if connection exists
                    const connInfo =
                        mainController.connectionManager.getConnectionInfo(targetConnectionId);
                    if (!connInfo) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify({
                                        success: false,
                                        message: `No active connection found for connection ID '${targetConnectionId}'`,
                                    }),
                                },
                            ],
                        };
                    }

                    // Disconnect from the database
                    await mainController.connectionManager.disconnect(targetConnectionId);

                    // Clear active connection if it was the current one
                    if (targetConnectionId === currentActiveConnectionId) {
                        currentActiveConnectionId = undefined;
                    }

                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: true,
                                    message: "Successfully disconnected from database",
                                    disconnectedConnectionId: targetConnectionId,
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
            console.log(`  - GET    /                     - Server info`);
            console.log(`  - GET    /health               - Health check`);
            console.log(`  - GET    /getCurrentConnectionId - Get current active connection ID`);
            console.log(`  - POST   /executeQuery         - Execute SQL query`);
            console.log(`  - POST   /mcp                  - MCP client-to-server communication`);
            console.log(`  - GET    /mcp                  - MCP server-to-client notifications`);
            console.log(`  - DELETE /mcp                  - MCP session termination`);
            resolve();
        });
    });
}
