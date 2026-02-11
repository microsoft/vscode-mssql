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
    FlatFileStepType,
} from "../sharedInterfaces/flatFileImport";
import { ProseDiscoveryParams, FlatFileProvider } from "../models/contracts/flatFile";
import { FormItemSpec, FormItemType } from "../sharedInterfaces/form";
import { defaultSchema, flatFileImportFileTypes } from "../constants/constants";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { RequestType } from "vscode-languageclient";
import { SimpleExecuteResult } from "vscode-mssql";
import { getSchemaNamesFromResult } from "../copilot/tools/listSchemasTool";
import * as path from "path";
import ConnectionManager from "./connectionManager";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { Deferred } from "../protocol";
import { getErrorMessage } from "../utils/utils";
import { ConnectionProfile } from "../models/connectionProfile";

/**
 * Controller for the Flat File Import dialog
 */
export class FlatFileImportWebviewController extends FormWebviewController<
    FlatFileImportFormState,
    FlatFileImportState,
    FlatFileImportFormItemSpec,
    FlatFileImportReducers
> {
    public readonly initialized: Deferred<void> = new Deferred<void>();
    private databases: string[] = [];
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private client: SqlToolsServiceClient,
        private connectionManager: ConnectionManager,
        private provider: FlatFileProvider,
        private profile: ConnectionProfile,
        private ownerUri: string,
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
        void this.initialize()
            .then(() => {
                this.updateState();
                this.initialized.resolve();
            })
            .catch((err) => {
                this.logger.error(
                    `Error initializing FlatFileImportWebviewController: ${getErrorMessage(err)}`,
                );
                this.initialized.reject(err);
            });
    }

    /**
     * Initialize the controller
     */
    private async initialize(): Promise<void> {
        // Set database names for dropdown
        this.state.serverName = this.profile.server;
        this.state.formState.databaseName = this.profile.database;

        this.state.formComponents = this.setFlatFileFormComponents();

        const connectionUri = this.connectionManager.getUriForConnection(this.profile);

        this.databases = await this.connectionManager.listDatabases(connectionUri);

        // If no databases found, show error message and return early
        if (this.databases.length === 0) {
            this.state.errorMessage = Loc.FlatFileImport.noDatabasesFoundToImportInto;
            this.state.loadState = ApiStatus.Error;
            this.updateState();
            return;
        }

        // Set options for database dropdown
        this.state.formComponents["databaseName"].options = this.databases.map((db) => ({
            displayName: db,
            value: db,
        }));

        // If database name is not set, set it to the first database in the list
        if (!this.state.formState.databaseName) {
            this.state.formState.databaseName = this.databases[0];
        }

        // Load schemas for the default/initially selected database
        await this.handleLoadSchemas();

        this.registerRpcHandlers();
        this.state.loadState = ApiStatus.Loaded;
        this.updateState();

        sendActionEvent(TelemetryViews.FlatFile, TelemetryActions.Initialize);
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
            };
            try {
                state.tablePreview = await this.provider.sendProseDiscoveryRequest(params);
                state.tablePreviewStatus = ApiStatus.Loaded;
            } catch (error) {
                state.errorMessage = Loc.FlatFileImport.fetchTablePreviewError;
                state.fullErrorMessage = error.message;
                state.tablePreviewStatus = ApiStatus.Error;
                sendErrorEvent(
                    TelemetryViews.FlatFile,
                    TelemetryActions.TablePreview,
                    error,
                    false,
                );
                this.logger.error(`Error fetching table preview: ${getErrorMessage(error)}`);
            }
            return state;
        });

        this.registerReducer("setColumnChanges", async (state, payload) => {
            state.columnChanges = payload.columnChanges;
            return state;
        });

        this.registerReducer("importData", async (state, _payload) => {
            if (state.importDataStatus !== ApiStatus.NotStarted) return;

            state.importDataStatus = ApiStatus.Loading;
            this.updateState();

            try {
                // Get connection string with password to perform the data import
                const connDetails = this.connectionManager.createConnectionDetails({
                    ...this.profile,
                    database: state.formState.databaseName,
                });
                const connectionString = await this.connectionManager.getConnectionString(
                    connDetails,
                    true, // include password
                    true, // include application name
                );

                // Set other default params for the import request
                const batchSize = 1000; // default batch size
                const azureAccessToken = this.profile.azureAccountToken;

                // Send column changes (if any) before sending the import request
                for (const colChange of state.columnChanges) {
                    const colChangeResult =
                        await this.provider.sendChangeColumnSettingsRequest(colChange);
                    if (colChangeResult.result.success === false) {
                        throw new Error(colChangeResult.result.errorMessage);
                    }
                }

                // Send import request
                const insertDataResult = await this.provider.sendInsertDataRequest({
                    connectionString: connectionString,
                    batchSize: batchSize,
                    azureAccessToken: azureAccessToken,
                });

                // Check result for errors
                if (!insertDataResult.result.success) {
                    throw new Error(insertDataResult.result.errorMessage);
                }
                state.importDataStatus = ApiStatus.Loaded;

                sendActionEvent(TelemetryViews.FlatFile, TelemetryActions.ImportFile);
            } catch (error) {
                state.errorMessage = Loc.FlatFileImport.importFailed;
                state.fullErrorMessage = error.message;
                state.importDataStatus = ApiStatus.Error;

                sendErrorEvent(TelemetryViews.FlatFile, TelemetryActions.ImportFile, error, false);
                this.logger.error(`Error importing data: ${getErrorMessage(error)}`);
            }

            return state;
        });

        this.registerReducer("openVSCodeFileBrowser", async (state, _payload) => {
            const filePathComponent = state.formComponents["flatFilePath"];
            // Open file browser to select flat file for import
            const selectedFilePath = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: Loc.FlatFileImport.selectFileToImport,
                filters: {
                    [Loc.FlatFileImport.importFileTypes]: flatFileImportFileTypes,
                },
            });

            // If no file selected, set form error.
            if (!selectedFilePath) {
                if (!state.formErrors.includes("flatFilePath")) {
                    state.formErrors.push("flatFilePath");
                }
                filePathComponent.validation = filePathComponent.validate(state, "");
                return state;
            }

            // Otherwise, update form state with file path and name (without extension)
            const filePath = selectedFilePath[0].fsPath;
            state.formState.flatFilePath = filePath;

            const fileName = filePath.substring(
                filePath.lastIndexOf(path.sep) + 1,
                filePath.lastIndexOf("."),
            );
            state.formState.tableName = fileName ?? "";

            // Clear form error if it exists
            if (state.formErrors.includes("flatFilePath")) {
                state.formErrors = state.formErrors.filter((e) => e !== "flatFilePath");
            }
            filePathComponent.validation = filePathComponent.validate(state, filePath);

            return state;
        });
        this.registerReducer("resetState", async (state, payload) => {
            switch (payload.resetType) {
                case FlatFileStepType.ImportData:
                    state.importDataStatus = ApiStatus.NotStarted;
                    state.currentStep = FlatFileStepType.ColumnChanges;
                    break;
                case FlatFileStepType.ColumnChanges:
                    state.columnChanges = [];
                    state.currentStep = FlatFileStepType.TablePreview;
                    break;
                case FlatFileStepType.TablePreview:
                    state.tablePreviewStatus = ApiStatus.Loading;
                    state.tablePreview = undefined;
                    state.currentStep = FlatFileStepType.Form;
                    break;
                case FlatFileStepType.Form:
                    state.importDataStatus = ApiStatus.NotStarted;
                    state.columnChanges = [];
                    state.tablePreviewStatus = ApiStatus.Loading;
                    state.tablePreview = undefined;
                    state.formState = {
                        databaseName: state.formState.databaseName,
                        flatFilePath: "",
                        tableName: "",
                        tableSchema: defaultSchema,
                    };
                    state.formErrors = [];
                    state.currentStep = FlatFileStepType.Form;
                    break;
                default:
                    const errorMessage = `Unknown reset type: ${payload.resetType}`;
                    this.logger.error(errorMessage);
                    state.loadState = ApiStatus.Error;
                    sendErrorEvent(
                        TelemetryViews.FlatFile,
                        TelemetryActions.ResetState,
                        new Error(errorMessage),
                        false,
                    );
                    break;
            }

            return state;
        });
        this.registerReducer("setStep", async (state, payload) => {
            state.currentStep = payload.step;
            return state;
        });
        this.registerReducer("dispose", async (state, _payload) => {
            this.panel.dispose();
            this.dispose();
            return state;
        });
    }

    async updateItemVisibility() {}

    protected getActiveFormComponents(
        state: FlatFileImportState,
    ): (keyof FlatFileImportFormState)[] {
        return Object.keys(state.formComponents) as (keyof FlatFileImportFormState)[];
    }

    async afterSetFormProperty(propertyName: keyof FlatFileImportFormState): Promise<void> {
        if (propertyName === "databaseName") {
            void this.handleLoadSchemas();
        }
    }

    private setFlatFileFormComponents(): Record<
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
                type: FormItemType.Dropdown,
                options: [],
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

    /**
     * Gets the list of schemas for a given database to populate the schema dropdown in the form
     * @param databaseName The name of the database for which to retrieve schemas
     * @returns A promise that resolves to an array of schema names
     */
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
                ownerUri: this.ownerUri,
                queryString: getSchemaQuery,
            },
        );
        return getSchemaNamesFromResult(result);
    }

    /**
     * Handles loading schemas when the database selection changes.
     * This includes setting the appropriate loading and error states,
     * and updating the form component options with the retrieved schemas.
     */
    private async handleLoadSchemas(): Promise<void> {
        this.state.schemaLoadStatus = ApiStatus.Loading;
        this.state.formState.tableSchema = "";
        const tableSchemaComponent = this.state.formComponents["tableSchema"];
        tableSchemaComponent.options = [];
        tableSchemaComponent.placeholder = Loc.FlatFileImport.loadingSchemas;
        this.updateState();

        let schemas: string[] = [];
        try {
            schemas = await this.getSchemas(this.state.formState.databaseName);
            tableSchemaComponent.options = schemas.map((schema) => ({
                displayName: schema,
                value: schema,
            }));
            this.state.formState.tableSchema =
                schemas.length === 0
                    ? ""
                    : schemas.includes(defaultSchema)
                      ? defaultSchema
                      : schemas[0];

            this.state.schemaLoadStatus = ApiStatus.Loaded;
        } catch (error) {
            this.state.errorMessage = Loc.FlatFileImport.fetchSchemasError;
            this.state.fullErrorMessage = error.message;
            this.state.schemaLoadStatus = ApiStatus.Error;
            tableSchemaComponent.placeholder = Loc.FlatFileImport.noSchemasFound;
            this.logger.error(`Error fetching schemas: ${getErrorMessage(error)}`);
        }
        this.updateState();
    }
}
