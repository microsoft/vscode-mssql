/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeHeadlessRunOutputs } from "../../src/runbookStudio/headless/headlessOutputStore";

suite("Runbook Studio headless output store", () => {
    let root: string;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-headless-output-"));
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("commits fixed create-new evidence files before the summary marker", () => {
        writeHeadlessRunOutputs(
            root,
            { schemaVersion: 1, outcome: "pass", secret: undefined },
            {
                json: {
                    content: '{"evidence":true}\n',
                    extension: "json",
                    mediaType: "application/json",
                    filterLabel: "JSON",
                    sourceIdentity: {
                        runId: "run-1",
                        runbookId: "book-1",
                        planRevision: "1",
                        planHash: `sha256:${"a".repeat(64)}`,
                        runtimeKind: "fake",
                        verdict: "pass",
                    },
                },
            },
        );

        expect(fs.readFileSync(path.join(root, "evidence.machine.json"), "utf8")).to.equal(
            '{"evidence":true}\n',
        );
        expect(JSON.parse(fs.readFileSync(path.join(root, "run-summary.json"), "utf8"))).to.include(
            { schemaVersion: 1, outcome: "pass" },
        );
        expect(fs.readdirSync(root).some((name) => name.endsWith(".tmp"))).to.equal(false);
        expect(() =>
            writeHeadlessRunOutputs(root, { schemaVersion: 1, outcome: "pass" }, undefined),
        ).to.throw("headless output already exists");
    });
});
