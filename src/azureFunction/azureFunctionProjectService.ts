/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as os from 'os';
import * as vscode from 'vscode';
import * as af from '../../typings/vscode-azurefunctions.api';
import * as fs from 'fs';
import * as mssql from 'vscode-mssql';
import { azureFunctionsExtensionName, defaultBindingResult, defaultSqlBindingTextLines, genericCollectionImport, sqlBindingResult, sqlConnectionString } from '../constants/constants';
import * as LocalizedConstants from '../constants/localizedConstants';
import { AzureFunctionsService } from '../services/azureFunctionsService';
import * as azureFunctionUtils from '../azureFunction/azureFunctionUtils';
import * as constants from '../constants/constants';
import * as path from 'path';


// const sqlBindingNugetSource = 'https://www.myget.org/F/azure-appservice/api/v3/index.json';
// const sqlBindingPackageName = 'Microsoft.Azure.WebJobs.Extensions.Sql';
const sqlConnectionStringPropertyName = 'SqlConnectionString';

export class AzureFunctionProjectService {

    constructor(private azureFunctionsService: AzureFunctionsService) {
    }

    public async createAzureFunction(connectionString: string, schema: string, table: string): Promise<void> {
        const azureFunctionApi = await this.getAzureFunctionsExtensionApi();
        if (!azureFunctionApi) {
            return;
        }
        if (!await this.isAzureFunctionProjectOpen()) {
            vscode.window.showErrorMessage(LocalizedConstants.azureFunctionsProjectMustBeOpened);
            return;
        }

        // because of an AF extension API issue, we have to get the newly created file by adding
        // a watcher: https://github.com/microsoft/vscode-azurefunctions/issues/2908
        const newFilePromise = this.getNewFunctionFile();

        // get function name from user
        const functionName = await vscode.window.showInputBox({
            title: 'Function Name',
            value: 'HttpTrigger1'
        });

        await azureFunctionApi.createFunction({
            language: 'C#',
            templateId: 'HttpTrigger',
            functionName: functionName
        });

        await this.addNugetReferenceToProjectFile();
        await this.addConnectionStringToConfig(connectionString);
        const functionFile = await newFilePromise;


        await this.azureFunctionsService.addSqlBinding(
            mssql.BindingType.input,
            functionFile,
            functionName,
            schema + '.' + table,
            sqlConnectionString
        );

        this.refactorAzureFunction(functionFile);
    }

    private async getAzureFunctionsExtensionApi(): Promise<af.AzureFunctionsExtensionApi> {
        const afExtension = vscode.extensions.getExtension(azureFunctionsExtensionName);
        if (afExtension) {
            let azureFunctionApi;
            if (!afExtension.isActive) {
                azureFunctionApi = await afExtension.activate();
            } else {
                azureFunctionApi = afExtension.exports;
            }
            return azureFunctionApi.getApi('*') as af.AzureFunctionsExtensionApi;
        } else {
            vscode.window.showErrorMessage(LocalizedConstants.azureFunctionsExtensionNotInstalled);
            return undefined;
        }
    }

    private refactorAzureFunction(filePath: string): void {
        let defaultBindedFunctionText = fs.readFileSync(filePath, 'utf-8');
        // Add missing import for Enumerable
        let newValue = genericCollectionImport + os.EOL + defaultBindedFunctionText;
        // Replace default binding text
        let newValueLines = newValue.split(os.EOL);
        const defaultLineSet = new Set(defaultSqlBindingTextLines);
        let replacedValueLines = [];
        for (let defaultLine of newValueLines) {
            // Skipped lines
            if (defaultLineSet.has(defaultLine.trimStart())) {
                continue;
            } else if (defaultLine.trimStart() === defaultBindingResult) { // Result change
                replacedValueLines.push(defaultLine.replace(defaultBindingResult, sqlBindingResult));
            } else {
                // Normal lines to be included
                replacedValueLines.push(defaultLine);
            }
        }
        newValue = replacedValueLines.join(os.EOL);
        fs.writeFileSync(filePath, newValue, 'utf-8');
    }

    private async isAzureFunctionProjectOpen(): Promise<boolean> {
        if (vscode.workspace.workspaceFolders === undefined || vscode.workspace.workspaceFolders.length === 0) { return false; }
        const projFile = await this.getProjectFile();
        const hostFile = await this.getHostFile();
        return projFile !== undefined && hostFile !== undefined;
    }

    private async getProjectFile(): Promise<string | undefined> {
        const projFiles = await vscode.workspace.findFiles('**/*.csproj');
        return projFiles.length > 0 ? projFiles[0].fsPath : undefined;
    }

    private async getHostFile(): Promise<string | undefined> {
        const hostFiles = await vscode.workspace.findFiles('**/host.json');
        return hostFiles.length > 0 ? hostFiles[0].fsPath : undefined;
    }

    private async getSettingsFile(): Promise<string | undefined> {
        const settingsFiles = await vscode.workspace.findFiles('**/local.settings.json');
        return settingsFiles.length > 0 ? settingsFiles[0].fsPath : undefined;
    }

    private getNewFunctionFile(): Promise<string> {
        return new Promise((resolve) => {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(
                vscode.workspace.workspaceFolders[0], '**/*.cs'), false, true, true);
            watcher.onDidCreate((e) => {
                resolve(e.fsPath);
                watcher.dispose();
            });
        });
    }

    private async addNugetReferenceToProjectFile(): Promise<void> {
        // Make sure the nuget source is added
        const projFile = await this.getProjectFile();
        azureFunctionUtils.addPackageToAFProjectContainingFile(vscode.Uri.file(projFile), constants.sqlExtensionPackageName);
    }

    private async addConnectionStringToConfig(connectionString: string): Promise<void> {
        const settingsFile = await this.getSettingsFile();
        const content = await fs.promises.readFile(settingsFile);
        const config = JSON.parse(content.toString());

        if (!(sqlConnectionStringPropertyName in config.Values)) {
            await azureFunctionUtils.setLocalAppSetting(path.dirname(settingsFile), sqlConnectionStringPropertyName, connectionString);
        }
    }
}
