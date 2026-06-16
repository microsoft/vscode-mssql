/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType, NotificationType } from "vscode-languageclient";
import {
    FileBrowserOpenParams,
    FileBrowserOpenResponse,
    FileBrowserExpandParams,
    FileBrowserExpandResponse,
    FileBrowserCloseResponse,
    FileBrowserCloseParams,
} from "../../sharedInterfaces/fileBrowser";

export namespace FileBrowserOpenRequest {
    export const type = new RequestType<FileBrowserOpenParams, boolean, void>("filebrowser/open");
}

export namespace FileBrowserOpenNotification {
    export const type = new NotificationType<FileBrowserOpenResponse>("filebrowser/opencomplete");
}

export namespace FileBrowserExpandRequest {
    export const type = new RequestType<FileBrowserExpandParams, boolean, void>(
        "filebrowser/expand",
    );
}

export namespace FileBrowserExpandNotification {
    export const type = new NotificationType<FileBrowserExpandResponse>(
        "filebrowser/expandcomplete",
    );
}

export namespace FileBrowserCloseRequest {
    export const type = new RequestType<FileBrowserCloseParams, FileBrowserCloseResponse, void>(
        "filebrowser/close",
    );
}
