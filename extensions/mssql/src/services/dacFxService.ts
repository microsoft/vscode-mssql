/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import * as dacFxContracts from "../models/contracts/dacFx/dacFxContracts";
import type * as mssql from "vscode-mssql";
import { ExtractTarget, TaskExecutionMode } from "../sharedInterfaces/schemaCompare";
import { SqlTasksService } from "./sqlTasksService";
import * as path from "path";
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { PlatformInformation } from "../models/platform";

export class DacFxService implements mssql.IDacFxService {
    constructor(
        private _client: SqlToolsServiceClient,
        sqlTasksService: SqlTasksService,
    ) {
        this.registerTaskCompletionHandlers(sqlTasksService);
    }

    /**
     * Register task completion handlers for dacpac operations
     */
    private registerTaskCompletionHandlers(sqlTasksService: SqlTasksService): void {
        const platformInfo = new PlatformInformation(process.platform, process.arch, undefined);

        // Determine the OS-specific reveal button text
        let revealButtonText: string;
        if (platformInfo.isMacOS) {
            revealButtonText = LocalizedConstants.DacpacDialog.RevealInFinder;
        } else if (platformInfo.isWindows) {
            revealButtonText = LocalizedConstants.DacpacDialog.RevealInExplorer;
        } else {
            // Linux and other platforms
            revealButtonText = LocalizedConstants.DacpacDialog.OpenContainingFolder;
        }

        // Register handler for Export BACPAC operation
        sqlTasksService.registerCompletionSuccessHandler({
            operationName: Constants.operationIdExportBacpac,
            getTargetLocation: (taskInfo) => taskInfo.targetLocation,
            getSuccessMessage: (_taskInfo, targetLocation) => {
                const fileName = path.basename(targetLocation);
                return LocalizedConstants.DacpacDialog.ExportSuccessWithFile(fileName);
            },
            actionButtonText: revealButtonText,
            actionCommand: "revealFileInOS",
            getActionCommandArgs: (_taskInfo, targetLocation) => [vscode.Uri.file(targetLocation)],
        });

        // Register handler for Extract DACPAC operation
        sqlTasksService.registerCompletionSuccessHandler({
            operationName: Constants.operationIdExtractDacpac,
            getTargetLocation: (taskInfo) => taskInfo.targetLocation,
            getSuccessMessage: (_taskInfo, targetLocation) => {
                const fileName = path.basename(targetLocation);
                return LocalizedConstants.DacpacDialog.ExtractSuccessWithFile(fileName);
            },
            actionButtonText: revealButtonText,
            actionCommand: "revealFileInOS",
            getActionCommandArgs: (_taskInfo, targetLocation) => [vscode.Uri.file(targetLocation)],
        });

        // Register handler for Import BACPAC operation
        sqlTasksService.registerCompletionSuccessHandler({
            operationName: Constants.operationIdImportBacpac,
            getTargetLocation: (taskInfo) => taskInfo.databaseName,
            getSuccessMessage: (_taskInfo, databaseName) => {
                return LocalizedConstants.DacpacDialog.ImportSuccessWithDatabase(databaseName);
            },
            // No action button for database operations
        });

        // Register handler for Deploy DACPAC operation
        sqlTasksService.registerCompletionSuccessHandler({
            operationName: Constants.operationIdDeployDacpac,
            getTargetLocation: (taskInfo) => taskInfo.databaseName,
            getSuccessMessage: (_taskInfo, databaseName) => {
                return LocalizedConstants.DacpacDialog.DeploySuccessWithDatabase(databaseName);
            },
            // No action button for database operations
        });
    }

    public exportBacpac(
        databaseName: string,
        packageFilePath: string,
        ownerUri: string,
        taskExecutionMode: TaskExecutionMode,
    ): Thenable<mssql.DacFxResult> {
        const params: mssql.ExportParams = {
            databaseName: databaseName,
            packageFilePath: packageFilePath,
            ownerUri: ownerUri,
            taskExecutionMode: taskExecutionMode,
        };
        return this._client.sendRequest(dacFxContracts.ExportRequest.type, params);
    }

    public importBacpac(
        packageFilePath: string,
        databaseName: string,
        ownerUri: string,
        taskExecutionMode: TaskExecutionMode,
    ): Thenable<mssql.DacFxResult> {
        const params: mssql.ImportParams = {
            packageFilePath: packageFilePath,
            databaseName: databaseName,
            ownerUri: ownerUri,
            taskExecutionMode: taskExecutionMode,
        };
        return this._client.sendRequest(dacFxContracts.ImportRequest.type, params);
    }

    public extractDacpac(
        databaseName: string,
        packageFilePath: string,
        applicationName: string | undefined,
        applicationVersion: string | undefined,
        ownerUri: string,
        taskExecutionMode: TaskExecutionMode,
    ): Thenable<mssql.DacFxResult> {
        const params: mssql.ExtractParams = {
            databaseName: databaseName,
            packageFilePath: packageFilePath,
            applicationName: applicationName || databaseName,
            applicationVersion: applicationVersion || "1.0.0.0",
            ownerUri: ownerUri,
            extractTarget: ExtractTarget.dacpac,
            taskExecutionMode: taskExecutionMode,
        };
        return this._client.sendRequest(dacFxContracts.ExtractRequest.type, params);
    }

    public createProjectFromDatabase(
        databaseName: string,
        targetFilePath: string,
        applicationName: string,
        applicationVersion: string,
        ownerUri: string,
        extractTarget: ExtractTarget,
        taskExecutionMode: TaskExecutionMode,
        includePermissions?: boolean,
    ): Thenable<mssql.DacFxResult> {
        const params: mssql.ExtractParams = {
            databaseName: databaseName,
            packageFilePath: targetFilePath,
            applicationName: applicationName,
            applicationVersion: applicationVersion,
            ownerUri: ownerUri,
            extractTarget: extractTarget,
            taskExecutionMode: taskExecutionMode,
            includePermissions: includePermissions,
        };
        return this._client.sendRequest(dacFxContracts.ExtractRequest.type, params);
    }

    public deployDacpac(
        packageFilePath: string,
        targetDatabaseName: string,
        upgradeExisting: boolean,
        ownerUri: string,
        taskExecutionMode: TaskExecutionMode,
        sqlCommandVariableValues?: Map<string, string>,
        deploymentOptions?: mssql.DeploymentOptions,
    ): Thenable<mssql.DacFxResult> {
        const params: mssql.DeployParams = {
            packageFilePath: packageFilePath,
            databaseName: targetDatabaseName,
            upgradeExisting: upgradeExisting,
            sqlCommandVariableValues: sqlCommandVariableValues
                ? Object.fromEntries(sqlCommandVariableValues)
                : undefined,
            deploymentOptions: deploymentOptions,
            ownerUri: ownerUri,
            taskExecutionMode: taskExecutionMode,
        };
        return this._client.sendRequest(dacFxContracts.DeployRequest.type, params);
    }

    public generateDeployScript(
        packageFilePath: string,
        targetDatabaseName: string,
        ownerUri: string,
        taskExecutionMode: TaskExecutionMode,
        sqlCommandVariableValues?: Map<string, string>,
        deploymentOptions?: mssql.DeploymentOptions,
    ): Thenable<mssql.DacFxResult> {
        const params: mssql.GenerateDeployScriptParams = {
            packageFilePath: packageFilePath,
            databaseName: targetDatabaseName,
            sqlCommandVariableValues: sqlCommandVariableValues
                ? Object.fromEntries(sqlCommandVariableValues)
                : undefined,
            deploymentOptions: deploymentOptions,
            ownerUri: ownerUri,
            taskExecutionMode: taskExecutionMode,
        };
        return this._client.sendRequest(dacFxContracts.GenerateDeployScriptRequest.type, params);
    }

    public generateDeployPlan(
        packageFilePath: string,
        targetDatabaseName: string,
        ownerUri: string,
        taskExecutionMode: TaskExecutionMode,
    ): Thenable<mssql.GenerateDeployPlanResult> {
        const params: mssql.GenerateDeployPlanParams = {
            packageFilePath: packageFilePath,
            databaseName: targetDatabaseName,
            ownerUri: ownerUri,
            taskExecutionMode: taskExecutionMode,
        };
        return this._client.sendRequest(dacFxContracts.GenerateDeployPlanRequest.type, params);
    }

    public getOptionsFromProfile(profilePath: string): Thenable<mssql.DacFxOptionsResult> {
        const params: mssql.GetOptionsFromProfileParams = {
            profilePath: profilePath,
        };
        return this._client.sendRequest(dacFxContracts.GetOptionsFromProfileRequest.type, params);
    }

    public validateStreamingJob(
        packageFilePath: string,
        createStreamingJobTsql: string,
    ): Thenable<mssql.ValidateStreamingJobResult> {
        const params: mssql.ValidateStreamingJobParams = {
            packageFilePath: packageFilePath,
            createStreamingJobTsql: createStreamingJobTsql,
        };
        return this._client.sendRequest(dacFxContracts.ValidateStreamingJobRequest.type, params);
    }

    public savePublishProfile(
        profilePath: string,
        databaseName: string,
        connectionString: string,
        sqlCommandVariableValues?: Map<string, string>,
        deploymentOptions?: mssql.DeploymentOptions,
    ): Thenable<mssql.ResultStatus> {
        const params: mssql.SavePublishProfileParams = {
            profilePath: profilePath,
            databaseName: databaseName,
            connectionString: connectionString,
            sqlCommandVariableValues: sqlCommandVariableValues
                ? Object.fromEntries(sqlCommandVariableValues)
                : undefined,
            deploymentOptions: deploymentOptions,
        };
        return this._client.sendRequest(dacFxContracts.SavePublishProfileRequest.type, params);
    }

    public getDeploymentOptions(
        scenario?: mssql.DeploymentScenario,
    ): Thenable<mssql.GetDeploymentOptionsResult> {
        const params: mssql.GetDeploymentOptionsParams = {
            scenario: scenario,
        };
        return this._client.sendRequest(dacFxContracts.GetDeploymentOptionsRequest.type, params);
    }
}
