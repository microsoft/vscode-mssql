/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { createHttpHeaders } from "../../../src/base/http/httpHeaders";

describe("HttpHeaders", () => {
    describe("lookup", () => {
        it("resolves names case-insensitively", () => {
            const headers = createHttpHeaders({ "Content-Type": "application/json" });

            expect(headers.get("content-type")).to.equal("application/json");
            expect(headers.get("CONTENT-TYPE")).to.equal("application/json");
            expect(headers.has("Content-Type")).to.be.true;
        });

        it("returns undefined for absent headers", () => {
            const headers = createHttpHeaders({ Accept: "application/json" });

            expect(headers.get("location")).to.be.undefined;
            expect(headers.getAll("location")).to.deep.equal([]);
            expect(headers.has("location")).to.be.false;
        });
    });

    describe("multi-value headers", () => {
        it("keeps every value from an array initializer", () => {
            const headers = createHttpHeaders({ "set-cookie": ["a=1", "b=2"] });

            expect(headers.getAll("set-cookie")).to.deep.equal(["a=1", "b=2"]);
        });

        it("returns the first value from get", () => {
            const headers = createHttpHeaders({ "set-cookie": ["a=1", "b=2"] });

            expect(headers.get("set-cookie")).to.equal("a=1");
        });

        it("accumulates repeated names from an entry-pair initializer", () => {
            const headers = createHttpHeaders([
                ["Set-Cookie", "a=1"],
                ["set-cookie", "b=2"],
            ]);

            expect(headers.getAll("Set-Cookie")).to.deep.equal(["a=1", "b=2"]);
        });

        it("does not expose its mutable internal value arrays", () => {
            const headers = createHttpHeaders({ "set-cookie": ["a=1", "b=2"] });
            const values = headers.getAll("set-cookie") as string[];

            values.push("c=3");

            expect(headers.getAll("set-cookie")).to.deep.equal(["a=1", "b=2"]);
        });
    });

    describe("normalization", () => {
        it("omits headers without a usable value", () => {
            const headers = createHttpHeaders({
                present: "yes",
                missing: undefined,
                empty: null,
                structured: { nested: true },
            });

            expect(headers.has("present")).to.be.true;
            expect(headers.has("missing")).to.be.false;
            expect(headers.has("empty")).to.be.false;
            expect(headers.has("structured")).to.be.false;
        });

        it("stringifies primitive values", () => {
            const headers = createHttpHeaders({ "content-length": 42, secure: true });

            expect(headers.get("content-length")).to.equal("42");
            expect(headers.get("secure")).to.equal("true");
        });
    });

    describe("entries", () => {
        it("preserves the originally supplied casing", () => {
            const headers = createHttpHeaders({ "Content-Type": "text/plain" });

            expect([...headers.entries()]).to.deep.equal([["Content-Type", ["text/plain"]]]);
        });

        it("groups every value under a single entry", () => {
            const headers = createHttpHeaders({ "set-cookie": ["a=1", "b=2"] });

            expect([...headers.entries()]).to.deep.equal([["set-cookie", ["a=1", "b=2"]]]);
        });
    });
});
