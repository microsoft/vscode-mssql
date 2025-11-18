/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import * as dacFxContracts from "../models/contracts/dacFx/dacFxContracts";
import * as mssql from "vscode-mssql";
import { ExtractTarget, TaskExecutionMode } from "../sharedInterfaces/schemaCompare";

export class DacFxService implements mssql.IDacFxService {
    constructor(private _client: SqlToolsServiceClient) {}

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
}
