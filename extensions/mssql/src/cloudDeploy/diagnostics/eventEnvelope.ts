/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — diagnostic event envelope stamping.
 *
 * The single, host-agnostic place that turns a producer-supplied
 * `DiagnosticEventInput` into a fully-formed `DiagnosticEvent` by stamping the
 * bus-controlled envelope fields (`id`, `timestampMs`, default `severity`).
 * Extracted from `eventBus.ts` so BOTH the VS Code `DiagnosticEventBus` and the
 * headless `NodeDiagnosticEventBus` share one implementation — and so neither a
 * second copy nor the `vscode`-importing bus is pulled into a plain `node`
 * process. No `vscode` import here, by design.
 */

import { randomUUID } from "crypto";

import { DiagnosticEvent, DiagnosticEventInput } from "./types";

/**
 * Stamps the bus-controlled envelope fields (`id`, `timestampMs`, default
 * `severity`) onto a producer-provided input and returns a fully-formed
 * `DiagnosticEvent`. The cast widens because TS can't see that the union over
 * `DiagnosticEventInput` plus stamped fields reconstructs the original union
 * exactly — but the runtime shape is correct by construction.
 */
export function stampEnvelope(input: DiagnosticEventInput): DiagnosticEvent {
    return {
        ...input,
        id: randomUUID(),
        timestampMs: Date.now(),
        severity: input.severity ?? "info",
    } as DiagnosticEvent;
}
