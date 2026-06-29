/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import { NodeDiagnosticEventBus } from "../../src/cloudDeploy/diagnostics/nodeEventBus";
import { DiagnosticEvent, EnvironmentsLoadedEvent } from "../../src/cloudDeploy/diagnostics/types";

/** Reusable minimal `EnvironmentsLoadedEvent` input (severity omitted -> defaults to info). */
const sampleLoadedInput = {
    source: "environment-store",
    type: "environments-loaded",
    payload: { count: 0 },
} as const;

/** Reusable minimal `ErrorEvent` input (carries a literal `"error"` severity). */
const sampleErrorInput = {
    source: "service",
    type: "error",
    severity: "error",
    payload: { message: "boom" },
} as const;

suite("CloudDeploy NodeDiagnosticEventBus", () => {
    let bus: NodeDiagnosticEventBus;

    setup(() => {
        bus = new NodeDiagnosticEventBus();
    });

    suite("envelope stamping", () => {
        test("emit stamps a non-empty string id on the buffered event", () => {
            bus.emit(sampleLoadedInput);
            const [event] = bus.drain();
            expect(event.id).to.be.a("string");
            expect(event.id.length).to.be.greaterThan(0);
        });

        test("emit stamps a unique id per emission", () => {
            bus.emit(sampleLoadedInput);
            bus.emit(sampleLoadedInput);
            const events = bus.drain();
            expect(events[0].id).to.not.equal(events[1].id);
        });

        test("emit stamps timestampMs within the call window", () => {
            const before = Date.now();
            bus.emit(sampleLoadedInput);
            const after = Date.now();
            const [event] = bus.drain();
            expect(event.timestampMs).to.be.at.least(before);
            expect(event.timestampMs).to.be.at.most(after);
        });

        test("defaults severity to info when the caller omits it", () => {
            bus.emit(sampleLoadedInput);
            const [event] = bus.drain();
            expect(event.severity).to.equal("info");
        });

        test("preserves a caller-supplied literal severity", () => {
            bus.emit(sampleErrorInput);
            const [event] = bus.drain();
            expect(event.severity).to.equal("error");
        });
    });

    suite("drain", () => {
        test("returns events in emission order", () => {
            bus.emit({ ...sampleLoadedInput, payload: { count: 1 } });
            bus.emit({ ...sampleLoadedInput, payload: { count: 2 } });
            const counts = bus
                .drain()
                .map((event) => (event as EnvironmentsLoadedEvent).payload.count);
            expect(counts).to.deep.equal([1, 2]);
        });
    });

    suite("on", () => {
        test("notifies a subscriber for each subsequently emitted event", () => {
            const seen: DiagnosticEvent[] = [];
            bus.on((event) => seen.push(event));
            bus.emit(sampleLoadedInput);
            bus.emit(sampleLoadedInput);
            expect(seen).to.have.length(2);
        });

        test("isolates a throwing subscriber so delivery to others continues", () => {
            const seen: DiagnosticEvent[] = [];
            bus.on(() => {
                throw new Error("bad subscriber");
            });
            bus.on((event) => seen.push(event));
            expect(() => bus.emit(sampleLoadedInput)).to.not.throw();
            expect(seen).to.have.length(1);
        });

        test("unsubscribe stops further delivery", () => {
            const seen: DiagnosticEvent[] = [];
            const unsubscribe = bus.on((event) => seen.push(event));
            bus.emit(sampleLoadedInput);
            unsubscribe();
            bus.emit(sampleLoadedInput);
            expect(seen).to.have.length(1);
        });
    });
});
