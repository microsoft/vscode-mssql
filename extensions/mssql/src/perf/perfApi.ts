/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Perf-only API surface (harness design §16.3). Registered ONLY when
 * PERF_MODE=1; outside perf mode this function is a no-op and the command
 * does not exist. Not a public extension API — the perf driver extension is
 * the only intended caller (via vscode.commands.executeCommand).
 */

import * as vscode from "vscode";
import { Perf } from "./perfTelemetry";

export const perfGetStateCommand = "mssql.perf.getState";

export function registerPerfApi(context: vscode.ExtensionContext): void {
    if (!Perf.enabled) {
        return;
    }
    context.subscriptions.push(
        vscode.commands.registerCommand(perfGetStateCommand, () => Perf.getState()),
    );
}
