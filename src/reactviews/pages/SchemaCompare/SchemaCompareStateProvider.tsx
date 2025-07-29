/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sc from "../../../sharedInterfaces/schemaCompare";
import * as mssql from "vscode-mssql";

import { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";

const schemaCompareContext = createContext<sc.SchemaCompareContextProps>(
    {} as sc.SchemaCompareContextProps,
);

interface SchemaCompareStateProviderProps {
    children: React.ReactNode;
}

const SchemaCompareStateProvider: React.FC<SchemaCompareStateProviderProps> = ({ children }) => {
    const webViewState = useVscodeWebview<sc.SchemaCompareWebViewState, sc.SchemaCompareReducers>();
    const schemaCompareState = webViewState?.state;

    return (
        <schemaCompareContext.Provider
            value={{
                state: schemaCompareState,
                themeKind: webViewState?.themeKind,

                isSqlProjectExtensionInstalled: function (): void {
                    webViewState?.extensionRpc.action("isSqlProjectExtensionInstalled", {});
                },
                listActiveServers: function (): void {
                    webViewState?.extensionRpc.action("listActiveServers", {});
                },
                listDatabasesForActiveServer: function (connectionUri: string): void {
                    webViewState?.extensionRpc.action("listDatabasesForActiveServer", {
                        connectionUri: connectionUri,
                    });
                },
                openAddNewConnectionDialog: function (endpointType: "source" | "target"): void {
                    webViewState?.extensionRpc.action("openAddNewConnectionDialog", {
                        endpointType: endpointType,
                    });
                },
                selectFile: function (
                    endpoint: mssql.SchemaCompareEndpointInfo,
                    endpointType: "source" | "target",
                    fileType: "dacpac" | "sqlproj",
                ): void {
                    webViewState?.extensionRpc.action("selectFile", {
                        endpoint: endpoint,
                        endpointType: endpointType,
                        fileType: fileType,
                    });
                },
                confirmSelectedSchema: function (
                    endpointType: "source" | "target",
                    folderStructure: string,
                ): void {
                    webViewState?.extensionRpc.action("confirmSelectedSchema", {
                        endpointType: endpointType,
                        folderStructure: folderStructure,
                    });
                },
                confirmSelectedDatabase: function (
                    endpointType: "source" | "target",
                    serverConnectionUri: string,
                    databaseName: string,
                ): void {
                    webViewState?.extensionRpc.action("confirmSelectedDatabase", {
                        endpointType: endpointType,
                        serverConnectionUri: serverConnectionUri,
                        databaseName: databaseName,
                    });
                },
                setIntermediarySchemaOptions: function (): void {
                    webViewState?.extensionRpc.action("setIntermediarySchemaOptions", {});
                },
                intermediaryGeneralOptionsChanged(key: string): void {
                    webViewState?.extensionRpc.action("intermediaryGeneralOptionsChanged", {
                        key: key,
                    });
                },
                intermediaryGeneralOptionsBulkChanged(keys: string[], checked: boolean): void {
                    webViewState?.extensionRpc.action("intermediaryGeneralOptionsBulkChanged", {
                        keys: keys,
                        checked: checked,
                    });
                },
                intermediaryIncludeObjectTypesOptionsChanged(key: string): void {
                    webViewState?.extensionRpc.action(
                        "intermediaryIncludeObjectTypesOptionsChanged",
                        { key: key },
                    );
                },
                intermediaryIncludeObjectTypesBulkChanged(keys: string[], checked: boolean): void {
                    webViewState?.extensionRpc.action("intermediaryIncludeObjectTypesBulkChanged", {
                        keys: keys,
                        checked: checked,
                    });
                },
                confirmSchemaOptions: function (optionsChanged: boolean): void {
                    webViewState?.extensionRpc.action("confirmSchemaOptions", {
                        optionsChanged: optionsChanged,
                    });
                },
                switchEndpoints: function (
                    newSourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
                    newTargetEndpointInfo: mssql.SchemaCompareEndpointInfo,
                ): void {
                    webViewState?.extensionRpc.action("switchEndpoints", {
                        newSourceEndpointInfo: newSourceEndpointInfo,
                        newTargetEndpointInfo: newTargetEndpointInfo,
                    });
                },
                compare: function (
                    sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
                    targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
                    deploymentOptions: mssql.DeploymentOptions,
                ): void {
                    webViewState?.extensionRpc.action("compare", {
                        sourceEndpointInfo: sourceEndpointInfo,
                        targetEndpointInfo: targetEndpointInfo,
                        deploymentOptions: deploymentOptions,
                    });
                },
                generateScript: function (
                    targetServerName: string,
                    targetDatabaseName: string,
                ): void {
                    webViewState?.extensionRpc.action("generateScript", {
                        targetServerName: targetServerName,
                        targetDatabaseName: targetDatabaseName,
                    });
                },
                publishChanges: function (targetDatabaseName: string, targetServerName: string) {
                    webViewState?.extensionRpc.action("publishChanges", {
                        targetServerName: targetServerName,
                        targetDatabaseName: targetDatabaseName,
                    });
                },
                publishDatabaseChanges: function (
                    targetServerName: string,
                    targetDatabaseName: string,
                ): void {
                    webViewState?.extensionRpc.action("publishDatabaseChanges", {
                        targetServerName: targetServerName,
                        targetDatabaseName: targetDatabaseName,
                    });
                },
                publishProjectChanges: function (
                    targetProjectPath: string,
                    targetFolderStructure: mssql.ExtractTarget,
                    taskExecutionMode: mssql.TaskExecutionMode,
                ): void {
                    webViewState?.extensionRpc.action("publishProjectChanges", {
                        targetProjectPath: targetProjectPath,
                        targetFolderStructure: targetFolderStructure,
                        taskExecutionMode: taskExecutionMode,
                    });
                },
                resetOptions: function (): void {
                    webViewState?.extensionRpc.action("resetOptions", {});
                },
                includeExcludeNode: function (
                    id: number,
                    diffEntry: mssql.DiffEntry,
                    includeRequest: boolean,
                ): void {
                    webViewState?.extensionRpc.action("includeExcludeNode", {
                        id: id,
                        diffEntry: diffEntry,
                        includeRequest: includeRequest,
                    });
                },
                includeExcludeAllNodes: function (includeRequest: boolean): void {
                    webViewState?.extensionRpc.action("includeExcludeAllNodes", {
                        includeRequest: includeRequest,
                    });
                },
                openScmp: function (): void {
                    webViewState?.extensionRpc.action("openScmp", {});
                },
                saveScmp: function (): void {
                    webViewState?.extensionRpc.action("saveScmp", {});
                },
                cancel: function (): void {
                    webViewState?.extensionRpc.action("cancel", {});
                },
            }}>
            {children}
        </schemaCompareContext.Provider>
    );
};

export { schemaCompareContext, SchemaCompareStateProvider };
