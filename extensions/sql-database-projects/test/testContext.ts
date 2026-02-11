/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import * as TypeMoq from "typemoq";
import * as vscodeMssql from "vscode-mssql";

export interface TestContext {
    context: vscode.ExtensionContext;
    dacFxService: TypeMoq.IMock<vscodeMssql.IDacFxService>;
    outputChannel: vscode.OutputChannel;
}

export const mockDacFxResult: vscodeMssql.DacFxResult = {
    operationId: "",
    success: true,
    errorMessage: "",
};

export const mockGenerateDeployPlanResult: vscodeMssql.GenerateDeployPlanResult = {
    operationId: "",
    success: true,
    errorMessage: "",
    report: "",
};

export const mockSavePublishResult: vscodeMssql.ResultStatus = {
    success: true,
    errorMessage: "",
};

/* Get the deployment options sample model */
export function getDeploymentOptions(): vscodeMssql.DeploymentOptions {
    const sampleDesc = "Sample Description text";
    const sampleName = "Sample Display Name";
    const defaultOptions: vscodeMssql.DeploymentOptions = {
        excludeObjectTypes: { value: [], description: sampleDesc, displayName: sampleName },
        booleanOptionsDictionary: {
            SampleProperty1: { value: false, description: sampleDesc, displayName: sampleName },
            SampleProperty2: { value: false, description: sampleDesc, displayName: sampleName },
        },
        objectTypesDictionary: {
            SampleProperty1: sampleName,
            SampleProperty2: sampleName,
        },
    };
    return defaultOptions;
}

export const mockDacFxOptionsResult: vscodeMssql.DacFxOptionsResult = {
    success: true,
    errorMessage: "",
    deploymentOptions: getDeploymentOptions(),
};

export class MockDacFxService implements vscodeMssql.IDacFxService {
    public exportBacpac(
        _databaseName: string,
        _packageFilePath: string,
        _ownerUri: string,
        _taskExecutionMode: vscodeMssql.TaskExecutionMode,
    ): Thenable<vscodeMssql.DacFxResult> {
        return Promise.resolve(mockDacFxResult);
    }
    public importBacpac(
        _packageFilePath: string,
        _databaseName: string,
        _ownerUri: string,
        _taskExecutionMode: vscodeMssql.TaskExecutionMode,
    ): Thenable<vscodeMssql.DacFxResult> {
        return Promise.resolve(mockDacFxResult);
    }
    public extractDacpac(
        _databaseName: string,
        _packageFilePath: string,
        _applicationName: string,
        _applicationVersion: string,
        _ownerUri: string,
        _taskExecutionMode: vscodeMssql.TaskExecutionMode,
    ): Thenable<vscodeMssql.DacFxResult> {
        return Promise.resolve(mockDacFxResult);
    }
    public createProjectFromDatabase(
        _databaseName: string,
        _targetFilePath: string,
        _applicationName: string,
        _applicationVersion: string,
        _ownerUri: string,
        _extractTarget: vscodeMssql.ExtractTarget,
        _taskExecutionMode: vscodeMssql.TaskExecutionMode,
        _includePermissions?: boolean,
    ): Thenable<vscodeMssql.DacFxResult> {
        return Promise.resolve(mockDacFxResult);
    }
    public deployDacpac(
        _packageFilePath: string,
        _targetDatabaseName: string,
        _upgradeExisting: boolean,
        _ownerUri: string,
        _taskExecutionMode: vscodeMssql.TaskExecutionMode,
        _sqlCommandVariableValues?: Map<string, string>,
        _deploymentOptions?: vscodeMssql.DeploymentOptions,
    ): Thenable<vscodeMssql.DacFxResult> {
        return Promise.resolve(mockDacFxResult);
    }
    public generateDeployScript(
        _packageFilePath: string,
        _targetDatabaseName: string,
        _ownerUri: string,
        _taskExecutionMode: vscodeMssql.TaskExecutionMode,
        _sqlCommandVariableValues?: Map<string, string>,
        _deploymentOptions?: vscodeMssql.DeploymentOptions,
    ): Thenable<vscodeMssql.DacFxResult> {
        return Promise.resolve(mockDacFxResult);
    }
    public generateDeployPlan(
        _packageFilePath: string,
        _targetDatabaseName: string,
        _ownerUri: string,
        _taskExecutionMode: vscodeMssql.TaskExecutionMode,
    ): Thenable<vscodeMssql.GenerateDeployPlanResult> {
        return Promise.resolve(mockGenerateDeployPlanResult);
    }
    public getOptionsFromProfile(_profilePath: string): Thenable<vscodeMssql.DacFxOptionsResult> {
        return Promise.resolve(mockDacFxOptionsResult);
    }
    public validateStreamingJob(
        _packageFilePath: string,
        _createStreamingJobTsql: string,
    ): Thenable<vscodeMssql.ValidateStreamingJobResult> {
        return Promise.resolve(mockDacFxResult);
    }
    public savePublishProfile(
        _profilePath: string,
        _databaseName: string,
        _connectionString: string,
        _sqlCommandVariableValues?: Map<string, string>,
        _deploymentOptions?: vscodeMssql.DeploymentOptions,
    ): Thenable<vscodeMssql.ResultStatus> {
        return Promise.resolve(mockSavePublishResult);
    }
    public getDeploymentOptions(
        _scenario: vscodeMssql.DeploymentScenario,
    ): Thenable<vscodeMssql.GetDeploymentOptionsResult> {
        return Promise.resolve({
            success: true,
            errorMessage: "",
            defaultDeploymentOptions: getDeploymentOptions(),
        });
    }
}

export function createContext(): TestContext {
    let extensionPath = path.join(__dirname, "..", "..");

    return {
        context: {
            subscriptions: [],
            workspaceState: {
                get: () => {
                    return undefined;
                },
                update: () => {
                    return Promise.resolve();
                },
                keys: () => [],
            },
            globalState: {
                setKeysForSync: (): void => {},
                get: (): any | undefined => {
                    return Promise.resolve();
                },
                update: (): Thenable<void> => {
                    return Promise.resolve();
                },
                keys: () => [],
            },
            extensionPath: extensionPath,
            asAbsolutePath: () => {
                return "";
            },
            storagePath: "",
            globalStoragePath: "",
            logPath: "",
            extensionUri: vscode.Uri.parse(""),
            environmentVariableCollection: undefined as any,
            extensionMode: undefined as any,
            globalStorageUri: vscode.Uri.parse("test://"),
            logUri: vscode.Uri.parse("test://"),
            storageUri: vscode.Uri.parse("test://"),
            secrets: undefined as any,
            extension: undefined as any,
            languageModelAccessInformation: undefined as any,
        },
        dacFxService: TypeMoq.Mock.ofType(MockDacFxService),
        outputChannel: {
            name: "",
            append: () => {},
            appendLine: () => {},
            clear: () => {},
            show: () => {},
            hide: () => {},
            dispose: () => {},
            replace: () => {},
        },
    };
}

// Mock test data
export const mockConnectionProfile = {
    connectionName: "My Connection",
    serverName: "My Server",
    databaseName: "My Database",
    userName: "My User",
    password: "My Pwd",
    authenticationType: "SqlLogin",
    savePassword: false,
    groupFullName: "My groupName",
    groupId: "My GroupId",
    providerName: "My Server",
    saveProfile: true,
    id: "My Id",
    options: {
        server: "My Server",
        database: "My Database",
        user: "My User",
        password: "My Pwd",
        authenticationType: "SqlLogin",
        connectionName: "My Connection Name",
    },
};

export const mockURIList: vscode.Uri[] = [
    vscode.Uri.file("/test/folder/abc.sqlproj"),
    vscode.Uri.file("/test/folder/folder1/abc1.sqlproj"),
    vscode.Uri.file("/test/folder/folder2/abc2.sqlproj"),
];

export const mockConnectionInfo = {
    id: undefined,
    userName: "My User",
    password: "My Pwd",
    serverName: "My Server",
    databaseName: "My Database",
    connectionName: "My Connection",
    providerName: undefined,
    groupId: "My GroupId",
    groupFullName: "My groupName",
    authenticationType: "SqlLogin",
    savePassword: false,
    saveProfile: true,
    options: {
        server: "My Server",
        database: "My Database",
        user: "My User",
        password: "My Pwd",
        authenticationType: "SqlLogin",
        connectionName: "My Connection Name",
    },
};

export const mockProjectEndpointInfo: vscodeMssql.SchemaCompareEndpointInfo = {
    endpointType: vscodeMssql.SchemaCompareEndpointType.Project,
    projectFilePath: "",
    extractTarget: vscodeMssql.ExtractTarget.schemaObjectType,
    targetScripts: [],
    dataSchemaProvider: "150",
    connectionDetails: mockConnectionInfo,
    databaseName: "",
    serverDisplayName: "",
    serverName: "",
    ownerUri: "",
    packageFilePath: "",
};

export const mockDatabaseEndpointInfo: vscodeMssql.SchemaCompareEndpointInfo = {
    endpointType: vscodeMssql.SchemaCompareEndpointType.Database,
    databaseName: "My Database",
    serverDisplayName: "My Connection Name",
    serverName: "My Server",
    connectionDetails: mockConnectionInfo,
    ownerUri: "MockUri",
    projectFilePath: "",
    extractTarget: vscodeMssql.ExtractTarget.schemaObjectType,
    targetScripts: [],
    dataSchemaProvider: "",
    packageFilePath: "",
    connectionName: "My Connection Name",
};
