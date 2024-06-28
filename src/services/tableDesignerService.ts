/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from '../languageservice/serviceclient';
import { DisposeTableDesignerRequest, InitializeTableDesignerRequest, ProcessTableDesignerEditRequest, PublishTableDesignerChangesRequest, TableDesignerGenerateChangePreviewReportRequest, TableDesignerGenerateScriptRequest } from '../models/contracts/tableDesigner';
import * as td from '../tableDesigner/tableDesignerInterfaces';

export class TableDesignerService implements td.TableDesignerProvider {
	constructor(private _sqlToolsClient: SqlToolsServiceClient) {
	}
	async initializeTableDesigner(table: td.TableInfo): Promise<td.TableDesignerInfo> {
		try {
			return await this._sqlToolsClient.sendRequest(InitializeTableDesignerRequest.type, table);
		} catch (e) {
			this._sqlToolsClient.logger.error(e);
			throw e;
		}
	}
	async processTableEdit(table: td.TableInfo, tableChangeInfo: td.DesignerEdit): Promise<td.DesignerEditResult<td.TableDesignerView>> {
		try {
			return await this._sqlToolsClient.sendRequest(ProcessTableDesignerEditRequest.type, { tableInfo: table, tableChangeInfo: tableChangeInfo });
		} catch (e) {
			this._sqlToolsClient.logger.error(e);
			throw e;
		}
	}
	async publishChanges(table: td.TableInfo): Promise<td.PublishChangesResult> {
		try {
			return await this._sqlToolsClient.sendRequest(PublishTableDesignerChangesRequest.type, table);
		} catch (e) {
			this._sqlToolsClient.logger.error(e);
			throw e;
		}
	}
	async generateScript(table: td.TableInfo): Promise<string> {
		try {
			return await this._sqlToolsClient.sendRequest(TableDesignerGenerateScriptRequest.type, table);
		} catch (e) {
			this._sqlToolsClient.logger.error(e);
			throw e;
		}
	}
	async generatePreviewReport(table: td.TableInfo): Promise<td.GeneratePreviewReportResult> {
		try {
			return await this._sqlToolsClient.sendRequest(TableDesignerGenerateChangePreviewReportRequest.type, table);
		} catch (e) {
			this._sqlToolsClient.logger.error(e);
			throw e;
		}
	}
	async disposeTableDesigner(table: td.TableInfo): Promise<void> {
		try {
			return await this._sqlToolsClient.sendRequest(DisposeTableDesignerRequest.type, table);
		} catch (e) {
			this._sqlToolsClient.logger.error(e);
			throw e;
		}
	}
}
