/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B12 / LS-4 Query Studio language definition delivery: the `mssql-def:`
 * TextDocumentContentProvider serving generated scripts as read-only virtual
 * documents — cacheKey-addressed URIs, LRU bounding, expiry honesty, and
 * content refresh signalling (design 05 §13.5).
 */

import { expect } from "chai";
import * as vscode from "vscode";
import {
    DEFINITION_SCHEME,
    DefinitionContentProvider,
} from "../../src/queryStudio/definitionContentProvider";

suite("queryStudio language definition delivery (B12)", () => {
    test("stored scripts are served by their cacheKey-addressed URI", () => {
        const provider = new DefinitionContentProvider();
        const uri = provider.store({
            title: "Sales.Orders",
            text: "CREATE TABLE Sales.Orders (OrderID int);",
            cacheKey: "FixtureDb:1:create:1",
        });
        expect(uri.scheme).to.equal(DEFINITION_SCHEME);
        expect(uri.path).to.equal("/Sales.Orders.sql");
        expect(decodeURIComponent(uri.query)).to.equal("FixtureDb:1:create:1");
        expect(provider.provideTextDocumentContent(uri)).to.equal(
            "CREATE TABLE Sales.Orders (OrderID int);",
        );
    });

    test("same cacheKey → same URI; new generation → new URI", () => {
        const provider = new DefinitionContentProvider();
        const first = provider.store({ title: "T", text: "A", cacheKey: "db:1:create:1" });
        const again = provider.store({ title: "T", text: "A", cacheKey: "db:1:create:1" });
        expect(again.toString()).to.equal(first.toString());
        const nextGeneration = provider.store({ title: "T", text: "B", cacheKey: "db:1:create:2" });
        expect(nextGeneration.toString()).to.not.equal(first.toString());
        expect(provider.provideTextDocumentContent(first)).to.equal("A");
        expect(provider.provideTextDocumentContent(nextGeneration)).to.equal("B");
    });

    test("changed content under the SAME key fires onDidChange", () => {
        const provider = new DefinitionContentProvider();
        const changed: string[] = [];
        provider.onDidChange((uri) => changed.push(uri.toString()));
        const uri = provider.store({ title: "T", text: "A", cacheKey: "k" });
        provider.store({ title: "T", text: "A", cacheKey: "k" }); // identical → silent
        expect(changed.length).to.equal(0);
        provider.store({ title: "T", text: "B", cacheKey: "k" });
        expect(changed).to.deep.equal([uri.toString()]);
    });

    test("expired entries return an honest expiry comment, never stale text", () => {
        const provider = new DefinitionContentProvider();
        const uri = vscode.Uri.from({ scheme: DEFINITION_SCHEME, path: "/gone.sql", query: "x" });
        expect(provider.provideTextDocumentContent(uri)).to.contain("expired");
    });

    test("the cache is LRU-bounded", () => {
        const provider = new DefinitionContentProvider();
        const first = provider.store({ title: "T0", text: "S0", cacheKey: "k0" });
        for (let i = 1; i <= 40; i++) {
            provider.store({ title: `T${i}`, text: `S${i}`, cacheKey: `k${i}` });
        }
        expect(provider.size).to.equal(32);
        expect(provider.provideTextDocumentContent(first)).to.contain("expired");
    });
});
