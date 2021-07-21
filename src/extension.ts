/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import vscode = require('vscode');
import Constants = require('./constants/constants');
import * as LocalizedConstants from './constants/localizedConstants';
import MainController from './controllers/mainController';
import VscodeWrapper from './controllers/vscodeWrapper';
import { IConnectionInfo, IExtension } from 'vscode-mssql';

let controller: MainController = undefined;

export async function activate(context: vscode.ExtensionContext): Promise<IExtension> {
    let vscodeWrapper = new VscodeWrapper();
    controller = new MainController(context, undefined, vscodeWrapper);
    context.subscriptions.push(controller);

    // Checking if localization should be applied
    let config = vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);
    let applyLocalization = config[Constants.configApplyLocalization];
    if (applyLocalization) {
        LocalizedConstants.loadLocalizedConstants(vscode.env.language);
    }

    // Exposed for testing purposes
    vscode.commands.registerCommand('mssql.getControllerForTests', () => controller);
    await controller.activate();
    return {
        promptForConnection: (ignoreFocusOut?: boolean) => {
            return controller.connectionManager.connectionUI.promptForConnection(ignoreFocusOut);
        },
        listDatabases: (connectionInfo: IConnectionInfo) => {
            return controller.connectionManager.listDatabases(connectionInfo);
        },
        dacFx: controller.dacFxService
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
        let savedController: MainController = await vscode.commands.executeCommand('mssql.getControllerForTests');
        return savedController;
    }
    return controller;
}
