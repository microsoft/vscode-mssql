import { IConnectionProfile } from "azdata";
import * as vscode from "vscode";
import * as mssql from "vscode-mssql";

const MSSQL_EXTENSION_ID = "ms-mssql.mssql";

interface ConnectionSharingApi {
    service: mssql.IAuthenticatedConnectionSharingService;
    accessToken: string;
}

/**
 * Gets the MSSQL connection-sharing API and an access token for it. The first time, VS Code asks
 * the user to allow this extension to use their SQL Server connections. The user can revoke that
 * later from the Accounts menu.
 */
export async function getConnectionSharingApi(): Promise<ConnectionSharingApi | undefined> {
    const mssqlExtension = vscode.extensions.getExtension<mssql.IExtension>(MSSQL_EXTENSION_ID);
    if (!mssqlExtension) {
        vscode.window.showErrorMessage(
            "MSSQL extension is not installed. Please install it first.",
        );
        return;
    }

    const service = (await mssqlExtension.activate())?.authenticatedConnectionSharing;
    if (!service) {
        vscode.window.showErrorMessage("Connection sharing service is not available");
        return;
    }

    const session = await vscode.authentication.getSession(service.authenticationProviderId, [], {
        createIfNone: true,
    });
    return { service, accessToken: session.accessToken };
}

export function activate(extensionContext: vscode.ExtensionContext) {
    console.log("Connection Sharing Sample extension is now active!");

    // Register all available commands with VS Code
    registerCommands(extensionContext);
}

export function registerCommands(extensionContext: vscode.ExtensionContext) {
    extensionContext.subscriptions.push(
        vscode.commands.registerCommand(
            "connection-sharing-sample.apis",
            connectionSharingWithApis,
        ),
    );

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand(
            "connection-sharing-sample.availableConnections",
            showAvailableConnections,
        ),
    );

    /**
     * Example of registering a command that receives a tree node with a connection profile
     * and generates a connection string from it.
     */
    extensionContext.subscriptions.push(
        vscode.commands.registerCommand(
            "connection-sharing-sample.customObjectExplorerDatabaseCommand",
            async (treeNode) => {
                const connectionProfile = treeNode.connectionProfile;
                const api = await getConnectionSharingApi();
                if (!api) {
                    return;
                }
                const connectionString = await api.service.getConnectionString(
                    api.accessToken,
                    connectionProfile.id,
                );
                console.log(`Generated connection string: ${connectionString}`);
                vscode.window.showInformationMessage(`Connection string generated`);
            },
        ),
    );
}

async function connectionSharingWithApis() {
    try {
        const api = await getConnectionSharingApi();
        if (!api) {
            return;
        }
        const { service, accessToken } = api;

        const activeConnectionId = await service.getActiveEditorConnectionId(accessToken);
        if (!activeConnectionId) {
            vscode.window.showErrorMessage("No database connection found for the active editor");
            return;
        }

        console.log(`Retrieved connection ID: ${activeConnectionId}`);

        const connectionString = await service.getConnectionString(accessToken, activeConnectionId);
        if (connectionString) {
            console.log(`Connection string: ${connectionString}`);
            vscode.window.showInformationMessage(
                `Retrieved connection string for connection ${activeConnectionId}`,
            );
        } else {
            console.log("Unable to retrieve connection string");
        }

        const activeDatabase = await service.getActiveDatabase(accessToken);
        if (activeDatabase) {
            console.log(`Active database: ${activeDatabase}`);
            vscode.window.showInformationMessage(
                `Currently connected to database: ${activeDatabase}`,
            );
        } else {
            console.log("No active database or unable to retrieve database name");
        }

        const databaseForConnection = await service.getDatabaseForConnectionId(
            accessToken,
            activeConnectionId,
        );
        if (databaseForConnection) {
            console.log(`Database for connection ${activeConnectionId}: ${databaseForConnection}`);
        } else {
            console.log(`No database configured for connection ${activeConnectionId}`);
        }

        // Queries and other connection-URI methods only accept URIs that connect() returned.
        const databaseConnectionUri = await service.connect(accessToken, activeConnectionId);
        console.log(`Connected successfully. URI: ${databaseConnectionUri}`);

        try {
            const serverInformation = await service.getServerInfo(
                accessToken,
                databaseConnectionUri,
            );
            console.log("Server information:", serverInformation);

            const databaseListResults = await service.executeSimpleQuery(
                accessToken,
                databaseConnectionUri,
                "SELECT TOP(10) name AS DatabaseName FROM sys.databases ORDER BY name",
            );
            console.log("Database query results:", databaseListResults);

            const script = await service.scriptObject(accessToken, databaseConnectionUri, 0, {
                name: "databases",
                schema: "sys",
                type: "Table",
            });
            console.log("Script:", script);
        } finally {
            await service.disconnect(accessToken, databaseConnectionUri);
            console.log(`Disconnected successfully from: ${databaseConnectionUri}`);
        }

        // Show success message to user
        vscode.window.showInformationMessage("Connection sharing API demo completed successfully!");
    } catch (error) {
        console.error("Error in API-based connection sharing demo:", error);
        vscode.window.showErrorMessage(`API demo failed: ${error}`);
    }
}

async function showAvailableConnections(): Promise<void> {
    try {
        // Retrieve configured connections from VS Code settings
        const configuredConnections = vscode.workspace
            .getConfiguration("mssql")
            .inspect("connections")?.globalValue as IConnectionProfile[];

        if (!configuredConnections || configuredConnections.length === 0) {
            vscode.window.showInformationMessage(
                "No database connections configured. Please set up connections in VS Code settings.",
            );
            return;
        }

        // Display connection count and details
        const connectionCount = configuredConnections.length;

        vscode.window.showInformationMessage(`Found ${connectionCount} configured connection(s).`);
    } catch (error) {
        console.error("Error retrieving available connections:", error);
        vscode.window.showErrorMessage(`Failed to retrieve connections: ${error}`);
    }
}
