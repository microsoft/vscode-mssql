/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * mssql-perf-driver — the test driver's hand inside VS Code (design §16).
 *
 * Guardrail: with PERF_MODE unset this extension does nothing at all — no
 * sockets, no timers, no state. The activation gate below is the entire
 * non-perf-mode code path.
 */

import * as vscode from "vscode";
import { ControlClient } from "./controlClient";

export function activate(context: vscode.ExtensionContext): void {
    if (process.env["PERF_MODE"] !== "1") {
        return;
    }
    const controlUrl = process.env["PERF_CONTROL_URL"];
    const token = process.env["PERF_CONTROL_TOKEN"];
    if (!controlUrl || !token) {
        console.warn(
            "[mssql-perf-driver] PERF_MODE=1 but control URL/token missing; staying inert",
        );
        return;
    }
    const client = new ControlClient({
        controlUrl,
        token,
        runId: process.env["PERF_RUN_ID"] ?? "unknown-run",
        repId: Number(process.env["PERF_REP_ID"] ?? "0"),
        scenarioId: process.env["PERF_SCENARIO_ID"] ?? "unknown-scenario",
    });
    context.subscriptions.push(client);
    client.connect();
}

export function deactivate(): void {
    // ControlClient disposal happens through context.subscriptions.
}
