/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import {
    DisposeTableDesignerRequest,
    InitializeTableDesignerRequest,
    ProcessTableDesignerEditRequest,
    PublishTableDesignerChangesRequest,
    TableDesignerGenerateChangePreviewReportRequest,
    TableDesignerGenerateScriptRequest,
} from "../models/contracts/tableDesigner";
import * as designer from "../sharedInterfaces/tableDesigner";
import * as vscode from "vscode";
import { getErrorMessage } from "../utils/utils";
export class TableDesignerService implements designer.ITableDesignerService {
    constructor(private _sqlToolsClient: SqlToolsServiceClient) {}
    async initializeTableDesigner(table: designer.TableInfo): Promise<designer.TableDesignerInfo> {
        try {
            return await this._sqlToolsClient.sendRequest(
                InitializeTableDesignerRequest.type,
                table,
            );
        } catch (e) {
            vscode.window.showErrorMessage(getErrorMessage(e));
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }
    async processTableEdit(
        table: designer.TableInfo,
        tableChangeInfo: designer.DesignerEdit,
    ): Promise<designer.DesignerEditResult<designer.TableDesignerView>> {
        try {
            return await this._sqlToolsClient.sendRequest(ProcessTableDesignerEditRequest.type, {
                tableInfo: table,
                tableChangeInfo: tableChangeInfo,
            });
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }
    async publishChanges(table: designer.TableInfo): Promise<designer.PublishChangesResult> {
        try {
            return await this._sqlToolsClient.sendRequest(
                PublishTableDesignerChangesRequest.type,
                table,
            );
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }
    async generateScript(table: designer.TableInfo): Promise<string> {
        try {
            return await this._sqlToolsClient.sendRequest(
                TableDesignerGenerateScriptRequest.type,
                table,
            );
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }
    async generatePreviewReport(
        table: designer.TableInfo,
    ): Promise<designer.GeneratePreviewReportResult> {
        try {
            return await this._sqlToolsClient.sendRequest(
                TableDesignerGenerateChangePreviewReportRequest.type,
                table,
            );
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }
    async disposeTableDesigner(table: designer.TableInfo): Promise<void> {
        try {
            return await this._sqlToolsClient.sendRequest(DisposeTableDesignerRequest.type, table);
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }
}
