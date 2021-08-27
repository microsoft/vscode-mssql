/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import SqlToolsServiceClient from '../languageservice/serviceclient';
import ConnectionManager from '../controllers/connectionManager';
import { ScriptingRequest, IScriptingParams, ScriptOperation, IScriptingObject, IScriptOptions } from '../models/contracts/scripting/scriptingRequest';
import { TreeNodeInfo } from '../objectExplorer/treeNodeInfo';

export class ScriptingService {

    private _client: SqlToolsServiceClient;

    constructor(
        private _connectionManager: ConnectionManager
    ) {
        this._client = this._connectionManager.client;
    }

    // map for the version of SQL Server (default is 140)
    readonly scriptCompatibilityOptionMap = {
        90: 'Script90Compat',
        100: 'Script100Compat',
        105: 'Script105Compat',
        110: 'Script110Compat',
        120: 'Script120Compat',
        130: 'Script130Compat',
        140: 'Script140Compat'
    };

    // map for the target database engine edition (default is Enterprise)
    readonly targetDatabaseEngineEditionMap = {
        0: 'SqlServerEnterpriseEdition',
        1: 'SqlServerPersonalEdition',
        2: 'SqlServerStandardEdition',
        3: 'SqlServerEnterpriseEdition',
        4: 'SqlServerExpressEdition',
        5: 'SqlAzureDatabaseEdition',
        6: 'SqlDatawarehouseEdition',
        7: 'SqlServerStretchEdition'
    };

    /**
     * Helper to get the object name and schema name
     * (Public for testing purposes)
     */
    public getObjectFromNode(node: TreeNodeInfo): IScriptingObject {
        let metadata = node.metadata;
        let scriptingObject: IScriptingObject = {
            type: metadata.metadataTypeName,
            schema: metadata.schema,
            name: metadata.name
        };
        return scriptingObject;
    }

    /**
     * Helper to create scripting params
     */
    public createScriptingParams(node: TreeNodeInfo, uri: string, operation: ScriptOperation): IScriptingParams {
        const scriptingObject = this.getObjectFromNode(node);
        let serverInfo = this._connectionManager.getServerInfo(node.connectionInfo);
        let scriptCreateDropOption: string;
        switch (operation) {
            case (ScriptOperation.Select):
                scriptCreateDropOption = 'ScriptSelect';
                break;
            case (ScriptOperation.Delete):
                scriptCreateDropOption = 'ScriptDrop';
                break;
            case (ScriptOperation.Create):
                scriptCreateDropOption = 'ScriptCreate';
            default:
                scriptCreateDropOption = 'ScriptCreate';
        }
        let scriptOptions: IScriptOptions = {
            scriptCreateDrop: scriptCreateDropOption,
            typeOfDataToScript: 'SchemaOnly',
            scriptStatistics: 'ScriptStatsNone',
            targetDatabaseEngineEdition: serverInfo && serverInfo.engineEditionId ?
                this.targetDatabaseEngineEditionMap[serverInfo.engineEditionId] : 'SqlServerEnterpriseEdition',
            targetDatabaseEngineType: serverInfo && serverInfo.isCloud ? 'SqlAzure' : 'SingleInstance',
            scriptCompatibilityOption: serverInfo && serverInfo.serverMajorVersion ?
                this.scriptCompatibilityOptionMap[serverInfo.serverMajorVersion] : 'Script140Compat'
        };
        let scriptingParams: IScriptingParams = {
            filePath: undefined,
            scriptDestination: 'ToEditor',
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
            operation: operation
        };
        return scriptingParams;
    }


    public async script(node: TreeNodeInfo, uri: string, operation: ScriptOperation): Promise<string> {
        let scriptingParams = this.createScriptingParams(node, uri, operation);
        const result = await this._client.sendRequest(ScriptingRequest.type, scriptingParams);
        return result.script;
    }
}
