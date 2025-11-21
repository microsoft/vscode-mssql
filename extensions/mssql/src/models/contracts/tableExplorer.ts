/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as tableExplorer from "../../sharedInterfaces/tableExplorer";
import { RequestType, NotificationType } from "vscode-languageclient";

//#region edit/initialize

export namespace EditInitializeRequest {
  export const type = new RequestType<
    tableExplorer.EditInitializeParams,
    tableExplorer.EditInitializeResult,
    void,
    void
  >("edit/initialize");
}

//#endregion

//#region edit/sessionReady

export namespace EditSessionReadyNotification {
  export const type = new NotificationType<
    tableExplorer.EditSessionReadyParams,
    void
  >("edit/sessionReady");
}

//#endregion

//#region  edit/subset

export namespace EditSubsetRequest {
  export const type = new RequestType<
    tableExplorer.EditSubsetParams,
    tableExplorer.EditSubsetResult,
    void,
    void
  >("edit/subset");
}

//#endregion

//#region edit/commit
export namespace EditCommitRequest {
  export const type = new RequestType<
    tableExplorer.EditCommitParams,
    tableExplorer.EditCommitResult,
    void,
    void
  >("edit/commit");
}

//#endregion

//#region edit/createRow

export namespace EditCreateRowRequest {
  export const type = new RequestType<
    tableExplorer.EditCreateRowParams,
    tableExplorer.EditCreateRowResult,
    void,
    void
  >("edit/createRow");
}

//#endregion

//#region edit/deleteRow

export namespace EditDeleteRowRequest {
  export const type = new RequestType<
    tableExplorer.EditDeleteRowParams,
    tableExplorer.EditDeleteRowResult,
    void,
    void
  >("edit/deleteRow");
}

//#endregion

//#region edit/revertRow

export namespace EditRevertRowRequest {
  export const type = new RequestType<
    tableExplorer.EditRevertRowParams,
    tableExplorer.EditRevertRowResult,
    void,
    void
  >("edit/revertRow");
}

//#endregion

//#region edit/updateCell

export namespace EditUpdateCellRequest {
  export const type = new RequestType<
    tableExplorer.EditUpdateCellParams,
    tableExplorer.EditUpdateCellResult,
    void,
    void
  >("edit/updateCell");
}

//#endregion

//#region edit/revertCell

export namespace EditRevertCellRequest {
  export const type = new RequestType<
    tableExplorer.EditRevertCellParams,
    tableExplorer.EditRevertCellResult,
    void,
    void
  >("edit/revertCell");
}

//#endregion

//#region edit/dispose

export namespace EditDisposeRequest {
  export const type = new RequestType<
    tableExplorer.EditDisposeParams,
    tableExplorer.EditDisposeResult,
    void,
    void
  >("edit/dispose");
}

//#endregion

//#region edit/script

export namespace EditScriptRequest {
  export const type = new RequestType<
    tableExplorer.EditScriptParams,
    tableExplorer.EditScriptResult,
    void,
    void
  >("edit/script");
}

//#endregion
