/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for the Cloud Deploy connection-handle surface:
 *   * `FakeConnectionHandle` records executions, returns canned rows by exact
 *     SQL match (or `[[]]` for unknown SQL), throws a configured
 *     `ConnectionError`, and remembers disposal (idempotently).
 *
 * Scope 2 removed the old `ConnectionProvider` / `LiveConnectionProvider`
 * abstraction (which only served the now-dropped `Container` source-of-truth):
 * validators receive a `ConnectionHandle` to the per-run ephemeral database via
 * `ValidatorRunOptions.ephemeralConnection`, so only the handle is tested here.
 */

import { expect } from "chai";

import {
    ConnectionError,
    FakeConnectionHandle,
} from "../../src/cloudDeploy/validation/providers/connectionProvider";

suite("CloudDeploy ConnectionProvider", () => {
    suite("FakeConnectionHandle", () => {
        test("execute records calls and returns [[]] for unknown SQL", async () => {
            const handle = new FakeConnectionHandle();

            const rows = await handle.execute("SELECT 1", new AbortController().signal);

            expect(rows).to.deep.equal([[]]);
            expect(handle.executions).to.deep.equal([{ sql: "SELECT 1", signalAborted: false }]);
        });

        test("execute returns canned rows by exact SQL match", async () => {
            const handle = new FakeConnectionHandle({
                executeResponses: { "SELECT @@VERSION": [["SQL Server 2022"]] },
            });

            const rows = await handle.execute("SELECT @@VERSION", new AbortController().signal);

            expect(rows).to.deep.equal([["SQL Server 2022"]]);
        });

        test("execute records the aborted state of the signal", async () => {
            const handle = new FakeConnectionHandle();
            const ctrl = new AbortController();
            ctrl.abort();

            await handle.execute("SELECT 1", ctrl.signal);

            expect(handle.executions[0].signalAborted).to.equal(true);
        });

        test("execute throws when configured with executeError", async () => {
            const handle = new FakeConnectionHandle({
                executeError: new ConnectionError("connection-refused", "rst"),
            });

            try {
                await handle.execute("SELECT 1", new AbortController().signal);
                expect.fail("expected ConnectionError");
            } catch (err) {
                expect(err).to.be.instanceOf(ConnectionError);
                expect((err as ConnectionError).kind).to.equal("connection-refused");
            }
        });

        test("dispose is idempotent and sets the disposed flag", async () => {
            const handle = new FakeConnectionHandle();

            expect(handle.disposed).to.equal(false);
            await handle.dispose();
            expect(handle.disposed).to.equal(true);
            await handle.dispose();
            expect(handle.disposed).to.equal(true);
        });
    });
});
