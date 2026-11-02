/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { test } from "node:test";
import { lintMssql } from "./lint-mssql.mjs";

test("forwards ESLint options to every group and keeps their caches separate", () => {
    const caches = [];
    const result = lintMssql(["--fix", "--no-cache"], (command, args, options) => {
        assert.equal(command, process.execPath);
        assert.deepEqual(args.slice(-2), ["--fix", "--no-cache"]);
        assert.equal(options.shell, undefined);
        caches.push(args[args.indexOf("--cache-location") + 1]);
        return { status: 0 };
    });
    assert.equal(result, 0);
    assert.ok(caches.length > 1);
    assert.equal(new Set(caches).size, caches.length);
});

test("stops and preserves ESLint's nonzero exit status when a later group fails", () => {
    let calls = 0;
    const result = lintMssql([], () => ({ status: ++calls === 1 ? 0 : 2 }));
    assert.equal(result, 2);
    assert.equal(calls, 2);
});

test("a terminated or unstartable ESLint process cannot pass lint", () => {
    assert.equal(
        lintMssql([], () => ({ status: null, signal: "SIGTERM" })),
        1,
    );
    const error = new Error("Unable to start ESLint");
    assert.throws(
        () => lintMssql([], () => ({ status: null, error })),
        (actual) => actual === error,
    );
});
