import { IConnectionProfile } from "azdata";
import * as vscode from "vscode";
import * as mssql from "vscode-mssql";

const EXTENSION_ID = "ms-mssql.connection-sharing-sample";
const MSSQL_EXTENSION_ID = "ms-mssql.mssql";

export function activate(extensionContext: vscode.ExtensionContext) {
    console.log("Connection Sharing Sample extension is now active!");

    // Register all available commands with VS Code
    registerCommands(extensionContext);
}

export function registerCommands(extensionContext: vscode.ExtensionContext) {
    extensionContext.subscriptions.push(
        vscode.commands.registerCommand(
            "connection-sharing-sample.commands",
            connectionSharingWithCommands,
        ),
    );

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

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand(
            "connection-sharing-sample.requestApproval",
            requestConnectionSharingPermissions,
        ),
    );
}

async function connectionSharingWithCommands() {
    try {
        console.log("--- Starting Connection Sharing Demo (Commands Approach) ---");

        const activeConnectionId = (await vscode.commands.executeCommand(
            "mssql.connectionSharing.getActiveEditorConnectionId",
            EXTENSION_ID,
        )) as string;

        if (!activeConnectionId) {
            vscode.window.showErrorMessage("No database connection found for the active editor");
            return;
        }

        console.log(`Active connection ID: ${activeConnectionId}`);

        // New feature: Get the connection string for the active connection
        const connectionString = (await vscode.commands.executeCommand(
            "mssql.connectionSharing.getConnectionString",
            EXTENSION_ID,
            activeConnectionId,
        )) as string;

        if (connectionString) {
            console.log(`Connection string: ${connectionString}`);
            vscode.window.showInformationMessage(
                `Retrieved connection string for connection ${activeConnectionId}`,
            );
        } else {
            console.log("Unable to retrieve connection string");
        }

        // New feature: Get the active database name using command approach
        const activeDatabase = (await vscode.commands.executeCommand(
            "mssql.connectionSharing.getActiveDatabase",
            EXTENSION_ID,
        )) as string;

        if (activeDatabase) {
            console.log(`Active database: ${activeDatabase}`);
            vscode.window.showInformationMessage(
                `Currently connected to database: ${activeDatabase}`,
            );
        } else {
            console.log("No active database or unable to retrieve database name");
        }

        // New feature: Get database name for a specific connection ID
        const databaseForConnection = (await vscode.commands.executeCommand(
            "mssql.connectionSharing.getDatabaseForConnectionId",
            EXTENSION_ID,
            activeConnectionId,
        )) as string;

        if (databaseForConnection) {
            console.log(`Database for connection ${activeConnectionId}: ${databaseForConnection}`);
        } else {
            console.log(`No database configured for connection ${activeConnectionId}`);
        }

        const databaseConnectionUri = (await vscode.commands.executeCommand(
            "mssql.connectionSharing.connect",
            EXTENSION_ID,
            activeConnectionId,
        )) as string;

        if (!databaseConnectionUri) {
            vscode.window.showErrorMessage("Failed to establish database connection");
            return;
        }

        console.log(`Successfully connected. Connection URI: ${databaseConnectionUri}`);

        const databaseServerInfo = await vscode.commands.executeCommand(
            "mssql.connectionSharing.getServerInfo",
            databaseConnectionUri,
        );

        console.log("Database server information:", databaseServerInfo);

        const queryResults = await vscode.commands.executeCommand(
            "mssql.connectionSharing.executeSimpleQuery",
            databaseConnectionUri,
            "SELECT TOP(10) name AS DatabaseName FROM sys.databases ORDER BY name",
        );

        console.log("Query results (Top 10 databases):", queryResults);

        await vscode.commands.executeCommand(
            "mssql.connectionSharing.disconnect",
            databaseConnectionUri,
        );
        console.log(`Successfully disconnected from: ${databaseConnectionUri}`);
    } catch (error) {
        console.error("Error in connection sharing demo:", error);
        vscode.window.showErrorMessage(`Connection sharing demo failed: ${error}`);
    }
}

async function connectionSharingWithApis() {
    try {
        console.log("--- Starting Connection Sharing Demo (Direct API Approach) ---");

        const mssqlExtension = vscode.extensions.getExtension(MSSQL_EXTENSION_ID);
        if (!mssqlExtension) {
            vscode.window.showErrorMessage(
                "MSSQL extension is not installed. Please install it first.",
            );
            return;
        }

        await mssqlExtension.activate();

        const mssqlExtensionApi = mssqlExtension.exports as any;
        if (!mssqlExtensionApi) {
            vscode.window.showErrorMessage("Unable to access MSSQL extension API");
            return;
        }

        const connectionSharingService =
            mssqlExtensionApi.connectionSharing as mssql.IConnectionSharingService;
        if (!connectionSharingService) {
            vscode.window.showErrorMessage("Connection sharing service is not available");
            return;
        }

        const activeConnectionId =
            await connectionSharingService.getActiveEditorConnectionId(EXTENSION_ID);
        if (!activeConnectionId) {
            vscode.window.showErrorMessage("No database connection found for the active editor");
            return;
        }

        console.log(`Retrieved connection ID: ${activeConnectionId}`);

        // New feature: Get the connection string for the active connection
        const connectionString = await connectionSharingService.getConnectionString(
            EXTENSION_ID,
            activeConnectionId,
        );
        if (connectionString) {
            console.log(`Connection string: ${connectionString}`);
            vscode.window.showInformationMessage(
                `Retrieved connection string for connection ${activeConnectionId}`,
            );
        } else {
            console.log("Unable to retrieve connection string");
        }

        // New feature: Get the active database name
        const activeDatabase = await connectionSharingService.getActiveDatabase(EXTENSION_ID);
        if (activeDatabase) {
            console.log(`Active database: ${activeDatabase}`);
            vscode.window.showInformationMessage(
                `Currently connected to database: ${activeDatabase}`,
            );
        } else {
            console.log("No active database or unable to retrieve database name");
        }

        // New feature: Get database name for a specific connection ID
        const databaseForConnection = await connectionSharingService.getDatabaseForConnectionId(
            EXTENSION_ID,
            activeConnectionId,
        );
        if (databaseForConnection) {
            console.log(`Database for connection ${activeConnectionId}: ${databaseForConnection}`);
        } else {
            console.log(`No database configured for connection ${activeConnectionId}`);
        }

        const databaseConnectionUri = await connectionSharingService.connect(
            EXTENSION_ID,
            activeConnectionId,
        );
        if (!databaseConnectionUri) {
            vscode.window.showErrorMessage("Failed to establish database connection");
            return;
        }

        console.log(`Connected successfully. URI: ${databaseConnectionUri}`);

        const serverInformation =
            await connectionSharingService.getServerInfo(databaseConnectionUri);
        if (!serverInformation) {
            vscode.window.showErrorMessage("Failed to retrieve database server information");
            return;
        }

        console.log("Server information:", serverInformation);

        const databaseListResults = await connectionSharingService.executeSimpleQuery(
            databaseConnectionUri,
            "SELECT TOP(10) name AS DatabaseName FROM sys.databases ORDER BY name",
        );

        if (!databaseListResults) {
            vscode.window.showErrorMessage("Failed to execute database query");
            return;
        }

        console.log("Database query results:", databaseListResults);

        const script = await connectionSharingService.scriptObject(databaseConnectionUri, 0, {
            name: "databases",
            schema: "sys",
            type: "Table",
        });

        await connectionSharingService.disconnect(databaseConnectionUri);
        console.log(`Disconnected successfully from: ${databaseConnectionUri}`);

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

async function requestConnectionSharingPermissions(): Promise<void> {
    try {
        console.log("Opening connection sharing permissions dialog...");

        const result = await vscode.commands.executeCommand(
            "mssql.connectionSharing.editConnectionSharingPermissions",
            EXTENSION_ID,
        );

        if (result === "approved") {
            vscode.window.showInformationMessage(
                "Connection sharing permissions approved successfully.",
            );
        } else if (result === "denied") {
            vscode.window.showWarningMessage("Connection sharing permissions were denied.");
        } else {
            vscode.window.showInformationMessage(
                "Connection sharing permissions dialog closed without action.",
            );
        }
    } catch (error) {
        console.error("Error opening permissions dialog:", error);
        vscode.window.showErrorMessage(`Failed to open permissions dialog: ${error}`);
    }
}
