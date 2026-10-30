/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { VectorModelStatementCounter } from "../../src/queryResults/vector/vectorModelStatementCounter";

suite("VectorModelStatementCounter", () => {
    test("records host-issued statements by egress class and returns detached snapshots", () => {
        const counter = new VectorModelStatementCounter();

        counter.record("externalEgress");
        counter.record("externalEgress");
        counter.record("hostLocal");
        const snapshot = counter.snapshot();

        expect(snapshot).to.deep.equal({
            externalEgress: 2,
            hostLocal: 1,
            inProcess: 0,
            unknown: 0,
        });

        counter.record("unknown");
        expect(snapshot.unknown).to.equal(0);
        expect(counter.snapshot().unknown).to.equal(1);
    });

    test("a new query generation uses a distinct counter", () => {
        const previousGeneration = new VectorModelStatementCounter();
        previousGeneration.record("inProcess");
        const nextGeneration = new VectorModelStatementCounter();

        expect(nextGeneration.snapshot()).to.deep.equal({
            externalEgress: 0,
            hostLocal: 0,
            inProcess: 0,
            unknown: 0,
        });
        expect(previousGeneration.snapshot().inProcess).to.equal(1);
    });
});
