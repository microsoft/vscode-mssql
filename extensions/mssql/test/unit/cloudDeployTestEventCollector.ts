/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — diagnostic bus test helper.
 *
 * Reusable passive observer for tests that need to assert "which events did
 * the subject emit?". Subscribes to the firehose (`onDidEmit`) and records
 * every event in order.
 *
 * Lives under `test/` because it has no production purpose. Shared across
 * the diagnostic bus tests, the env-store emission tests, and (eventually)
 * D2 / D3 emission tests.
 */

import * as vscode from "vscode";

import { DiagnosticEvent, DiagnosticEventBus } from "../../src/cloudDeploy/diagnostics";

export class TestEventCollector implements vscode.Disposable {
    public readonly events: DiagnosticEvent[] = [];
    private readonly _subscription: vscode.Disposable;

    public constructor(bus: DiagnosticEventBus) {
        this._subscription = bus.onDidEmit((event) => {
            this.events.push(event);
        });
    }

    /** Subset filtered (and type-narrowed) by the `type` discriminator. */
    public eventsOfType<T extends DiagnosticEvent["type"]>(
        type: T,
    ): Array<Extract<DiagnosticEvent, { type: T }>> {
        return this.events.filter(
            (e): e is Extract<DiagnosticEvent, { type: T }> => e.type === type,
        );
    }

    public clear(): void {
        this.events.length = 0;
    }

    public dispose(): void {
        this._subscription.dispose();
    }
}
