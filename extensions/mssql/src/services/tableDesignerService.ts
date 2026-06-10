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
    TableDesignerMessageNotification,
    TableDesignerProgressNotification,
    TableDesignerGenerateChangePreviewReportRequest,
    TableDesignerGenerateScriptRequest,
} from "../models/contracts/tableDesigner";
import * as designer from "../sharedInterfaces/tableDesigner";
import * as vscode from "vscode";
import { getErrorMessage } from "../utils/utils";
import { getLogger } from "../models/logger";

const logger = getLogger("TableDesignerService");

export class TableDesignerService implements designer.ITableDesignerService {
    private _progressListeners: ((
        progress: designer.TableDesignerProgressNotificationParams,
    ) => void)[] = [];
    private _messageListeners: ((
        message: designer.TableDesignerMessageNotificationParams,
    ) => void)[] = [];

    constructor(private _sqlToolsClient: SqlToolsServiceClient) {
        this._sqlToolsClient.onNotification(TableDesignerProgressNotification.type, (progress) => {
            this._progressListeners.forEach((listener) => listener(progress));
        });
        this._sqlToolsClient.onNotification(TableDesignerMessageNotification.type, (message) => {
            this._messageListeners.forEach((listener) => listener(message));
        });
    }

    async initializeTableDesigner(
        request: designer.InitializeTableDesignerRequest,
    ): Promise<designer.TableDesignerInfo> {
        try {
            return await this._sqlToolsClient.sendRequest(
                InitializeTableDesignerRequest.type,
                request,
            );
        } catch (e) {
            vscode.window.showErrorMessage(getErrorMessage(e));
            logger.error("Failed to initialize table designer", e);
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
            logger.error("Failed to process table designer edit", e);
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
            logger.error("Failed to publish table designer changes", e);
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
            logger.error("Failed to generate table designer script", e);
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
            logger.error("Failed to generate table designer preview report", e);
            throw e;
        }
    }
    async disposeTableDesigner(table: designer.TableInfo): Promise<void> {
        try {
            return await this._sqlToolsClient.sendRequest(DisposeTableDesignerRequest.type, table);
        } catch (e) {
            logger.error("Failed to dispose table designer", e);
            throw e;
        }
    }

    onProgress(
        listener: (progress: designer.TableDesignerProgressNotificationParams) => void,
    ): void {
        this._progressListeners.push(listener);
    }

    removeProgressListener(
        listener: (progress: designer.TableDesignerProgressNotificationParams) => void,
    ): void {
        this._progressListeners = this._progressListeners.filter(
            (registeredListener) => registeredListener !== listener,
        );
    }

    onMessage(listener: (message: designer.TableDesignerMessageNotificationParams) => void): void {
        this._messageListeners.push(listener);
    }

    removeMessageListener(
        listener: (message: designer.TableDesignerMessageNotificationParams) => void,
    ): void {
        this._messageListeners = this._messageListeners.filter(
            (registeredListener) => registeredListener !== listener,
        );
    }
}
