/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, NotificationType, RequestType } from "vscode-jsonrpc/node";
import {
    GetLocationRequest,
    LocationChangedNotification,
    NavigateNotification,
} from "../sharedInterfaces/webviewNavigation";

/** The messaging part of a webview controller that navigation uses. */
export interface WebviewNavigationHost {
    onRequest<TParam, TResult, TError>(
        type: RequestType<TParam, TResult, TError>,
        handler: (params: TParam, token: CancellationToken) => TResult | Promise<TResult>,
    ): void;
    onNotification<TParam>(type: NotificationType<TParam>, handler: (params: TParam) => void): void;
    sendNotification<TParam>(type: NotificationType<TParam>, params: TParam): Promise<void>;
}

/**
 * The extension side of webview navigation. The webview owns the location; this
 * class remembers the last location, gives it to the webview when the page starts or reloads,
 * and sends locations to the webview.
 */
export class WebviewNavigation {
    private _location: string;
    /** True after the page asked for its location, so it receives navigate notifications. */
    private _pageStarted = false;

    /**
     * @param initialLocation The location to show when the page starts. An empty string is the
     * page's default location.
     */
    constructor(
        private readonly _host: WebviewNavigationHost,
        initialLocation: string = "",
    ) {
        this._location = initialLocation;
        _host.onRequest(GetLocationRequest.type, () => {
            this._pageStarted = true;
            return { location: this._location };
        });
        _host.onNotification(LocationChangedNotification.type, ({ location }) => {
            this._location = location;
        });
    }

    /** The last location of the page, or the location that the page will start at. */
    public get location(): string {
        return this._location;
    }

    /** Shows a location in the page. */
    public navigate(location: string): void {
        this._location = location;
        if (this._pageStarted) {
            void this._host.sendNotification(NavigateNotification.type, { location });
        }
    }
}
