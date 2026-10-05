/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Reserved perf-driver health API. Registered ONLY when
 * PERF_MODE=1; outside perf mode this function is a no-op and the command
 * does not exist. Not a public extension API; the perf driver may query it in
 * later delivery-health scenarios via vscode.commands.executeCommand.
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
