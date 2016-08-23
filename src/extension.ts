'use strict';
import vscode = require('vscode');
import MainController from './controllers/controller';

let controller: MainController = undefined;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext): void {
    controller = new MainController(context);
    context.subscriptions.push(controller);
    controller.activate();
}

// this method is called when your extension is deactivated
export function deactivate(): void {
    if (controller) {
        controller.deactivate();
    }
}

// Exposed for testing purposes
export function getController(): MainController {
    return controller;
}
