/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from "vitest";
import { isControlMessageShape } from "../src/control/controlServer";

const envelope = {
    schemaVersion: 1,
    runId: "run-1",
    repId: 0,
    scenarioId: "noop",
    timestampUnixNs: "1",
    sender: { role: "automationExtension", pid: 1, name: "driver" },
};

describe("control message validation", () => {
    it("requires complete hello fields", () => {
        expect(
            isControlMessageShape({
                ...envelope,
                kind: "hello",
                payload: { token: "secret", extensionHostPid: 42, vscodeVersion: "1.105.0" },
            }),
        ).toBe(true);
        expect(
            isControlMessageShape({ ...envelope, kind: "hello", payload: { token: "secret" } }),
        ).toBe(false);
    });

    it("rejects unknown kinds and malformed terminal payloads", () => {
        expect(isControlMessageShape(null)).toBe(false);
        expect(isControlMessageShape({ ...envelope, kind: "invented", payload: {} })).toBe(false);
        expect(
            isControlMessageShape({
                ...envelope,
                kind: "scenarioCompleted",
                payload: { successChecks: [], steps: [] },
            }),
        ).toBe(true);
        expect(
            isControlMessageShape({
                ...envelope,
                kind: "scenarioCompleted",
                payload: { successChecks: "not-an-array", steps: [] },
            }),
        ).toBe(false);
    });

    it("requires the shared error-frame payload shape", () => {
        expect(
            isControlMessageShape({
                ...envelope,
                kind: "error",
                payload: { message: "rejected", details: { sourceKind: "calibrationPing" } },
            }),
        ).toBe(true);
        expect(
            isControlMessageShape({
                ...envelope,
                kind: "error",
                payload: { reason: "legacy shape", sourceKind: "calibrationPing" },
            }),
        ).toBe(false);
    });
});
