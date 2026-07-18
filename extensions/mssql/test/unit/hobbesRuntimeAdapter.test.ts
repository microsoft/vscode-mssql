/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hobbes adapter mapping + supervisor plumbing (RBS2-4b): status projections
 * verified against the runtime's InvestigationRunStatuses contract, and the
 * loopback port allocator. Full process supervision is exercised against the
 * real runtime package in the perftest live lane, not unit CI.
 */

import { expect } from "chai";
import {
    launchRefusalError,
    mapRegionStatus,
    mapTerminalStatus,
    ReasoningCoalescer,
} from "../../src/runbookStudio/runtime/hobbesRuntimeAdapter";
import { findFreePort } from "../../src/runbookStudio/runtime/runtimeSupervisor";

suite("hobbesRuntimeAdapter", () => {
    test("terminal statuses map to host terminal states", () => {
        expect(mapTerminalStatus("completed")).to.equal("succeeded");
        expect(mapTerminalStatus("failed")).to.equal("failed");
        expect(mapTerminalStatus("canceled")).to.equal("cancelled");
        // Non-terminal runtime states never produce a host terminal.
        expect(mapTerminalStatus("running")).to.equal(undefined);
        expect(mapTerminalStatus("pending-confirmation")).to.equal(undefined);
        expect(mapTerminalStatus(undefined)).to.equal(undefined);
        expect(mapTerminalStatus("some-future-status")).to.equal(undefined);
    });

    test("region statuses map conservatively (unknown = no report)", () => {
        expect(mapRegionStatus("running")).to.equal("running");
        expect(mapRegionStatus("completed")).to.equal("succeeded");
        expect(mapRegionStatus("succeeded")).to.equal("succeeded");
        expect(mapRegionStatus("failed")).to.equal("failed");
        expect(mapRegionStatus("queued")).to.equal(undefined);
        expect(mapRegionStatus(undefined)).to.equal(undefined);
    });

    test("launch refusals map to user-actionable errors with the refusal code retained", () => {
        const notFound = launchRefusalError("runbook-not-found");
        expect(notFound.rbsError.code).to.equal("RunbookStudio.RuntimeCapabilityUnsupported");
        expect(notFound.rbsError.message).to.contain("local");
        expect(notFound.refusalCode).to.equal("runbook-not-found");

        const versionMismatch = launchRefusalError("runbook-version-mismatch");
        expect(versionMismatch.rbsError.code).to.equal(
            "RunbookStudio.RuntimeCapabilityUnsupported",
        );

        const connection = launchRefusalError("connection-not-found");
        expect(connection.rbsError.code).to.equal("RunbookStudio.BindingInvalid");

        const unknown = launchRefusalError("some-future-code");
        expect(unknown.rbsError.code).to.equal("RunbookStudio.RuntimeProtocol");
        expect(unknown.rbsError.message).to.contain("some-future-code");
        expect(unknown.rbsError.retryable).to.equal(true);
    });

    test("findFreePort returns a bindable loopback port", async () => {
        const port = await findFreePort();
        expect(port).to.be.greaterThan(0);
        expect(port).to.be.lessThan(65536);
        const second = await findFreePort();
        expect(second).to.be.greaterThan(0);
    });

    suite("ReasoningCoalescer", () => {
        test("flushes one combined run when the size ceiling is reached", () => {
            const emitted: string[] = [];
            const coalescer = new ReasoningCoalescer((text) => emitted.push(text));
            const fragment = "x".repeat(60);
            coalescer.append(fragment, 0);
            coalescer.append(fragment, 1);
            coalescer.append(fragment, 2);
            expect(emitted).to.have.length(0);
            coalescer.append(fragment, 3); // 240 chars → size flush
            expect(emitted).to.deep.equal([fragment.repeat(4)]);
        });

        test("boundary flush emits the partial buffer and empty flush is a no-op", () => {
            const emitted: string[] = [];
            const coalescer = new ReasoningCoalescer((text) => emitted.push(text));
            coalescer.append("thinking ", 0);
            coalescer.append("aloud", 10);
            coalescer.flush(); // tool-call / status / turn boundary
            expect(emitted).to.deep.equal(["thinking aloud"]);
            coalescer.flush(); // nothing buffered → no emission
            expect(emitted).to.have.length(1);
        });

        test("deadline poke flushes only once the first buffered char is 500ms old", () => {
            const emitted: string[] = [];
            const coalescer = new ReasoningCoalescer((text) => emitted.push(text));
            coalescer.append("slow", 1000);
            coalescer.poke(1499); // under the deadline: still buffering
            expect(emitted).to.have.length(0);
            coalescer.poke(1500); // 500ms since FIRST char → flush
            expect(emitted).to.deep.equal(["slow"]);
            // The deadline re-arms from the next first buffered char.
            coalescer.append("next", 2000);
            coalescer.poke(2100);
            expect(emitted).to.have.length(1);
            coalescer.poke(2500);
            expect(emitted).to.deep.equal(["slow", "next"]);
        });

        test("empty deltas never arm the deadline", () => {
            const emitted: string[] = [];
            const coalescer = new ReasoningCoalescer((text) => emitted.push(text));
            coalescer.append("", 0);
            coalescer.poke(10_000);
            coalescer.flush();
            expect(emitted).to.have.length(0);
        });
    });
});
