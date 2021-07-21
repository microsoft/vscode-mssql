/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as af from '../../typings/vscode-azurefunctions.api';

export class AzureFunctionProjectService {
    public async createAzureFunctionProject(tableName: string): Promise<void> {
        const afApi = await this.getAzureFunctionsExtensionApi();
        if (!afApi) {
            return;
        }
        await afApi.createFunction({
            language: 'C#',
            templateId: 'HttpTrigger',
            functionName: `${tableName}-endpoint`
        });
    }

    private async getAzureFunctionsExtensionApi(): Promise<af.AzureFunctionsExtensionApi> {
        const afExtension = vscode.extensions.getExtension('ms-azuretools.vscode-azurefunctions');
        if (afExtension) {
            let afApi;
            if (!afExtension.isActive) {
                afApi = await afExtension.activate();
            } else {
                afApi = afExtension.exports;
            }
            return afApi.getApi('*') as af.AzureFunctionsExtensionApi;
        } else {
            vscode.window.showErrorMessage('--dependency missing--');
            return undefined;
        }
    }
}