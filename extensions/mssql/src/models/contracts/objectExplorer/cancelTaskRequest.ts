/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";

export class CancelObjectExplorerTaskParams {
    public taskId?: string;
    public sessionId?: string;
    public nodePath?: string;
}

export namespace CancelObjectExplorerTaskRequest {
    export const type = new RequestType<CancelObjectExplorerTaskParams, boolean, void, void>(
        "objectexplorer/cancel",
    );
}
