// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "connection-sharing-sample" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('connection-sharing-sample.helloWorld', async () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from Connection Sharing Sample!');

		const connectionId = await vscode.commands.executeCommand('mssql.connectionSharing.getConnectionIdForActiveEditor', "connection-sharing-sample");
		console.log(`Connection ID for active editor: ${connectionId}`);

		const connectionUri = await vscode.commands.executeCommand('mssql.connectionSharing.connect', "connection-sharing-sample", connectionId);

		const executeQuery = await vscode.commands.executeCommand('mssql.connectionSharing.executeSimpleQuery',connectionUri, "SELECT TOP(10) name FROM sys.databases");
		console.log(`Query executed:`, executeQuery);
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
