/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc";

/*
 * Messages of the webview navigation framework. A location is a path inside the page and an
 * optional query string, without a leading slash: for example `queries/913/compare?plans=4,9`.
 * The webview owns the current location; the extension only remembers the last one.
 */

export interface WebviewLocationParams {
    readonly location: string;
}

/** Extension to webview: go to a location. */
export namespace NavigateNotification {
    export const type = new NotificationType<WebviewLocationParams>("navigation/navigate");
}

/** Webview to extension: the location changed. */
export namespace LocationChangedNotification {
    export const type = new NotificationType<WebviewLocationParams>("navigation/locationChanged");
}

/**
 * Webview to extension, when the page starts: returns the location to show. That is the
 * location that the panel was opened at, or the last location when the webview reloads.
 */
export namespace GetLocationRequest {
    export const type = new RequestType<void, WebviewLocationParams, void>(
        "navigation/getLocation",
    );
}
