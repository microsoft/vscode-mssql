import * as vscodeMssql from 'vscode-mssql';
import { RequestType } from 'vscode-languageclient';

export interface ITableDesignerEditRequestParams {
	tableInfo: vscodeMssql.designers.TableInfo;
	tableChangeInfo: vscodeMssql.designers.DesignerEdit;
}

export namespace InitializeTableDesignerRequest {
	export const type = new RequestType<vscodeMssql.designers.TableInfo, vscodeMssql.designers.TableDesignerInfo, void, void>('tabledesigner/initialize');
}

export namespace ProcessTableDesignerEditRequest {
	export const type = new RequestType<ITableDesignerEditRequestParams, vscodeMssql.designers.DesignerEditResult<vscodeMssql.designers.TableDesignerView>, void, void>('tabledesigner/processedit');
}

export namespace PublishTableDesignerChangesRequest {
	export const type = new RequestType<vscodeMssql.designers.TableInfo, vscodeMssql.designers.PublishChangesResult, void, void>('tabledesigner/publish');
}

export namespace TableDesignerGenerateScriptRequest {
	export const type = new RequestType<vscodeMssql.designers.TableInfo, string, void, void>('tabledesigner/script');
}

export namespace TableDesignerGenerateChangePreviewReportRequest {
	export const type = new RequestType<vscodeMssql.designers.TableInfo, vscodeMssql.designers.GeneratePreviewReportResult, void, void>('tabledesigner/generatepreviewreport');
}

export namespace DisposeTableDesignerRequest {
	export const type = new RequestType<vscodeMssql.designers.TableInfo, void, void, void>('tabledesigner/dispose');
}
