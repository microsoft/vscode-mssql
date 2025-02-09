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

const SchemaCompareStateProvider: React.FC<SchemaCompareStateProviderProps> = ({
    children,
}) => {
    const webViewState = useVscodeWebview<
        sc.SchemaCompareWebViewState,
        sc.SchemaCompareReducers
    >();
    const schemaCompareState = webViewState?.state;

    return (
        <schemaCompareContext.Provider
            value={{
                state: schemaCompareState,
                themeKind: webViewState?.themeKind,
                schemaCompare: function (
                    operationId: string,
                    sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
                    targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
                    taskExecutionMode: mssql.TaskExecutionMode,
                    deploymentOptions: mssql.DeploymentOptions,
                ): void {
                    webViewState?.extensionRpc.action("schemaCompare", {
                        operationId: operationId,
                        sourceEndpointInfo: sourceEndpointInfo,
                        targetEndpointInfo: targetEndpointInfo,
                        taskExecutionMode: taskExecutionMode,
                        deploymentOptions: deploymentOptions,
                    });
                },
                schemaCompareGenerateScript: function (
                    operationId: string,
                    targetServerName: string,
                    targetDatabaseName: string,
                    taskExecutionMode: mssql.TaskExecutionMode,
                ): void {
                    webViewState?.extensionRpc.action(
                        "schemaCompareGenerateScript",
                        {
                            operationId: operationId,
                            targetServerName: targetServerName,
                            targetDatabaseName: targetDatabaseName,
                            taskExecutionMode: taskExecutionMode,
                        },
                    );
                },
                schemaComparePublishDatabaseChanges: function (
                    operationId: string,
                    targetServerName: string,
                    targetDatabaseName: string,
                    taskExecutionMode: mssql.TaskExecutionMode,
                ): void {
                    webViewState?.extensionRpc.action(
                        "schemaComparePublishDatabaseChanges",
                        {
                            operationId: operationId,
                            targetServerName: targetServerName,
                            targetDatabaseName: targetDatabaseName,
                            taskExecutionMode: taskExecutionMode,
                        },
                    );
                },
                schemaComparePublishProjectChanges: function (
                    operationId: string,
                    targetProjectPath: string,
                    targetFolderStructure: mssql.ExtractTarget,
                    taskExecutionMode: mssql.TaskExecutionMode,
                ): void {
                    webViewState?.extensionRpc.action(
                        "schemaComparePublishProjectChanges",
                        {
                            operationId: operationId,
                            targetProjectPath: targetProjectPath,
                            targetFolderStructure: targetFolderStructure,
                            taskExecutionMode: taskExecutionMode,
                        },
                    );
                },
                schemaCompareGetDefaultOptions: function (): void {
                    webViewState?.extensionRpc.action(
                        "schemaCompareGetDefaultOptions",
                        {},
                    );
                },
                schemaCompareIncludeExcludeNode: function (
                    operationId: string,
                    diffEntry: mssql.DiffEntry,
                    includeRequest: boolean,
                    taskExecutionMode: mssql.TaskExecutionMode,
                ): void {
                    webViewState?.extensionRpc.action(
                        "schemaCompareIncludeExcludeNode",
                        {
                            operationId: operationId,
                            diffEntry: diffEntry,
                            includeRequest: includeRequest,
                            taskExecutionMode: taskExecutionMode,
                        },
                    );
                },
                schemaCompareOpenScmp: function (filePath: string): void {
                    webViewState?.extensionRpc.action("schemaCompareOpenScmp", {
                        filePath: filePath,
                    });
                },
                schemaCompareSaveScmp: function (
                    sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
                    targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
                    taskExecutionMode: mssql.TaskExecutionMode,
                    deploymentOptions: mssql.DeploymentOptions,
                    scmpFilePath: string,
                    excludedSourceObjects: mssql.SchemaCompareObjectId[],
                    excludedTargetObjects: mssql.SchemaCompareObjectId[],
                ): void {
                    webViewState?.extensionRpc.action("schemaCompareSaveScmp", {
                        sourceEndpointInfo: sourceEndpointInfo,
                        targetEndpointInfo: targetEndpointInfo,
                        taskExecutionMode: taskExecutionMode,
                        deploymentOptions: deploymentOptions,
                        scmpFilePath: scmpFilePath,
                        excludedSourceObjects: excludedSourceObjects,
                        excludedTargetObjects: excludedTargetObjects,
                    });
                },
                schemaCompareCancel: function (operationId: string): void {
                    webViewState?.extensionRpc.action("schemaCompareCancel", {
                        operationId: operationId,
                    });
                },
            }}
        >
            {children}
        </schemaCompareContext.Provider>
    );
};

export { SchemaCompareStateProvider };
