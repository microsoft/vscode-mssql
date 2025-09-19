/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import * as Interfaces from "./interfaces";
import * as path from "path";
import { RequestType } from "vscode-languageclient";
import VscodeWrapper from "../controllers/vscodeWrapper";
import SqlToolsServerClient from "../languageservice/serviceclient";
import * as Contracts from "../models/contracts";
import * as Utils from "../models/utils";
import opener from "opener";

type SaveAsRequestParams =
    | Contracts.SaveResultsAsCsvRequestParams
    | Contracts.SaveResultsAsJsonRequestParams
    | Contracts.SaveResultsAsExcelRequestParams
    | Contracts.SaveResultsAsInsertRequestParams;

/**
 *  Handles save results request from the context menu of slickGrid
 */
export default class ResultsSerializer {
    private _client: SqlToolsServerClient;
    private _vscodeWrapper: VscodeWrapper;
    private _uri: string;
    private _filePath: string;

    constructor(client?: SqlToolsServerClient, vscodeWrapper?: VscodeWrapper) {
        if (client) {
            this._client = client;
        } else {
            this._client = SqlToolsServerClient.instance;
        }
        if (vscodeWrapper) {
            this._vscodeWrapper = vscodeWrapper;
        } else {
            this._vscodeWrapper = new VscodeWrapper();
        }
    }

    private promptForFilepath(format: string): Thenable<string> {
        let defaultUri: vscode.Uri;
        if (vscode.Uri.parse(this._uri).scheme === "untitled") {
            defaultUri = undefined;
        } else {
            defaultUri = vscode.Uri.parse(path.dirname(this._uri));
        }
        let fileTypeFilter: { [name: string]: string[] } = {};
        if (format === "csv") {
            fileTypeFilter[LocalizedConstants.fileTypeCSVLabel] = ["csv"];
        } else if (format === "json") {
            fileTypeFilter[LocalizedConstants.fileTypeJSONLabel] = ["json"];
        } else if (format === "excel") {
            fileTypeFilter[LocalizedConstants.fileTypeExcelLabel] = ["xlsx"];
        } else if (format === "insert") {
            fileTypeFilter["SQL Files"] = ["sql"];
        }
        let options = <vscode.SaveDialogOptions>{
            defaultUri: defaultUri,
            filters: fileTypeFilter,
        };
        return this._vscodeWrapper.showSaveDialog(options).then((uri) => {
            if (!uri) {
                return undefined;
            }
            return uri.scheme === "file" ? uri.fsPath : uri.path;
        });
    }

    private getConfigForCsv(): Contracts.SaveResultsAsCsvRequestParams {
        // get save results config from vscode config
        let config = this._vscodeWrapper.getConfiguration(
            Constants.extensionConfigSectionName,
            this._uri,
        );
        let saveConfig = config[Constants.configSaveAsCsv];
        let saveResultsParams = new Contracts.SaveResultsAsCsvRequestParams();

        // if user entered config, set options
        if (saveConfig) {
            if (saveConfig.includeHeaders !== undefined) {
                saveResultsParams.includeHeaders = saveConfig.includeHeaders;
            }
            if (saveConfig.delimiter !== undefined) {
                saveResultsParams.delimiter = saveConfig.delimiter;
            }
            if (saveConfig.lineSeparator !== undefined) {
                saveResultsParams.lineSeperator = saveConfig.lineSeparator;
            }
            if (saveConfig.textIdentifier !== undefined) {
                saveResultsParams.textIdentifier = saveConfig.textIdentifier;
            }
            if (saveConfig.encoding !== undefined) {
                saveResultsParams.encoding = saveConfig.encoding;
            }
        }
        return saveResultsParams;
    }

    private getConfigForJson(): Contracts.SaveResultsAsJsonRequestParams {
        // get save results config from vscode config
        let config = this._vscodeWrapper.getConfiguration(
            Constants.extensionConfigSectionName,
            this._uri,
        );
        let saveConfig = config[Constants.configSaveAsJson];
        let saveResultsParams = new Contracts.SaveResultsAsJsonRequestParams();

        if (saveConfig) {
            // TODO: assign config
        }
        return saveResultsParams;
    }

    private getConfigForExcel(): Contracts.SaveResultsAsExcelRequestParams {
        // get save results config from vscode config
        // Note: we are currently using the configSaveAsCsv setting since it has the option mssql.saveAsCsv.includeHeaders
        // and we want to have just 1 setting that lists this.
        let config = this._vscodeWrapper.getConfiguration(
            Constants.extensionConfigSectionName,
            this._uri,
        );
        let saveConfig = config[Constants.configSaveAsCsv];
        let saveResultsParams = new Contracts.SaveResultsAsExcelRequestParams();

        // if user entered config, set options
        if (saveConfig) {
            if (saveConfig.includeHeaders !== undefined) {
                saveResultsParams.includeHeaders = saveConfig.includeHeaders;
            }
        }
        return saveResultsParams;
    }

    private getConfigForInsert(): Contracts.SaveResultsAsInsertRequestParams {
        // get save results config from vscode config
        // Note: we are currently using the configSaveAsCsv setting since it has the option mssql.saveAsCsv.includeHeaders
        // and we want to have just 1 setting that lists this.
        let config = this._vscodeWrapper.getConfiguration(
            Constants.extensionConfigSectionName,
            this._uri,
        );
        let saveConfig = config[Constants.configSaveAsCsv];
        let saveResultsParams = new Contracts.SaveResultsAsInsertRequestParams();

        // if user entered config, set options
        if (saveConfig) {
            if (saveConfig.includeHeaders !== undefined) {
                saveResultsParams.includeHeaders = saveConfig.includeHeaders;
            }
        }
        return saveResultsParams;
    }

    private getParameters(
        filePath: string,
        batchIndex: number,
        resultSetNo: number,
        format: string,
        selection: Interfaces.ISlickRange,
    ): SaveAsRequestParams {
        const self = this;
        let saveResultsParams: SaveAsRequestParams;
        this._filePath = filePath;

        if (format === "csv") {
            saveResultsParams = self.getConfigForCsv();
        } else if (format === "json") {
            saveResultsParams = self.getConfigForJson();
        } else if (format === "excel") {
            saveResultsParams = self.getConfigForExcel();
        } else if (format === "insert") {
            saveResultsParams = self.getConfigForInsert();
        }

        saveResultsParams.filePath = this._filePath;
        saveResultsParams.ownerUri = this._uri;
        saveResultsParams.resultSetIndex = resultSetNo;
        saveResultsParams.batchIndex = batchIndex;
        if (this.isSelected(selection)) {
            saveResultsParams.rowStartIndex = selection.fromRow;
            saveResultsParams.rowEndIndex = selection.toRow;
            saveResultsParams.columnStartIndex = selection.fromCell;
            saveResultsParams.columnEndIndex = selection.toCell;
        }
        return saveResultsParams;
    }

    /**
     * Check if a range of cells were selected.
     */
    public isSelected(selection: Interfaces.ISlickRange): boolean {
        return (
            selection &&
            !(selection.fromCell === selection.toCell && selection.fromRow === selection.toRow)
        );
    }

    /**
     * Send request to sql tools service to save a result set
     */
    public sendRequestToService(
        filePath: string,
        batchIndex: number,
        resultSetNo: number,
        format: string,
        selection: Interfaces.ISlickRange,
    ): Thenable<void> {
        const self = this;
        let saveResultsParams = self.getParameters(
            filePath,
            batchIndex,
            resultSetNo,
            format,
            selection,
        );
        let type: RequestType<
            Contracts.SaveResultsRequestParams,
            Contracts.SaveResultRequestResult,
            void,
            void
        >;
        if (format === "csv") {
            type = Contracts.SaveResultsAsCsvRequest.type;
        } else if (format === "json") {
            type = Contracts.SaveResultsAsJsonRequest.type;
        } else if (format === "excel") {
            type = Contracts.SaveResultsAsExcelRequest.type;
        } else if (format === "insert") {
            type = Contracts.SaveResultsAsInsertRequest.type;
        }

        self._vscodeWrapper.logToOutputChannel(LocalizedConstants.msgSaveStarted + this._filePath);

        // send message to the sqlserverclient for converting results to the requested format and saving to filepath
        return self._client.sendRequest(type, saveResultsParams).then(
            (result) => {
                if (result.messages) {
                    self._vscodeWrapper.showErrorMessage(
                        LocalizedConstants.msgSaveFailed + result.messages,
                    );
                    self._vscodeWrapper.logToOutputChannel(
                        LocalizedConstants.msgSaveFailed + result.messages,
                    );
                } else {
                    self._vscodeWrapper.showInformationMessage(
                        LocalizedConstants.msgSaveSucceeded + this._filePath,
                    );
                    self._vscodeWrapper.logToOutputChannel(
                        LocalizedConstants.msgSaveSucceeded + filePath,
                    );
                    self.openSavedFile(self._filePath, format);
                }
            },
            (error) => {
                self._vscodeWrapper.showErrorMessage(
                    LocalizedConstants.msgSaveFailed + error.message,
                );
                self._vscodeWrapper.logToOutputChannel(
                    LocalizedConstants.msgSaveFailed + error.message,
                );
            },
        );
    }

    /**
     * Handle save request by getting filename from user and sending request to service
     */
    public onSaveResults(
        uri: string,
        batchIndex: number,
        resultSetNo: number,
        format: string,
        selection: Interfaces.ISlickRange[],
    ): Thenable<void> {
        const self = this;
        this._uri = uri;

        // prompt for filepath
        return self.promptForFilepath(format).then(
            function (filePath): void {
                if (!Utils.isEmpty(filePath)) {
                    self.sendRequestToService(
                        filePath,
                        batchIndex,
                        resultSetNo,
                        format,
                        selection ? selection[0] : undefined,
                    );
                }
            },
            (error) => {
                self._vscodeWrapper.showErrorMessage(error.message);
                self._vscodeWrapper.logToOutputChannel(error.message);
            },
        );
    }

    /**
     * Open the saved file in a new vscode editor pane
     */
    public openSavedFile(filePath: string, format: string): void {
        const self = this;
        if (format === "excel") {
            // This will not open in VSCode as it's treated as binary. Use the native file opener instead
            // Note: must use filePath here, URI does not open correctly
            opener(filePath, undefined, (error) => {
                if (error) {
                    self._vscodeWrapper.showErrorMessage(error);
                }
            });
        } else {
            let uri = vscode.Uri.file(filePath);
            self._vscodeWrapper.openTextDocument(uri).then(
                (doc: vscode.TextDocument) => {
                    // Show open document and set focus
                    self._vscodeWrapper
                        .showTextDocument(doc, {
                            viewColumn: vscode.ViewColumn.One,
                            preserveFocus: false,
                            preview: false,
                        })
                        .then(undefined, (error) => {
                            self._vscodeWrapper.showErrorMessage(error);
                        });
                },
                (error) => {
                    self._vscodeWrapper.showErrorMessage(error);
                },
            );
        }
    }
}
