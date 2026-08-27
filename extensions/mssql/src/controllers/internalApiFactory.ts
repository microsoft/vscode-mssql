/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeMssql from "vscode-mssql";
import { ConnectionDetails, IConnectionInfo, IExtension } from "vscode-mssql";
import { RequestType } from "vscode-languageclient";
import MainController from "./mainController";
import * as utils from "../models/utils";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import SqlToolsServerClient from "../languageservice/serviceclient";
import { UriOwnershipCoordinator } from "../uriOwnership/uriOwnershipCore";

/**
 * Builds the mssql API surface backed by the given controller.
 *
 * This object serves two purposes:
 * 1. It is the internal service handle consumed by the migrated SQL Database Projects code
 *    (see src/databaseProjects/serviceLocator.ts).
 * 2. It is (temporarily) still returned from activate() as the public extension API.
 *    TODO(api-retirement): Stop returning this from activate() after dependent extensions
 *    have migrated; at that point this factory remains for internal use only.
 */
export function createMssqlInternalApi(
    controller: MainController,
    uriOwnershipCoordinator: UriOwnershipCoordinator,
): IExtension {
    return {
        sqlToolsServicePath: SqlToolsServerClient.instance.sqlToolsServicePath,
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
        getConnectionString: (
            connectionUriOrDetails: string | ConnectionDetails,
            includePassword?: boolean,
            includeApplicationName?: boolean,
        ) => {
            return controller.connectionManager.getConnectionString(
                connectionUriOrDetails,
                includePassword,
                includeApplicationName,
            );
        },
        promptForFirewallRule: async (connectionUri: string, credentials: IConnectionInfo) => {
            const connectionInfo = controller.connectionManager.getConnectionInfo(connectionUri);
            if (!connectionInfo) {
                throw new Error(
                    `Could not find connection info for connection URI: ${connectionUri}`,
                );
            }
            return controller.connectionManager.handleFirewallError(
                credentials,
                connectionInfo.errorMessage,
            );
        },
        azureAccountService: controller.azureAccountService,
        azureResourceService: controller.azureResourceService,
        createConnectionDetails: (connectionInfo: IConnectionInfo) => {
            return controller.connectionManager.createConnectionDetails(connectionInfo);
        },
        sendRequest: async <P, R, E>(requestType: RequestType<P, R, E>, params?: P) => {
            return await controller.connectionManager.sendRequest(requestType, params);
        },
        getServerInfo: (connectionInfo: IConnectionInfo) => {
            return controller.connectionManager.getServerInfo(connectionInfo);
        },
        connectionSharing: {
            getActiveEditorConnectionId: (extensionId: string) => {
                return controller.connectionSharingService.getActiveEditorConnectionId(extensionId);
            },
            getActiveDatabase: (extensionId: string) => {
                return controller.connectionSharingService.getActiveDatabase(extensionId);
            },
            getDatabaseForConnectionId: (extensionId: string, connectionId: string) => {
                return controller.connectionSharingService.getDatabaseForConnectionId(
                    extensionId,
                    connectionId,
                );
            },
            connect: async (extensionId: string, connectionId: string): Promise<string> => {
                return controller.connectionSharingService.connect(extensionId, connectionId);
            },
            disconnect: (connectionUri: string): void => {
                return controller.connectionSharingService.disconnect(connectionUri);
            },
            isConnected: (connectionUri: string): boolean => {
                return controller.connectionSharingService.isConnected(connectionUri);
            },
            executeSimpleQuery: (
                connectionUri: string,
                queryString: string,
            ): Promise<vscodeMssql.SimpleExecuteResult> => {
                return controller.connectionSharingService.executeSimpleQuery(
                    connectionUri,
                    queryString,
                );
            },
            getServerInfo: (connectionUri: string): vscodeMssql.IServerInfo => {
                return controller.connectionSharingService.getServerInfo(connectionUri);
            },
            listDatabases: (connectionUri: string): Promise<string[]> => {
                return controller.connectionSharingService.listDatabases(connectionUri);
            },
            scriptObject: (connectionUri, operation, scriptingObject) => {
                return controller.connectionSharingService.scriptObject(
                    connectionUri,
                    operation,
                    scriptingObject,
                );
            },
            getConnectionString: (extensionId: string, connectionId: string): Promise<string> => {
                return controller.connectionSharingService.getConnectionString(
                    extensionId,
                    connectionId,
                );
            },
        } as vscodeMssql.IConnectionSharingService,
        uriOwnershipApi: uriOwnershipCoordinator.uriOwnershipApi,
    };
}
