/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeMssql from "vscode-mssql";
import { IConnectionInfo } from "vscode-mssql";
import MainController from "./mainController";
import * as utils from "../models/utils";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";

/** Internal services used by the in-process SQL Database Projects feature. */
export interface MssqlInternalApi {
    readonly dacFx: vscodeMssql.IDacFxService;
    readonly schemaCompare: vscodeMssql.ISchemaCompareService;
    readonly sqlProjects: vscodeMssql.ISqlProjectsService;
    readonly azureAccountService: vscodeMssql.IAzureAccountService;
    readonly azureResourceService: vscodeMssql.IAzureResourceService;
    promptForConnection(ignoreFocusOut?: boolean): Promise<IConnectionInfo | undefined>;
    connect(connectionInfo: IConnectionInfo, saveConnection?: boolean): Promise<string>;
    listDatabases(connectionUri: string): Promise<string[]>;
    getDatabaseNameFromTreeNode(node: vscodeMssql.ITreeNodeInfo): string;
    getServerInfo(connectionInfo: IConnectionInfo): vscodeMssql.IServerInfo;
}

/**
 * Builds the mssql API surface backed by the given controller.
 *
 * This object is deliberately kept separate from the public extension exports.
 */
export function createMssqlInternalApi(controller: MainController): MssqlInternalApi {
    return {
        promptForConnection: async (ignoreFocusOut?: boolean) => {
            const connectionProfileList =
                await controller.connectionManager.connectionStore.getPickListItems();
            return controller.connectionManager.connectionUI.promptForConnection(
                connectionProfileList,
                ignoreFocusOut,
            );
        },
        connect: async (connectionInfo: IConnectionInfo, saveConnection?: boolean) => {
            const uri = utils.generateQueryUri().toString();
            // First wait for initial connection request to succeed
            const requestSucceeded = await controller.connect(
                uri,
                connectionInfo,
                saveConnection,
                "extensionApi",
            );
            if (!requestSucceeded) {
                throw new Error(`Connection request for ${JSON.stringify(connectionInfo)} failed`);
            }
            return uri;
        },
        listDatabases: (connectionUri: string) => {
            return controller.connectionManager.listDatabases(connectionUri);
        },
        getDatabaseNameFromTreeNode: (node: vscodeMssql.ITreeNodeInfo) => {
            return ObjectExplorerUtils.getDatabaseName(node);
        },
        dacFx: controller.dacFxService,
        schemaCompare: controller.schemaCompareService,
        sqlProjects: controller.sqlProjectsService,
        azureAccountService: controller.azureAccountService,
        azureResourceService: controller.azureResourceService,
        getServerInfo: (connectionInfo: IConnectionInfo) => {
            return controller.connectionManager.getServerInfo(connectionInfo);
        },
    };
}
