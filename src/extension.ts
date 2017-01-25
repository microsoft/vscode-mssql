'use strict';
import vscode = require('vscode');
import Constants = require('./models/constants');
import MainController from './controllers/mainController';

let controller: MainController = undefined;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext): Promise<boolean> {
    controller = new MainController(context);
    context.subscriptions.push(controller);
    Constants.loadLocalizedConstants(vscode.env.language);
    return controller.activate();
}

// this method is called when your extension is deactivated
export function deactivate(): void {
    if (controller) {
        controller.deactivate();
    }
}

/**
 * Exposed for testing purposes
 */
export function getController(): MainController {
    return controller;
}
