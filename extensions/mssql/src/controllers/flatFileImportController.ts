/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";
import { ApiStatus } from "../sharedInterfaces/webview";
import * as Loc from "../constants/locConstants";
import { FormWebviewController } from "../forms/formWebviewController";
import {
    FlatFileImportFormItemSpec,
    FlatFileImportFormState,
    FlatFileImportReducers,
    FlatFileImportState,
} from "../sharedInterfaces/flatFileImport";
import {
    ChangeColumnSettingsParams,
    ProseDiscoveryParams,
    FlatFileProvider,
    GetColumnInfoParams,
} from "../models/contracts/flatFile";
import { FormItemSpec, FormItemType } from "../sharedInterfaces/form";
import { ConnectionNode } from "../objectExplorer/nodes/connectionNode";
import { defaultSchema } from "../constants/constants";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { RequestType } from "vscode-languageclient";
import { SimpleExecuteResult } from "vscode-mssql";
import { getSchemaNamesFromResult } from "../copilot/tools/listSchemasTool";
import path from "path";
import ConnectionManager from "./connectionManager";

/**
 * Controller for the Add Firewall Rule dialog
 */
export class FlatFileImportController extends FormWebviewController<
    FlatFileImportFormState,
    FlatFileImportState,
    FlatFileImportFormItemSpec,
    FlatFileImportReducers
> {
    public readonly IMPORT_FILE_TYPES = ["csv", "txt"];
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private client: SqlToolsServiceClient,
        private connectionManager: ConnectionManager,
        private provider: FlatFileProvider,
        private node: ConnectionNode,
        private databases: string[],
    ) {
        super(
            context,
            vscodeWrapper,
            "flatFileImport",
            "flatFileImport",
            new FlatFileImportState(),
            {
                title: Loc.FlatFileImport.flatFileImportTitle,
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(context.extensionUri, "media", "database_light.svg"),
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "database_dark.svg"),
                },
            },
        );
        void this.initialize();
    }

    /**
     * Initialize the controller
     */
    private async initialize(): Promise<void> {
        // Set database names for dropdown
        this.state.serverName = this.node.connectionProfile.server;
        this.state.formState.databaseName = ObjectExplorerUtils.getDatabaseName(this.node);
        this.state.isDatabase = this.state.formState.databaseName !== "";

        this.state.formComponents = this.setFlatFileFormComponents(this.state.isDatabase);
        const databaseNameComponent = this.state.formComponents["databaseName"];
        if (!this.state.isDatabase) {
            databaseNameComponent.options = this.databases.map((db) => ({
                displayName: db,
                value: db,
            }));
            this.state.formState.databaseName = this.databases[0];
        }

        const schemas = await this.getSchemas(this.state.formState.databaseName);
        const tableSchemaComponent = this.state.formComponents["tableSchema"];
        tableSchemaComponent.options = schemas.map((schema) => ({
            displayName: schema,
            value: schema,
        }));
        this.state.formState.tableSchema = schemas.includes(defaultSchema)
            ? defaultSchema
            : schemas[0];

        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
        this.updateState();
    }

    /**
     * Register reducers for handling actions from the webview
     */
    private registerRpcHandlers(): void {
        this.registerReducer("getTablePreview", async (state, payload) => {
            const params: ProseDiscoveryParams = {
                filePath: payload.filePath,
                tableName: payload.tableName,
                schemaName: payload.schemaName,
                fileType: payload.fileType,
            };
            try {
                state.tablePreview = await this.provider.sendProseDiscoveryRequest(params);
                state.tablePreviewStatus = ApiStatus.Loaded;
            } catch (error) {
                state.errorMessage = Loc.FlatFileImport.unableToGetTablePreview(error.message);
                state.tablePreviewStatus = ApiStatus.Error;
            }
            return state;
        });

        this.registerReducer("getColumnInfo", async (state, _payload) => {
            const response = await this.provider.sendGetColumnInfoRequest(
                {} as GetColumnInfoParams,
            );
            console.log(response);
            return state;
        });

        this.registerReducer("setColumnChanges", async (state, payload) => {
            state.columnChanges = payload.columnChanges;
            return state;
        });

        this.registerReducer("changeColumnSettings", async (state, payload) => {
            const params: ChangeColumnSettingsParams = {
                index: payload.index,
                newName: payload.newName,
                newDataType: payload.newDataType,
                newNullable: payload.newNullable,
                newIsPrimaryKey: payload.newIsPrimaryKey,
            };
            const response = await this.provider.sendChangeColumnSettingsRequest(params);
            console.log(response);
            return state;
        });
        this.registerReducer("importData", async (state, _payload) => {
            if (state.importDataStatus !== ApiStatus.NotStarted) return;

            state.importDataStatus = ApiStatus.Loading;
            this.updateState();

            const connDetails = this.connectionManager.createConnectionDetails({
                ...this.node.connectionProfile,
                database: state.formState.databaseName,
            });
            const connectionString = await this.connectionManager.getConnectionString(
                connDetails,
                true,
                true,
            );
            const batchSize = 1000; // default batch size
            const azureAccessToken = this.node.connectionProfile.azureAccountToken;

            for (const colChange of state.columnChanges) {
                try {
                    const colChangeResult =
                        await this.provider.sendChangeColumnSettingsRequest(colChange);
                    if (colChangeResult.result.success === false) {
                        throw new Error(colChangeResult.result.errorMessage);
                    }
                } catch (error) {
                    state.errorMessage = error.message;
                    state.importDataStatus = ApiStatus.Error;
                    return state;
                }
            }

            try {
                const insertDataResult = await this.provider.sendInsertDataRequest({
                    connectionString: connectionString,
                    batchSize: batchSize,
                    azureAccessToken: azureAccessToken,
                });
                if (!insertDataResult.result.success) {
                    throw new Error(insertDataResult.result.errorMessage);
                }
                state.importDataStatus = ApiStatus.Loaded;
            } catch (error) {
                state.errorMessage = error.message;
                state.importDataStatus = ApiStatus.Error;
            }

            return state;
        });
        this.registerReducer("openVSCodeFileBrowser", async (state, _payload) => {
            const selectedFilePath = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: Loc.FlatFileImport.selectFileToImport,
                filters: {
                    [Loc.FlatFileImport.importFileTypes]: this.IMPORT_FILE_TYPES,
                },
            });
            const filePath = selectedFilePath[0]?.fsPath || "";
            state.formState.flatFilePath = filePath;

            const fileName = filePath.substring(
                filePath.lastIndexOf(path.sep) + 1,
                filePath.lastIndexOf("."),
            );
            state.formState.tableName = fileName ?? "";

            const filePathValid =
                (await this.validateForm(state.formState, "flatFilePath", true)).length === 0;
            if (filePathValid) {
                state.formErrors = state.formErrors.filter((err) => err !== "flatFilePath");
            }

            return state;
        });
    }

    async updateItemVisibility() {}

    protected getActiveFormComponents(
        state: FlatFileImportState,
    ): (keyof FlatFileImportFormState)[] {
        return Object.keys(state.formComponents) as (keyof FlatFileImportFormState)[];
    }

    private setFlatFileFormComponents(
        isDatabase: boolean,
    ): Record<
        string,
        FormItemSpec<FlatFileImportFormState, FlatFileImportState, FlatFileImportFormItemSpec>
    > {
        const createFormItem = (
            spec: Partial<FlatFileImportFormItemSpec>,
        ): FlatFileImportFormItemSpec =>
            ({
                required: false,
                isAdvancedOption: false,
                ...spec,
            }) as FlatFileImportFormItemSpec;

        return {
            databaseName: createFormItem({
                propertyName: "databaseName",
                label: Loc.FlatFileImport.databaseTheTableIsCreatedIn,
                required: true,
                type: isDatabase ? FormItemType.Input : FormItemType.Dropdown,
                options: isDatabase ? undefined : [],
                validate(_state, value) {
                    const isEmpty = value.toString().trim().length === 0;
                    return {
                        isValid: !isEmpty,
                        validationMessage: isEmpty
                            ? Loc.FlatFileImport.databaseRequired
                            : undefined,
                    };
                },
            }),
            flatFilePath: createFormItem({
                propertyName: "flatFilePath",
                label: Loc.FlatFileImport.locationOfTheFileToBeImported,
                required: true,
                type: FormItemType.Input,
                validate(_state, value) {
                    const isEmpty = value.toString().trim().length === 0;
                    return {
                        isValid: !isEmpty,
                        validationMessage: isEmpty
                            ? Loc.FlatFileImport.importFileRequired
                            : undefined,
                    };
                },
            }),
            tableName: createFormItem({
                propertyName: "tableName",
                type: FormItemType.Input,
                required: true,
                label: Loc.FlatFileImport.newTableName,
                validate(_state, value) {
                    const isEmpty = value.toString().trim().length === 0;
                    return {
                        isValid: !isEmpty,
                        validationMessage: isEmpty
                            ? Loc.FlatFileImport.tableNameRequired
                            : undefined,
                    };
                },
            }),
            tableSchema: createFormItem({
                propertyName: "tableSchema",
                label: Loc.FlatFileImport.tableSchema,
                required: true,
                type: FormItemType.SearchableDropdown,
                options: [],
                validate(_state, value) {
                    const isEmpty = value.toString().trim().length === 0;
                    return {
                        isValid: !isEmpty,
                        validationMessage: isEmpty ? Loc.FlatFileImport.schemaRequired : undefined,
                    };
                },
            }),
        };
    }

    private async getSchemas(databaseName: string): Promise<string[]> {
        const getSchemaQuery = `USE ${databaseName};
            SELECT name
            FROM sys.schemas
            WHERE name NOT IN ('sys', 'information_schema')
            ORDER BY name
            `;
        const result = await this.client.sendRequest(
            new RequestType<
                { ownerUri: string; queryString: string },
                SimpleExecuteResult,
                void,
                void
            >("query/simpleexecute"),
            {
                ownerUri: this.node.sessionId,
                queryString: getSchemaQuery,
            },
        );
        return getSchemaNamesFromResult(result);
    }
}
