'use strict';
import vscode = require('vscode');
import MainController from './controllers/controller';

let controller: MainController = undefined;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext)
{
    controller = new MainController(context);
	context.subscriptions.push(controller);
	controller.activate();
}

// this method is called when your extension is deactivated
export function deactivate()
{
    if(controller) {
        controller.deactivate();
    }
}