/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import SqlToolsServiceClient from '../languageservice/serviceclient';
import ConnectionManager from '../controllers/connectionManager';
import { ScriptingRequest, ScriptingParams, ScriptOperation, ScriptingObject, ScriptOptions } from '../models/contracts/scripting/scriptingRequest';
import { TreeNodeInfo } from '../objectExplorer/treeNodeInfo';
import VscodeWrapper from '../controllers/vscodeWrapper';
import { MetadataService } from '../metadata/metadataService';
import { IConnectionCredentials } from '../models/interfaces';
import { ObjectMetadata, MetadataType } from '../models/contracts/metadata/metadataRequest';
import Utils = require('../models/utils');

export class ScriptingService {

    private _client: SqlToolsServiceClient;
    private _metdataService: MetadataService;
    private _credentialsToMetadataMap: Map<IConnectionCredentials, ObjectMetadata[]>;

    constructor(
        private _connectionManager: ConnectionManager,
        private _vscodeWrapper: VscodeWrapper
    ) {
        this._client = this._connectionManager.client;
        this._metdataService = new MetadataService(this._connectionManager);
        this._credentialsToMetadataMap = new Map<IConnectionCredentials, ObjectMetadata[]>();
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
     * Helper to node name from label and metadata
     */
    private getObjectName(nameLabel: string, objectName: string, metadata: ObjectMetadata[]): string {
        if (nameLabel === objectName) {
            return nameLabel;
        }
        // if the names aren't the same, find the closest
        // name to the name label
        let closestName = '';
        for (const obj of metadata) {
            if (nameLabel.includes(obj.name)) {
                if (obj.name.length > closestName.length) {
                    closestName = obj.name;
                }
            }
        }
        return closestName;
    }

    /**
     * Helper to get the object name and schema name
     */
    private async getObjectFromNode(node: TreeNodeInfo, uri: string): Promise<ScriptingObject> {
        const nodeCredentials = node.connectionCredentials;
        let metadata: ObjectMetadata[];
        for (let credential of this._credentialsToMetadataMap.keys()) {
            if (Utils.isSameConnection(credential, nodeCredentials)) {
                metadata = this._credentialsToMetadataMap.get(credential);
                break;
            }
        }
        if (!metadata) {
            metadata = await this._metdataService.getMetadata(uri);
            const newCredentials = Object.assign({}, nodeCredentials);
            this._credentialsToMetadataMap.set(newCredentials, metadata);
        }
        for (const obj of metadata) {
            const objectLabels = node.label.split('.');
            const schemaLabel = objectLabels[0];
            const nameLabel = objectLabels[1];
            if (obj.metadataTypeName === node.nodeType &&
                obj.schema === schemaLabel) {
                const objectName = this.getObjectName(nameLabel, obj.name, metadata);
                let scriptingObject: ScriptingObject = {
                    type: obj.metadataTypeName,
                    schema: obj.schema,
                    name: objectName
                };
                return scriptingObject;
            }
        }
    }

    public async scriptSelect(node: TreeNodeInfo, uri: string): Promise<string> {
        const scriptingObject = await this.getObjectFromNode(node, uri);
        let serverInfo = this._connectionManager.getServerInfo(node.connectionCredentials);
        let scriptOptions: ScriptOptions = {
            scriptCreateDrop: 'ScriptSelect',
            typeOfDataToScript: 'SchemaOnly',
            scriptStatistics: 'ScriptStatsNone',
            targetDatabaseEngineEdition:
            serverInfo.engineEditionId ? this.targetDatabaseEngineEditionMap[serverInfo.engineEditionId] : 'SqlServerEnterpriseEdition',
            targetDatabaseEngineType: serverInfo.isCloud ? 'SqlAzure' : 'SingleInstance',
            scriptCompatibilityOption: serverInfo.serverMajorVersion ?
                this.scriptCompatibilityOptionMap[serverInfo.serverMajorVersion] : 'Script140Compat'
        };
        let scriptingParams: ScriptingParams = {
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
            operation: ScriptOperation.Select
        };
        const result = await this._client.sendRequest(ScriptingRequest.type, scriptingParams);
        return result.script;
    }

}
