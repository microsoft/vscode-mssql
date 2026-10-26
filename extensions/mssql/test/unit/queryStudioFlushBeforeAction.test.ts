/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { flushBeforeQueryStudioAction } from "../../src/webviews/pages/QueryStudio/flushBeforeAction";

suite("Query Studio synchronization before Save and Execute", () => {
    const sandbox = sinon.createSandbox();
    teardown(() => sandbox.restore());

    test("waits for the outstanding edit group and then flushes the remaining keystrokes", async () => {
        let hostText = "SELECT";
        let acknowledgeFirst!: (applied: boolean) => void;
        const first = new Promise<boolean>((resolve) => {
            acknowledgeFirst = resolve;
        });
        const flush = sandbox.stub();
        flush.onFirstCall().returns(first);
        flush.onSecondCall().callsFake(async () => {
            hostText = "SELECT 123;";
            return true;
        });
        let completed = false;
        const pending = flushBeforeQueryStudioAction(flush, () => hostText === "SELECT 123;").then(
            (ready) => {
                completed = true;
                return ready;
            },
        );
        await Promise.resolve();
        expect(completed).to.equal(false);
        acknowledgeFirst(true);
        expect(await pending).to.equal(true);
        expect(hostText).to.equal("SELECT 123;");
    });

    test("refuses a stale save/run when edit synchronization fails", async () => {
        expect(
            await flushBeforeQueryStudioAction(sandbox.stub().resolves(false), () => false),
        ).to.equal(false);
    });

    test("does not wait forever for a document that keeps changing", async () => {
        expect(
            await flushBeforeQueryStudioAction(sandbox.stub().resolves(true), () => false),
        ).to.equal(false);
    });
});
