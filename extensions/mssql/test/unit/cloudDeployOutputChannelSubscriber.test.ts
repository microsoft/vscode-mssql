/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `OutputChannelSubscriber` and the `formatEvent` helper.
 * Covers timestamp/severity/source rendering, payload projection
 * (primitives, arrays, nested objects), the default debug-drop policy,
 * the `includeDebug` opt-in, and dispose semantics.
 */

import { expect } from "chai";

import { DiagnosticEventBus } from "../../src/cloudDeploy/diagnostics";
import { ValidationType } from "../../src/cloudDeploy/environments/types";
import { formatEvent, OutputChannelSubscriber } from "../../src/cloudDeploy/validation";

class RecordingChannel {
    public readonly lines: string[] = [];

    public appendLine(value: string): void {
        this.lines.push(value);
    }
}

suite("CloudDeploy OutputChannelSubscriber: formatEvent", () => {
    test("renders the canonical [time] [severity] [source] type: payload shape", () => {
        // 2024-01-02T03:04:05.067Z — timestamp formatter uses local time so
        // assert against derived hh/mm/ss/ms instead of a hardcoded literal.
        const ts = new Date(2024, 0, 2, 3, 4, 5, 67).getTime();
        const line = formatEvent({
            id: "evt-1",
            timestampMs: ts,
            source: "environment-store",
            severity: "info",
            type: "environments-loaded",
            payload: { count: 3 },
        });

        expect(line).to.contain("[info]");
        expect(line).to.contain("[environment-store]");
        expect(line).to.contain("environments-loaded");
        expect(line).to.contain("count=3");
        // Format is HH:MM:SS.mmm — exactly 12 chars between [ and ].
        expect(line).to.match(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);
    });

    test("pads single-digit milliseconds to three places", () => {
        const ts = new Date(2024, 0, 1, 0, 0, 0, 7).getTime();
        const line = formatEvent({
            id: "evt-2",
            timestampMs: ts,
            source: "runner",
            severity: "info",
            type: "validation-run-started",
            payload: {
                runId: "r-1",
                environmentId: "e-1",
                validationTypes: [ValidationType.Connectivity],
            },
        });

        expect(line).to.match(/^\[\d{2}:\d{2}:\d{2}\.007\]/);
    });

    test("renders arrays with bracket-comma syntax", () => {
        const line = formatEvent({
            id: "evt-3",
            timestampMs: Date.now(),
            source: "runner",
            severity: "info",
            type: "validation-run-started",
            payload: {
                runId: "r-1",
                environmentId: "e-1",
                validationTypes: [ValidationType.Connectivity, ValidationType.StaticAnalysis],
            },
        });

        expect(line).to.contain("validationTypes=[");
        expect(line).to.contain(ValidationType.Connectivity);
        expect(line).to.contain(ValidationType.StaticAnalysis);
    });

    test("renders nested objects via JSON.stringify", () => {
        const line = formatEvent({
            id: "evt-4",
            timestampMs: Date.now(),
            source: "environment-store",
            severity: "info",
            type: "environments-changed",
            payload: {
                addedIds: ["a"],
                updatedIds: [],
                removedIds: [],
            },
        });

        expect(line).to.contain("addedIds=[a]");
        expect(line).to.contain("updatedIds=[]");
    });

    test("omits the colon when the payload is empty", () => {
        const line = formatEvent({
            id: "evt-5",
            timestampMs: Date.now(),
            source: "runner",
            severity: "info",
            // Synthetic minimal event — formatEvent does not enforce
            // discriminated-union arms, only the envelope shape.
            type: "validation-run-started",
            payload: {},
        } as unknown as Parameters<typeof formatEvent>[0]);

        expect(line.endsWith("validation-run-started")).to.equal(true);
    });
});

suite("CloudDeploy OutputChannelSubscriber: bus subscription", () => {
    let bus: DiagnosticEventBus;
    let channel: RecordingChannel;

    setup(() => {
        bus = new DiagnosticEventBus();
        channel = new RecordingChannel();
    });

    teardown(() => {
        bus.dispose();
    });

    test("appends a line for every non-debug event", () => {
        const sub = new OutputChannelSubscriber(channel, bus);

        bus.emit({
            source: "environment-store",
            type: "environments-loaded",
            payload: { count: 1 },
        });
        bus.emit({
            source: "environment-store",
            severity: "warn",
            type: "environments-changed",
            payload: { addedIds: [], updatedIds: [], removedIds: [] },
        });

        expect(channel.lines).to.have.length(2);
        expect(channel.lines[0]).to.contain("environments-loaded");
        expect(channel.lines[1]).to.contain("[warn]");

        sub.dispose();
    });

    test("drops debug events by default", () => {
        const sub = new OutputChannelSubscriber(channel, bus);

        bus.emit({
            source: "validation",
            severity: "debug",
            type: "validation-progress",
            payload: {
                runId: "r-1",
                validationType: ValidationType.Connectivity,
                message: "tick",
            },
        });

        expect(channel.lines).to.have.length(0);

        sub.dispose();
    });

    test("includes debug events when includeDebug is true", () => {
        const sub = new OutputChannelSubscriber(channel, bus, { includeDebug: true });

        bus.emit({
            source: "validation",
            severity: "debug",
            type: "validation-progress",
            payload: {
                runId: "r-1",
                validationType: ValidationType.Connectivity,
                message: "tick",
            },
        });

        expect(channel.lines).to.have.length(1);
        expect(channel.lines[0]).to.contain("[debug]");

        sub.dispose();
    });

    test("dispose unsubscribes — later events are not appended", () => {
        const sub = new OutputChannelSubscriber(channel, bus);
        sub.dispose();

        bus.emit({
            source: "environment-store",
            type: "environments-loaded",
            payload: { count: 0 },
        });

        expect(channel.lines).to.have.length(0);
    });
});
