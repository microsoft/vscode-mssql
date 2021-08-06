/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as af from '../../typings/vscode-azurefunctions.api';
import { azureFunctionsExtensionName } from '../constants/constants';
import LocalizedConstants = require('../constants/localizedConstants');
export class AzureFunctionProjectService {
    public async createAzureFunction(tableName: string): Promise<void> {
        const afApi = await this.getAzureFunctionsExtensionApi();
        if (!afApi) {
            return;
        }
        if (!await this.isAzureFunctionProjectOpen()) {
            vscode.window.showErrorMessage(LocalizedConstants.azureFunctionsProjectMustBeOpened);
            return;
        }

        // because of an AF extension API issue, we have to get the newly created file by adding a watcher: https://github.com/microsoft/vscode-azurefunctions/issues/2908
        const newFilePromise = this.getNewFunctionFile();

        await afApi.createFunction({
            language: 'C#',
            templateId: 'HttpTrigger'
        });


        const functionFile = await newFilePromise;

        // TODO:

        // 2. leverage STS to add sql binding - aditya
        //

        // 3. edit the csproj to add the sql binding package

        // 4. retrieve connection string from OE - aditya

        // 5. add connectionstring to local.settings.json
    }

    private async getAzureFunctionsExtensionApi(): Promise<af.AzureFunctionsExtensionApi> {
        const afExtension = vscode.extensions.getExtension(azureFunctionsExtensionName);
        if (afExtension) {
            let afApi;
            if (!afExtension.isActive) {
                afApi = await afExtension.activate();
            } else {
                afApi = afExtension.exports;
            }
            return afApi.getApi('*') as af.AzureFunctionsExtensionApi;
        } else {
            vscode.window.showErrorMessage(LocalizedConstants.azureFunctionsExtensionNotInstalled);
            return undefined;
        }
    }

    private async isAzureFunctionProjectOpen(): Promise<boolean> {
        if (vscode.workspace.workspaceFolders.length === 0) { return false; }
        const projFiles = await vscode.workspace.findFiles('**/*.csproj');
        const hostFiles = await vscode.workspace.findFiles('**/host.json');
        return projFiles.length > 0 && hostFiles.length > 0;
    }

    private getNewFunctionFile(): Promise<string> {
        return new Promise((resolve) => {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.workspace.workspaceFolders[0], '**/*.cs'), false, true, true);
            watcher.onDidCreate((e) => {
                resolve(e.fsPath);
                watcher.dispose();
            });

        });
    }
}