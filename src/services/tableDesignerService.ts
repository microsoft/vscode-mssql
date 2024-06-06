/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from '../languageservice/serviceclient';
import * as vscodeMssql from 'vscode-mssql';
import { DisposeTableDesignerRequest, InitializeTableDesignerRequest, ProcessTableDesignerEditRequest, PublishTableDesignerChangesRequest, TableDesignerGenerateChangePreviewReportRequest, TableDesignerGenerateScriptRequest } from '../models/contracts/tableDesigner';

export class TableDesignerService implements vscodeMssql.designers.TableDesignerProvider {
	constructor(private _sqlToolsClient: SqlToolsServiceClient) {
	}
	async initializeTableDesigner(table: vscodeMssql.designers.TableInfo): Promise<vscodeMssql.designers.TableDesignerInfo> {
		try {
			return await this._sqlToolsClient.sendRequest(InitializeTableDesignerRequest.type, table);
		} catch (e) {
			this._sqlToolsClient.logger.error(e);
			throw e;
		}
	}
	async processTableEdit(table: vscodeMssql.designers.TableInfo, tableChangeInfo: vscodeMssql.designers.DesignerEdit): Promise<vscodeMssql.designers.DesignerEditResult<vscodeMssql.designers.TableDesignerView>> {
		try {
			return await this._sqlToolsClient.sendRequest(ProcessTableDesignerEditRequest.type, { tableInfo: table, tableChangeInfo: tableChangeInfo });
		} catch (e) {
			this._sqlToolsClient.logger.error(e);
			throw e;
		}
	}
	async publishChanges(table: vscodeMssql.designers.TableInfo): Promise<vscodeMssql.designers.PublishChangesResult> {
		try {
			return await this._sqlToolsClient.sendRequest(PublishTableDesignerChangesRequest.type, table);
		} catch (e) {
			this._sqlToolsClient.logger.error(e);
			throw e;
		}
	}
	async generateScript(table: vscodeMssql.designers.TableInfo): Promise<string> {
		try {
			return await this._sqlToolsClient.sendRequest(TableDesignerGenerateScriptRequest.type, table);
		} catch (e) {
			this._sqlToolsClient.logger.error(e);
			throw e;
		}
	}
	async generatePreviewReport(table: vscodeMssql.designers.TableInfo): Promise<vscodeMssql.designers.GeneratePreviewReportResult> {
		try {
			return await this._sqlToolsClient.sendRequest(TableDesignerGenerateChangePreviewReportRequest.type, table);
		} catch (e) {
			this._sqlToolsClient.logger.error(e);
			throw e;
		}
	}
	async disposeTableDesigner(table: vscodeMssql.designers.TableInfo): Promise<void> {
		try {
			return await this._sqlToolsClient.sendRequest(DisposeTableDesignerRequest.type, table);
		} catch (e) {
			this._sqlToolsClient.logger.error(e);
			throw e;
		}
	}
}
