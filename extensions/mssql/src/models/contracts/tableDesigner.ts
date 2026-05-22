/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as designer from "../../sharedInterfaces/tableDesigner";
import { NotificationType, RequestType } from "vscode-languageclient";

export interface ITableDesignerEditRequestParams {
    tableInfo: designer.TableInfo;
    tableChangeInfo: designer.DesignerEdit;
}

export namespace InitializeTableDesignerRequest {
    export const type = new RequestType<
        designer.InitializeTableDesignerRequest,
        designer.TableDesignerInfo,
        void,
        void
    >("tabledesigner/initialize");
}

export namespace TableDesignerProgressNotification {
    export const type = new NotificationType<
        designer.TableDesignerProgressNotificationParams,
        void
    >("tabledesigner/progress");
}

export namespace TableDesignerMessageNotification {
    export const type = new NotificationType<designer.TableDesignerMessageNotificationParams, void>(
        "tabledesigner/message",
    );
}

export namespace ProcessTableDesignerEditRequest {
    export const type = new RequestType<
        ITableDesignerEditRequestParams,
        designer.DesignerEditResult<designer.TableDesignerView>,
        void,
        void
    >("tabledesigner/processedit");
}

export namespace PublishTableDesignerChangesRequest {
    export const type = new RequestType<
        designer.TableInfo,
        designer.PublishChangesResult,
        void,
        void
    >("tabledesigner/publish");
}

export namespace TableDesignerGenerateScriptRequest {
    export const type = new RequestType<designer.TableInfo, string, void, void>(
        "tabledesigner/script",
    );
}

export namespace TableDesignerGenerateChangePreviewReportRequest {
    export const type = new RequestType<
        designer.TableInfo,
        designer.GeneratePreviewReportResult,
        void,
        void
    >("tabledesigner/generatepreviewreport");
}

export namespace DisposeTableDesignerRequest {
    export const type = new RequestType<designer.TableInfo, void, void, void>(
        "tabledesigner/dispose",
    );
}
