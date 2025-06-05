// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { IConnectionProfile } from 'azdata';
import * as vscode from 'vscode';
import * as mssql from 'vscode-mssql';

const extensionId = 'ms-mssql.connection-sharing-sample';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "connection-sharing-sample" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	context.subscriptions.push(vscode.commands.registerCommand('connection-sharing-sample.commands', async () => {
		const connectionId = await vscode.commands.executeCommand('mssql.connectionSharing.getConnectionIdForActiveEditor', extensionId);
		console.log(`Connection ID for active editor: ${connectionId}`);

		const connectionUri = await vscode.commands.executeCommand('mssql.connectionSharing.connect', extensionId, connectionId);

		const serverInfo = await vscode.commands.executeCommand('mssql.connectionSharing.getServerInfo', connectionUri);
		console.log(`Server Info:`, serverInfo);

		const executeQuery = await vscode.commands.executeCommand('mssql.connectionSharing.executeSimpleQuery', connectionUri, "SELECT TOP(10) name FROM sys.databases");
		console.log(`Query executed:`, executeQuery);

		await vscode.commands.executeCommand('mssql.connectionSharing.disconnect', connectionUri);
		console.log(`Disconnected from connection: ${connectionUri}`);
	}));



	context.subscriptions.push(vscode.commands.registerCommand('connection-sharing-sample.apis', async () => {
		const mssqlExtension = vscode.extensions.getExtension("ms-mssql.mssql");
		if (!mssqlExtension) {
			vscode.window.showErrorMessage("MSSQL extension is not installed");
			return;
		}

		await mssqlExtension.activate();

		const mssqlApi = mssqlExtension.exports as any;
		if (!mssqlApi) {
			vscode.window.showErrorMessage("MSSQL API is not available");
			return;
		}

		const connectionSharingApi = mssqlApi.connectionSharing as mssql.IConnectionSharingService;
		if (!connectionSharingApi) {
			vscode.window.showErrorMessage("Connection Sharing API is not available");
			return;
		}

		const connectionId = await connectionSharingApi.getConnectionIdForActiveEditor(extensionId);
		if (!connectionId) {
			vscode.window.showErrorMessage("No connection ID found for the active editor");
			return;
		}

		const connectionUri = await connectionSharingApi.connect(extensionId, connectionId);
		if (!connectionUri) {
			vscode.window.showErrorMessage("Failed to connect using the connection ID");
			return;
		}

		const serverInfo = await connectionSharingApi.getServerInfo(connectionUri);
		if (!serverInfo) {
			vscode.window.showErrorMessage("Failed to retrieve server info");
			return;
		}	

		console.log(`Server Info:`, serverInfo);

		const executeQuery = await connectionSharingApi.executeSimpleQuery(connectionUri, "SELECT TOP(10) name FROM sys.databases");
		if (!executeQuery) {
			vscode.window.showErrorMessage("Failed to execute query");
			return;
		}
		console.log(`Query executed:`, executeQuery);

		await connectionSharingApi.disconnect(connectionUri);
		console.log(`Disconnected from connection: ${connectionUri}`);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('connection-sharing-sample.availableConnections', async () => {
		const connections = vscode.workspace.getConfiguration("mssql").inspect('connections')?.globalValue as IConnectionProfile[];
		if (!connections) {
			vscode.window.showInformationMessage("No available connections found.");
			return;
		}
		vscode.window.showInformationMessage(`Total available connections: ${connections.length}`);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('connection-sharing-sample.requestApproval', async () => {
		await vscode.commands.executeCommand( "mssql.connectionSharing.editConnectionSharingPermissions", extensionId);
	}));
}

// This method is called when your extension is deactivated
export function deactivate() { }
