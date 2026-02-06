/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sc from "../../../sharedInterfaces/schemaCompare";
import * as mssql from "vscode-mssql";

import { createContext, useMemo } from "react";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { getCoreRPCs2 } from "../../common/utils";

const schemaCompareContext = createContext<sc.SchemaCompareContextProps>(
    {} as sc.SchemaCompareContextProps,
);

interface SchemaCompareStateProviderProps {
    children: React.ReactNode;
}

const SchemaCompareStateProvider: React.FC<SchemaCompareStateProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<
        sc.SchemaCompareWebViewState,
        sc.SchemaCompareReducers
    >();

    const commands = useMemo<sc.SchemaCompareContextProps>(
        () => ({
            ...getCoreRPCs2(extensionRpc),
            isSqlProjectExtensionInstalled: function (): void {
                extensionRpc.action("isSqlProjectExtensionInstalled", {});
            },
            listActiveServers: function (): void {
                extensionRpc.action("listActiveServers", {});
            },
            listDatabasesForActiveServer: function (connectionUri: string): void {
                extensionRpc.action("listDatabasesForActiveServer", {
                    connectionUri: connectionUri,
                });
            },
            openAddNewConnectionDialog: function (endpointType: "source" | "target"): void {
                extensionRpc.action("openAddNewConnectionDialog", {
                    endpointType: endpointType,
                });
            },
            selectFile: function (
                endpoint: mssql.SchemaCompareEndpointInfo,
                endpointType: "source" | "target",
                fileType: "dacpac" | "sqlproj",
            ): void {
                extensionRpc.action("selectFile", {
                    endpoint: endpoint,
                    endpointType: endpointType,
                    fileType: fileType,
                });
            },
            confirmSelectedSchema: function (
                endpointType: "source" | "target",
                folderStructure: string,
            ): void {
                extensionRpc.action("confirmSelectedSchema", {
                    endpointType: endpointType,
                    folderStructure: folderStructure,
                });
            },
            confirmSelectedDatabase: function (
                endpointType: "source" | "target",
                serverConnectionUri: string,
                databaseName: string,
            ): void {
                extensionRpc.action("confirmSelectedDatabase", {
                    endpointType: endpointType,
                    serverConnectionUri: serverConnectionUri,
                    databaseName: databaseName,
                });
            },
            setIntermediarySchemaOptions: function (): void {
                extensionRpc.action("setIntermediarySchemaOptions", {});
            },
            intermediaryGeneralOptionsChanged(key: string): void {
                extensionRpc.action("intermediaryGeneralOptionsChanged", {
                    key: key,
                });
            },
            intermediaryGeneralOptionsBulkChanged(keys: string[], checked: boolean): void {
                extensionRpc.action("intermediaryGeneralOptionsBulkChanged", {
                    keys: keys,
                    checked: checked,
                });
            },
            intermediaryIncludeObjectTypesOptionsChanged(key: string): void {
                extensionRpc.action("intermediaryIncludeObjectTypesOptionsChanged", { key: key });
            },
            intermediaryIncludeObjectTypesBulkChanged(keys: string[], checked: boolean): void {
                extensionRpc.action("intermediaryIncludeObjectTypesBulkChanged", {
                    keys: keys,
                    checked: checked,
                });
            },
            confirmSchemaOptions: function (optionsChanged: boolean): void {
                extensionRpc.action("confirmSchemaOptions", {
                    optionsChanged: optionsChanged,
                });
            },
            switchEndpoints: function (
                newSourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
                newTargetEndpointInfo: mssql.SchemaCompareEndpointInfo,
            ): void {
                extensionRpc.action("switchEndpoints", {
                    newSourceEndpointInfo: newSourceEndpointInfo,
                    newTargetEndpointInfo: newTargetEndpointInfo,
                });
            },
            resetEndpointsSwitched: function (): void {
                extensionRpc.action("resetEndpointsSwitched", {});
            },
            compare: function (
                sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
                targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
                deploymentOptions: mssql.DeploymentOptions,
            ): void {
                extensionRpc.action("compare", {
                    sourceEndpointInfo: sourceEndpointInfo,
                    targetEndpointInfo: targetEndpointInfo,
                    deploymentOptions: deploymentOptions,
                });
            },
            generateScript: function (
                targetServerName: string,
                targetDatabaseName: string,
            ): void {
                extensionRpc.action("generateScript", {
                    targetServerName: targetServerName,
                    targetDatabaseName: targetDatabaseName,
                });
            },
            publishChanges: function (targetDatabaseName: string, targetServerName: string) {
                extensionRpc.action("publishChanges", {
                    targetServerName: targetServerName,
                    targetDatabaseName: targetDatabaseName,
                });
            },
            publishDatabaseChanges: function (
                targetServerName: string,
                targetDatabaseName: string,
            ): void {
                extensionRpc.action("publishDatabaseChanges", {
                    targetServerName: targetServerName,
                    targetDatabaseName: targetDatabaseName,
                });
            },
            publishProjectChanges: function (
                targetProjectPath: string,
                targetFolderStructure: sc.ExtractTarget,
                taskExecutionMode: sc.TaskExecutionMode,
            ): void {
                extensionRpc.action("publishProjectChanges", {
                    targetProjectPath: targetProjectPath,
                    targetFolderStructure: targetFolderStructure,
                    taskExecutionMode: taskExecutionMode,
                });
            },
            resetOptions: function (): void {
                extensionRpc.action("resetOptions", {});
            },
            includeExcludeNode: function (
                id: number,
                diffEntry: mssql.DiffEntry,
                includeRequest: boolean,
            ): void {
                extensionRpc.action("includeExcludeNode", {
                    id: id,
                    diffEntry: diffEntry,
                    includeRequest: includeRequest,
                });
            },
            includeExcludeAllNodes: function (includeRequest: boolean): void {
                extensionRpc.action("includeExcludeAllNodes", {
                    includeRequest: includeRequest,
                });
            },
            openScmp: function (): void {
                extensionRpc.action("openScmp", {});
            },
            saveScmp: function (): void {
                extensionRpc.action("saveScmp", {});
            },
            cancel: function (): void {
                extensionRpc.action("cancel", {});
            },
        }),
        [extensionRpc],
    );

    return (
        <schemaCompareContext.Provider value={commands}>
            {children}
        </schemaCompareContext.Provider>
    );
};

export { schemaCompareContext, SchemaCompareStateProvider };
