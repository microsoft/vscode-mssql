/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import ConnectionManager from "../controllers/connectionManager";
import {
    ScriptingRequest,
    IScriptingParams,
    ScriptOperation,
    IScriptingObject,
    IScriptOptions,
    ScriptingProgressNotification,
} from "../models/contracts/scripting/scriptingRequest";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import * as vscode from "vscode";

export class ScriptingService {
    private _client: SqlToolsServiceClient;

    constructor(private _connectionManager: ConnectionManager) {
        this._client = this._connectionManager.client;
        this._client.onNotification(ScriptingProgressNotification.type, (params) => {
            this._client.logger.verbose(JSON.stringify(params));
            if (params.errorMessage) {
                const errorText = `Scripting progress error: ${params.errorMessage} - ${params.errorDetails}`;
                this._client.logger.error(errorText);
                vscode.window.showErrorMessage(errorText);
            }
        });
    }

    public static getScriptCompatibility(serverMajorVersion: number, serverMinorVersion: number) {
        switch (serverMajorVersion) {
            case 8:
                return "Script80Compat";
            case 9:
                return "Script90Compat";
            case 10:
                if (serverMinorVersion === 50) {
                    return "Script105Compat";
                }
                return "Script100Compat";
            case 11:
                return "Script110Compat";
            case 12:
                return "Script120Compat";
            case 13:
                return "Script130Compat";
            case 14:
                return "Script140Compat";
            case 15:
                return "Script150Compat";
            case 16:
                return "Script160Compat";
            case 17:
                return "Script170Compat";
            default:
                return "Script140Compat";
        }
    }

    // map for the target database engine edition (default is Enterprise)
    readonly targetDatabaseEngineEditionMap = {
        0: "SqlServerEnterpriseEdition",
        1: "SqlServerPersonalEdition",
        2: "SqlServerStandardEdition",
        3: "SqlServerEnterpriseEdition",
        4: "SqlServerExpressEdition",
        5: "SqlAzureDatabaseEdition",
        6: "SqlDatawarehouseEdition",
        7: "SqlServerStretchEdition",
        8: "SqlManagedInstanceEdition",
        9: "SqlDatabaseEdgeEdition",
        11: "SqlOnDemandEdition",
    };

    /**
     * Helper to get the object name and schema name
     * (Public for testing purposes)
     */
    public getObjectFromNode(node: TreeNodeInfo): IScriptingObject | undefined {
        let metadata = node.metadata;
        if (!metadata) {
            return undefined;
        }
        let scriptingObject: IScriptingObject = {
            type: metadata.metadataTypeName,
            schema: metadata.schema,
            name: metadata.name,
            parentName: metadata.parentName,
            parentTypeName: metadata.parentTypeName,
        };
        return scriptingObject;
    }

    /**
     * Helper to create scripting params
     */
    public createScriptingParams(
        node: TreeNodeInfo,
        uri: string,
        operation: ScriptOperation,
    ): IScriptingParams {
        const scriptingObject = this.getObjectFromNode(node);
        let serverInfo = this._connectionManager.getServerInfo(node.connectionProfile);
        let scriptCreateDropOption: string;
        switch (operation) {
            case ScriptOperation.Select:
                scriptCreateDropOption = "ScriptSelect";
                break;
            case ScriptOperation.Delete:
                scriptCreateDropOption = "ScriptDrop";
                break;
            case ScriptOperation.Create:
                scriptCreateDropOption = "ScriptCreate";
            default:
                scriptCreateDropOption = "ScriptCreate";
        }
        let scriptOptions: IScriptOptions = {
            scriptCreateDrop: scriptCreateDropOption,
            typeOfDataToScript: "SchemaOnly",
            scriptStatistics: "ScriptStatsNone",
            targetDatabaseEngineEdition:
                serverInfo && serverInfo.engineEditionId
                    ? this.targetDatabaseEngineEditionMap[serverInfo.engineEditionId]
                    : "SqlServerEnterpriseEdition",
            targetDatabaseEngineType:
                serverInfo && serverInfo.isCloud ? "SqlAzure" : "SingleInstance",
            scriptCompatibilityOption: ScriptingService.getScriptCompatibility(
                serverInfo?.serverMajorVersion,
                serverInfo?.serverMinorVersion,
            ),
        };
        let scriptingParams: IScriptingParams = {
            filePath: undefined,
            scriptDestination: "ToEditor",
            connectionString: undefined,
            scriptingObjects: [scriptingObject],
            includeObjectCriteria: undefined,
            excludeObjectCriteria: undefined,
            includeSchemas: undefined,
            excludeSchemas: undefined,
            includeTypes: undefined,
            excludeTypes: undefined,
            scriptOptions: scriptOptions,
            connectionDetails: undefined,
            ownerURI: uri,
            selectScript: undefined,
            operation: operation,
        };
        return scriptingParams;
    }

    public async script(
        node: TreeNodeInfo,
        uri: string,
        operation: ScriptOperation,
    ): Promise<string> {
        let scriptingParams = this.createScriptingParams(node, uri, operation);
        const result = await this._client.sendRequest(ScriptingRequest.type, scriptingParams);
        return result.script;
    }
}
