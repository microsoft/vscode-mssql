/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ed from "../../sharedInterfaces/editData";
import { NotificationType, RequestType } from "vscode-languageclient";

// edit/createRow -----------------------------------------------------------------------------
export namespace EditCreateRowRequest {
    export const type = new RequestType<
        ed.EditCreateRowParams,
        ed.EditCreateRowResult,
        void,
        void
    >("edit/createRow");
}

// edit/deleteRow -----------------------------------------------------------------------------
export namespace EditDeleteRowRequest {
    export const type = new RequestType<
        ed.EditDeleteRowParams,
        ed.EditDeleteRowResult,
        void,
        void
    >("edit/deleteRow");
}

// edit/dispose -------------------------------------------------------------------------------
export namespace EditDisposeRequest {
    export const type = new RequestType<
        ed.EditDisposeParams,
        ed.EditDisposeResult,
        void,
        void
    >("edit/dispose");
}

// edit/initialize ----------------------------------------------------------------------------
export namespace EditInitializeRequest {
    export const type = new RequestType<
        ed.EditInitializeParams,
        ed.EditInitializeResult,
        void,
        void
    >("edit/initialize");
}

// edit/revertCell --------------------------------------------------------------------------------
export namespace EditRevertCellRequest {
    export const type = new RequestType<
        ed.EditRevertCellParams,
        ed.EditRevertCellResult,
        void,
        void
    >("edit/revertCell");
}

// edit/revertRow -----------------------------------------------------------------------------
export namespace EditRevertRowRequest {
    export const type = new RequestType<
        ed.EditRevertRowParams,
        ed.EditRevertRowResult,
        void,
        void
    >("edit/revertRow");
}

// edit/subset ------------------------------------------------------------------------------------
export namespace EditSubsetRequest {
    export const type = new RequestType<
        ed.EditSubsetParams,
        ed.EditSubsetResult,
        void,
        void
    >("edit/subset");
}

// edit/updateCell ----------------------------------------------------------------------------
export namespace EditUpdateCellRequest {
    export const type = new RequestType<
        ed.EditUpdateCellParams,
        ed.EditUpdateCellResult,
        void,
        void
    >("edit/updateCell");
}

// edit/commit --------------------------------------------------------------------------------
export namespace EditCommitRequest {
    export const type = new RequestType<
        ed.EditCommitParams,
        ed.EditCommitResult,
        void,
        void
    >("edit/commit");
}

// edit/sessionReady Event --------------------------------------------------------------------
export namespace EditSessionReadyNotification {
    export const type = new NotificationType<ed.EditSessionReadyParams, void>(
        "edit/sessionReady",
    );
}
