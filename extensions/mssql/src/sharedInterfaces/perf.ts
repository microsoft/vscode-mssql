/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Perf-harness webview mark bridge contracts. Only used when the extension
 * runs under PERF_MODE=1: the controller sends PerfEnableNotification once
 * the webview is ready, and only then does the webview emit marks.
 */

import { NotificationType } from "vscode-jsonrpc";

export interface WebviewPerfMark {
    /** Semantic mark name, e.g. mssql.resultsGrid.renderComplete */
    name: string;
    /** Epoch ns as decimal string: round(performance.timeOrigin + now) ms → ns */
    timestampUnixNs: string;
    /** Webview-local monotonic ns as decimal string: performance.now() µs → ns */
    monotonicNs: string;
    attrs?: { [key: string]: string | number | boolean | null };
}

export namespace PerfEnableNotification {
    export const type = new NotificationType<undefined>("perf/enable");
}

export namespace PerfWebviewMarkNotification {
    export const type = new NotificationType<WebviewPerfMark>("perf/webviewMark");
}
