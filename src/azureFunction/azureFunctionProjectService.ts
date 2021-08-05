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
        await afApi.createFunction({
            language: 'C#',
            templateId: 'HttpTrigger'
        });

        // TODO:
        // 1. figure out the newly created file - alanren
        let filePath = '';
        console.log(filePath);

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
}