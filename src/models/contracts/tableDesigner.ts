/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as td from '../../tableDesigner/tableDesignerInterfaces';
import { RequestType } from 'vscode-languageclient';

export interface ITableDesignerEditRequestParams {
	tableInfo: td.TableInfo;
	tableChangeInfo: td.DesignerEdit;
}

export namespace InitializeTableDesignerRequest {
	export const type = new RequestType<td.TableInfo, td.TableDesignerInfo, void, void>('tabledesigner/initialize');
}

export namespace ProcessTableDesignerEditRequest {
	export const type = new RequestType<ITableDesignerEditRequestParams, td.DesignerEditResult<td.TableDesignerView>, void, void>('tabledesigner/processedit');
}

export namespace PublishTableDesignerChangesRequest {
	export const type = new RequestType<td.TableInfo, td.PublishChangesResult, void, void>('tabledesigner/publish');
}

export namespace TableDesignerGenerateScriptRequest {
	export const type = new RequestType<td.TableInfo, string, void, void>('tabledesigner/script');
}

export namespace TableDesignerGenerateChangePreviewReportRequest {
	export const type = new RequestType<td.TableInfo, td.GeneratePreviewReportResult, void, void>('tabledesigner/generatepreviewreport');
}

export namespace DisposeTableDesignerRequest {
	export const type = new RequestType<td.TableInfo, void, void, void>('tabledesigner/dispose');
}
