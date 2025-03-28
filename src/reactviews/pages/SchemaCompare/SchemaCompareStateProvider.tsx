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
                compare: function (
                    sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
                    targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
                    taskExecutionMode: mssql.TaskExecutionMode,
                    deploymentOptions: mssql.DeploymentOptions,
                ): void {
                    webViewState?.extensionRpc.action("compare", {
                        sourceEndpointInfo: sourceEndpointInfo,
                        targetEndpointInfo: targetEndpointInfo,
                        taskExecutionMode: taskExecutionMode,
                        deploymentOptions: deploymentOptions,
                    });
                },
                generateScript: function (
                    targetServerName: string,
                    targetDatabaseName: string,
                    taskExecutionMode: mssql.TaskExecutionMode,
                ): void {
                    webViewState?.extensionRpc.action("generateScript", {
                        targetServerName: targetServerName,
                        targetDatabaseName: targetDatabaseName,
                        taskExecutionMode: taskExecutionMode,
                    });
                },
                publishDatabaseChanges: function (
                    targetServerName: string,
                    targetDatabaseName: string,
                    taskExecutionMode: mssql.TaskExecutionMode,
                ): void {
                    webViewState?.extensionRpc.action("publishDatabaseChanges", {
                        targetServerName: targetServerName,
                        targetDatabaseName: targetDatabaseName,
                        taskExecutionMode: taskExecutionMode,
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
                getDefaultOptions: function (): void {
                    webViewState?.extensionRpc.action("getDefaultOptions", {});
                },
                includeExcludeNode: function (
                    diffEntry: mssql.DiffEntry,
                    includeRequest: boolean,
                    taskExecutionMode: mssql.TaskExecutionMode,
                ): void {
                    webViewState?.extensionRpc.action("includeExcludeNode", {
                        diffEntry: diffEntry,
                        includeRequest: includeRequest,
                        taskExecutionMode: taskExecutionMode,
                    });
                },
                openScmp: function (filePath: string): void {
                    webViewState?.extensionRpc.action("openScmp", {
                        filePath: filePath,
                    });
                },
                saveScmp: function (
                    sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
                    targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
                    taskExecutionMode: mssql.TaskExecutionMode,
                    deploymentOptions: mssql.DeploymentOptions,
                    scmpFilePath: string,
                    excludedSourceObjects: mssql.SchemaCompareObjectId[],
                    excludedTargetObjects: mssql.SchemaCompareObjectId[],
                ): void {
                    webViewState?.extensionRpc.action("saveScmp", {
                        sourceEndpointInfo: sourceEndpointInfo,
                        targetEndpointInfo: targetEndpointInfo,
                        taskExecutionMode: taskExecutionMode,
                        deploymentOptions: deploymentOptions,
                        scmpFilePath: scmpFilePath,
                        excludedSourceObjects: excludedSourceObjects,
                        excludedTargetObjects: excludedTargetObjects,
                    });
                },
                cancel: function (): void {
                    webViewState?.extensionRpc.action("cancel", {});
                },
            }}
        >
            {children}
        </schemaCompareContext.Provider>
    );
};

export { SchemaCompareStateProvider };
