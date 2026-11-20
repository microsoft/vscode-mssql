/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkE2eTags, findTagProblems } from "./check-e2e-tags.mjs";

function report(...specs) {
    return {
        suites: [
            {
                title: "a.spec.ts",
                specs: [],
                suites: [{ title: "Group", specs }],
            },
        ],
    };
}

test("rejects a test tagged both @pull-request and @flaky", () => {
    const problems = findTagProblems(
        report({ title: "t1", file: "a.spec.ts", tags: ["pull-request", "flaky"] }),
    );
    assert.deepEqual(problems, ["a.spec.ts: Group › t1 is tagged both @pull-request and @flaky."]);
});

test("rejects unknown tags, such as a misspelled tier", () => {
    const problems = findTagProblems(report({ title: "t1", file: "a.spec.ts", tags: ["flakey"] }));
    assert.deepEqual(problems, ["a.spec.ts: Group › t1 has unknown tag @flakey."]);
});

test("accepts untagged tests and tests in a single tier", () => {
    const problems = findTagProblems(
        report(
            { title: "stable", file: "a.spec.ts", tags: [] },
            { title: "pr", file: "a.spec.ts", tags: ["pull-request"] },
            { title: "flaky", file: "a.spec.ts", tags: ["flaky"] },
        ),
    );
    assert.deepEqual(problems, []);
});

test("lists every tier and fails on Playwright errors in the listing", () => {
    let options;
    const status = checkE2eTags((command, args, runOptions) => {
        options = runOptions;
        return {
            status: 1,
            stdout: JSON.stringify({
                suites: [],
                errors: [{ message: "SyntaxError in a.spec.ts" }],
            }),
        };
    });
    assert.equal(options.env.E2E_TIER, "all");
    assert.equal(status, 1);
});
