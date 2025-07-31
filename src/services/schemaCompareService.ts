/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import * as schemaCompareContracts from "../models/contracts/schemaCompare/schemaCompareContracts";
import * as mssql from "vscode-mssql";
import { ExtractTarget, TaskExecutionMode } from "../sharedInterfaces/schemaCompare";

export class SchemaCompareService implements mssql.ISchemaCompareService {
    constructor(private _client: SqlToolsServiceClient) {}

    public compare(
        operationId: string,
        sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
        targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
        taskExecutionMode: TaskExecutionMode,
        deploymentOptions: mssql.DeploymentOptions,
    ): Thenable<mssql.SchemaCompareResult> {
        const params: mssql.SchemaCompareParams = {
            operationId: operationId,
            sourceEndpointInfo: sourceEndpointInfo,
            targetEndpointInfo: targetEndpointInfo,
            taskExecutionMode: taskExecutionMode,
            deploymentOptions: deploymentOptions,
        };

        return this._client.sendRequest(schemaCompareContracts.SchemaCompareRequest.type, params);
    }

    public generateScript(
        operationId: string,
        targetServerName: string,
        targetDatabaseName: string,
        taskExecutionMode: TaskExecutionMode,
    ): Thenable<mssql.ResultStatus> {
        const params: mssql.SchemaCompareGenerateScriptParams = {
            operationId: operationId,
            targetServerName: targetServerName,
            targetDatabaseName: targetDatabaseName,
            taskExecutionMode: taskExecutionMode,
        };

        return this._client.sendRequest(
            schemaCompareContracts.SchemaCompareGenerateScriptRequest.type,
            params,
        );
    }

    public publishDatabaseChanges(
        operationId: string,
        targetServerName: string,
        targetDatabaseName: string,
        taskExecutionMode: TaskExecutionMode,
    ): Thenable<mssql.ResultStatus> {
        const params: mssql.SchemaComparePublishDatabaseChangesParams = {
            operationId: operationId,
            targetServerName: targetServerName,
            targetDatabaseName: targetDatabaseName,
            taskExecutionMode: taskExecutionMode,
        };

        return this._client.sendRequest(
            schemaCompareContracts.SchemaComparePublishDatabaseChangesRequest.type,
            params,
        );
    }

    public publishProjectChanges(
        operationId: string,
        targetProjectPath: string,
        targetFolderStructure: ExtractTarget,
        taskExecutionMode: TaskExecutionMode,
    ): Thenable<mssql.SchemaComparePublishProjectResult> {
        const params: mssql.SchemaComparePublishProjectChangesParams = {
            operationId: operationId,
            targetProjectPath: targetProjectPath,
            targetFolderStructure: targetFolderStructure,
            taskExecutionMode: taskExecutionMode,
        };

        return this._client.sendRequest(
            schemaCompareContracts.SchemaComparePublishProjectChangesRequest.type,
            params,
        );
    }

    public schemaCompareGetDefaultOptions(): Thenable<mssql.SchemaCompareOptionsResult> {
        const params: mssql.SchemaCompareGetOptionsParams = {};

        return this._client.sendRequest(
            schemaCompareContracts.SchemaCompareGetDefaultOptionsRequest.type,
            params,
        );
    }

    public includeExcludeNode(
        operationId: string,
        diffEntry: mssql.DiffEntry,
        includeRequest: boolean,
        taskExecutionMode: TaskExecutionMode,
    ): Thenable<mssql.SchemaCompareIncludeExcludeResult> {
        const params: mssql.SchemaCompareNodeParams = {
            operationId: operationId,
            diffEntry: diffEntry,
            includeRequest: includeRequest,
            taskExecutionMode: taskExecutionMode,
        };

        return this._client.sendRequest(
            schemaCompareContracts.SchemaCompareIncludeExcludeNodeRequest.type,
            params,
        );
    }

    public includeExcludeAllNodes(
        operationId: string,
        includeRequest: boolean,
        taskExecutionMode: TaskExecutionMode,
    ): Thenable<mssql.SchemaCompareIncludeExcludeAllResult> {
        const params: mssql.SchemaCompareIncludeExcludeAllNodesParams = {
            operationId: operationId,
            includeRequest: includeRequest,
            taskExecutionMode: taskExecutionMode,
        };

        return this._client.sendRequest(
            schemaCompareContracts.SchemaCompareIncludeExcludeAllNodesRequest.type,
            params,
        );
    }

    public openScmp(filePath: string): Thenable<mssql.SchemaCompareOpenScmpResult> {
        const params: mssql.SchemaCompareOpenScmpParams = {
            filePath: filePath,
        };

        return this._client.sendRequest(
            schemaCompareContracts.SchemaCompareOpenScmpRequest.type,
            params,
        );
    }

    public saveScmp(
        sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
        targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
        taskExecutionMode: TaskExecutionMode,
        deploymentOptions: mssql.DeploymentOptions,
        scmpFilePath: string,
        excludedSourceObjects: mssql.SchemaCompareObjectId[],
        excludedTargetObjects: mssql.SchemaCompareObjectId[],
    ): Thenable<mssql.ResultStatus> {
        const params: mssql.SchemaCompareSaveScmpParams = {
            sourceEndpointInfo: sourceEndpointInfo,
            targetEndpointInfo: targetEndpointInfo,
            taskExecutionMode: taskExecutionMode,
            deploymentOptions: deploymentOptions,
            scmpFilePath: scmpFilePath,
            excludedSourceObjects: excludedSourceObjects,
            excludedTargetObjects: excludedTargetObjects,
        };

        return this._client.sendRequest(
            schemaCompareContracts.SchemaCompareSaveScmpRequest.type,
            params,
        );
    }

    public cancel(operationId: string): Thenable<mssql.ResultStatus> {
        const params: mssql.SchemaCompareCancelParams = {
            operationId: operationId,
        };

        return this._client.sendRequest(
            schemaCompareContracts.SchemaCompareCancellationRequest.type,
            params,
        );
    }
}
