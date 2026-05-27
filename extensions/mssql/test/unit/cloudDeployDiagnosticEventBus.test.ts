/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import {
    DiagnosticEvent,
    DiagnosticEventBus,
    EnvironmentsChangedEvent,
    EnvironmentsLoadedEvent,
    ErrorEvent,
} from "../../src/cloudDeploy/diagnostics";
import { TestEventCollector } from "./cloudDeployTestEventCollector";

function makeBus(): DiagnosticEventBus {
    return new DiagnosticEventBus();
}

/** Reusable minimal `EnvironmentsLoadedEvent` input for tests that don't care about payload specifics. */
const sampleLoadedInput = {
    source: "environment-store",
    type: "environments-loaded",
    payload: { count: 0 },
} as const;

/** Reusable minimal `ErrorEvent` input. */
const sampleErrorInput = {
    source: "service",
    type: "error",
    severity: "error",
    payload: { message: "boom" },
} as const;

suite("CloudDeploy DiagnosticEventBus", () => {
    let bus: DiagnosticEventBus;

    setup(() => {
        bus = makeBus();
    });

    teardown(() => {
        bus.dispose();
    });

    suite("envelope stamping", () => {
        test("emit stamps a non-empty string id on the delivered event", () => {
            const collector = new TestEventCollector(bus);
            bus.emit(sampleLoadedInput);
            expect(collector.events).to.have.length(1);
            expect(collector.events[0].id).to.be.a("string");
            expect(collector.events[0].id.length).to.be.greaterThan(0);
            collector.dispose();
        });

        test("emit stamps a unique id per emission", () => {
            const collector = new TestEventCollector(bus);
            bus.emit(sampleLoadedInput);
            bus.emit(sampleLoadedInput);
            expect(collector.events).to.have.length(2);
            expect(collector.events[0].id).to.not.equal(collector.events[1].id);
            collector.dispose();
        });

        test("emit stamps timestampMs within a few ms of Date.now()", () => {
            const collector = new TestEventCollector(bus);
            const before = Date.now();
            bus.emit(sampleLoadedInput);
            const after = Date.now();
            expect(collector.events[0].timestampMs).to.be.at.least(before);
            expect(collector.events[0].timestampMs).to.be.at.most(after);
            collector.dispose();
        });

        test("emit defaults severity to info when omitted", () => {
            const collector = new TestEventCollector(bus);
            bus.emit(sampleLoadedInput);
            expect(collector.events[0].severity).to.equal("info");
            collector.dispose();
        });

        test("emit preserves explicit severity when caller provides it", () => {
            const collector = new TestEventCollector(bus);
            bus.emit({ ...sampleLoadedInput, severity: "warn" });
            expect(collector.events[0].severity).to.equal("warn");
            collector.dispose();
        });
    });

    suite("onDidEmit firehose", () => {
        test("every emitted event reaches a firehose subscriber", () => {
            const collector = new TestEventCollector(bus);
            bus.emit(sampleLoadedInput);
            bus.emit(sampleErrorInput);
            expect(collector.events).to.have.length(2);
            expect(collector.events.map((e) => e.type)).to.deep.equal([
                "environments-loaded",
                "error",
            ]);
            collector.dispose();
        });

        test("multiple firehose subscribers all receive the same event", () => {
            const a = new TestEventCollector(bus);
            const b = new TestEventCollector(bus);
            bus.emit(sampleLoadedInput);
            expect(a.events).to.have.length(1);
            expect(b.events).to.have.length(1);
            expect(a.events[0].id).to.equal(b.events[0].id);
            a.dispose();
            b.dispose();
        });

        test("emission order is preserved across multiple emissions", () => {
            const collector = new TestEventCollector(bus);
            bus.emit({ ...sampleLoadedInput, payload: { count: 1 } });
            bus.emit({ ...sampleLoadedInput, payload: { count: 2 } });
            bus.emit({ ...sampleLoadedInput, payload: { count: 3 } });
            const counts = collector
                .eventsOfType("environments-loaded")
                .map((e) => e.payload.count);
            expect(counts).to.deep.equal([1, 2, 3]);
            collector.dispose();
        });
    });

    suite("on(type, handler) selective subscription", () => {
        test("handler only fires for matching type", () => {
            const received: EnvironmentsLoadedEvent[] = [];
            const sub = bus.on("environments-loaded", (e) => received.push(e));
            bus.emit(sampleLoadedInput);
            expect(received).to.have.length(1);
            expect(received[0].type).to.equal("environments-loaded");
            sub.dispose();
        });

        test("handler does NOT fire for non-matching type", () => {
            const received: EnvironmentsLoadedEvent[] = [];
            const sub = bus.on("environments-loaded", (e) => received.push(e));
            bus.emit(sampleErrorInput);
            expect(received).to.deep.equal([]);
            sub.dispose();
        });

        test("multiple handlers on the same type all fire", () => {
            const a: EnvironmentsLoadedEvent[] = [];
            const b: EnvironmentsLoadedEvent[] = [];
            const subA = bus.on("environments-loaded", (e) => a.push(e));
            const subB = bus.on("environments-loaded", (e) => b.push(e));
            bus.emit(sampleLoadedInput);
            expect(a).to.have.length(1);
            expect(b).to.have.length(1);
            subA.dispose();
            subB.dispose();
        });

        test("handler payload is narrowed to the matching arm", () => {
            // Compile-time check: inside the handler `e.payload.count` must
            // be a `number`, not `unknown`. If narrowing broke, this test
            // file wouldn't compile.
            const received: number[] = [];
            const sub = bus.on("environments-loaded", (e) => {
                received.push(e.payload.count);
            });
            bus.emit({ ...sampleLoadedInput, payload: { count: 7 } });
            expect(received).to.deep.equal([7]);
            sub.dispose();
        });
    });

    suite("disposal", () => {
        test("disposing a single subscription stops it from firing", () => {
            const received: DiagnosticEvent[] = [];
            const sub = bus.onDidEmit((e) => received.push(e));
            bus.emit(sampleLoadedInput);
            sub.dispose();
            bus.emit(sampleLoadedInput);
            expect(received).to.have.length(1);
        });

        test("disposing the bus stops all subscriptions", () => {
            const collector = new TestEventCollector(bus);
            bus.emit(sampleLoadedInput);
            bus.dispose();
            // Subsequent emits are no-ops.
            bus.emit(sampleLoadedInput);
            expect(collector.events).to.have.length(1);
            collector.dispose();
        });

        test("emit after dispose is a no-op (does not throw)", () => {
            bus.dispose();
            expect(() => bus.emit(sampleLoadedInput)).to.not.throw();
        });

        test("dispose is idempotent", () => {
            bus.dispose();
            expect(() => bus.dispose()).to.not.throw();
        });
    });

    suite("subscriber error isolation", () => {
        test("a thrown subscriber does not prevent other subscribers from receiving the event", () => {
            const received: DiagnosticEvent[] = [];
            const subA = bus.onDidEmit(() => {
                throw new Error("subscriber A blew up");
            });
            const subB = bus.onDidEmit((e) => received.push(e));
            bus.emit(sampleLoadedInput);
            expect(received).to.have.length(1);
            subA.dispose();
            subB.dispose();
        });

        test("subsequent emissions continue to work after a thrown subscriber", () => {
            const received: DiagnosticEvent[] = [];
            const subA = bus.onDidEmit(() => {
                throw new Error("noisy subscriber");
            });
            const subB = bus.onDidEmit((e) => received.push(e));
            bus.emit(sampleLoadedInput);
            bus.emit(sampleLoadedInput);
            expect(received).to.have.length(2);
            subA.dispose();
            subB.dispose();
        });
    });

    suite("correlationId passthrough", () => {
        test("correlationId is preserved when caller provides it", () => {
            const collector = new TestEventCollector(bus);
            bus.emit({ ...sampleLoadedInput, correlationId: "flow-123" });
            expect(collector.events[0].correlationId).to.equal("flow-123");
            collector.dispose();
        });

        test("correlationId is undefined on the delivered event when omitted", () => {
            const collector = new TestEventCollector(bus);
            bus.emit(sampleLoadedInput);
            expect(collector.events[0].correlationId).to.be.undefined;
            collector.dispose();
        });
    });

    suite("catalog-level constraints", () => {
        test("error-arm events carry severity 'error' (literal in the union)", () => {
            const collector = new TestEventCollector(bus);
            bus.emit(sampleErrorInput);
            const errors = collector.eventsOfType("error");
            expect(errors).to.have.length(1);
            const errorEvent: ErrorEvent = errors[0];
            expect(errorEvent.severity).to.equal("error");
            collector.dispose();
        });

        test("environments-changed payload carries the diff arrays", () => {
            const collector = new TestEventCollector(bus);
            bus.emit({
                source: "environment-store",
                type: "environments-changed",
                payload: {
                    addedIds: ["a"],
                    updatedIds: ["b"],
                    removedIds: ["c"],
                },
            });
            const changes = collector.eventsOfType("environments-changed");
            expect(changes).to.have.length(1);
            const ev: EnvironmentsChangedEvent = changes[0];
            expect(ev.payload.addedIds).to.deep.equal(["a"]);
            expect(ev.payload.updatedIds).to.deep.equal(["b"]);
            expect(ev.payload.removedIds).to.deep.equal(["c"]);
            collector.dispose();
        });
    });
});
