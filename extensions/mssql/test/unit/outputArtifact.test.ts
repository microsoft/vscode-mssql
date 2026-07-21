/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    outputArtifactEditorViewType,
    retainedOutputArtifact,
    verifyRetainedOutputArtifact,
    XEL_CUSTOM_EDITOR_VIEW_TYPE,
} from "../../src/runbookStudio/outputArtifact";
import { RunbookResultStore } from "../../src/runbookStudio/runbookResultStore";

suite("Runbook Studio output artifact", () => {
    let root: string;
    let artifactPath: string;
    let contents: Buffer;
    let digest: string;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-output-artifact-"));
        artifactPath = path.join(root, "database.dacpac");
        contents = Buffer.from("bounded dacpac fixture", "utf8");
        fs.writeFileSync(artifactPath, contents);
        digest = createHash("sha256").update(contents).digest("hex");
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const payload = () => ({
        contract: "dacpacArtifact/1",
        scalars: {
            artifactPath,
            artifactSha256: digest,
            artifactSizeBytes: contents.length,
        },
    });

    test("admits and verifies a typed artifact confined to its trusted root", async () => {
        const artifact = retainedOutputArtifact(payload());
        expect(artifact).to.include({
            contract: "dacpacArtifact/1",
            artifactPath,
            artifactSha256: digest,
            artifactSizeBytes: contents.length,
            fileName: "database.dacpac",
        });
        expect(await verifyRetainedOutputArtifact(artifact!, [root])).to.equal(artifactPath);
    });

    test("admits a managed XEL artifact under the closed capture contract", async () => {
        const xelPath = path.join(root, "rbs_xe_capture.xel");
        const xelContents = Buffer.from("bounded xel fixture", "utf8");
        fs.writeFileSync(xelPath, xelContents);
        const artifact = retainedOutputArtifact({
            contract: "xelArtifact/1",
            scalars: {
                artifactPath: xelPath,
                artifactSha256: createHash("sha256").update(xelContents).digest("hex"),
                artifactSizeBytes: xelContents.length,
            },
        });
        expect(artifact).to.include({
            contract: "xelArtifact/1",
            artifactPath: xelPath,
            fileName: "rbs_xe_capture.xel",
        });
        expect(await verifyRetainedOutputArtifact(artifact!, [root])).to.equal(xelPath);
        expect(outputArtifactEditorViewType(artifact!.contract)).to.equal(
            XEL_CUSTOM_EDITOR_VIEW_TYPE,
        );
        expect(outputArtifactEditorViewType("dacpacArtifact/1")).to.equal(undefined);
    });

    test("refuses unknown contracts, wrong extensions, and non-file paths", () => {
        expect(retainedOutputArtifact({ ...payload(), contract: "rowset/1" })).to.equal(undefined);
        expect(
            retainedOutputArtifact({
                ...payload(),
                scalars: { ...payload().scalars, artifactPath: path.join(root, "database.exe") },
            }),
        ).to.equal(undefined);
        expect(
            retainedOutputArtifact({
                ...payload(),
                scalars: { ...payload().scalars, artifactPath: "preview://database.dacpac" },
            }),
        ).to.equal(undefined);
    });

    test("refuses root escape, size drift, and content drift", async () => {
        const artifact = retainedOutputArtifact(payload())!;
        const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-output-other-"));
        try {
            expect(await verifyRetainedOutputArtifact(artifact, [otherRoot])).to.equal(undefined);
        } finally {
            fs.rmSync(otherRoot, { recursive: true, force: true });
        }

        fs.appendFileSync(artifactPath, " changed");
        expect(await verifyRetainedOutputArtifact(artifact, [root])).to.equal(undefined);

        fs.writeFileSync(artifactPath, Buffer.from("same-length-different", "utf8"));
        const sameLength = fs.readFileSync(artifactPath);
        const sameLengthArtifact = retainedOutputArtifact({
            ...payload(),
            scalars: {
                ...payload().scalars,
                artifactSizeBytes: sameLength.length,
                artifactSha256: digest,
            },
        })!;
        expect(await verifyRetainedOutputArtifact(sameLengthArtifact, [root])).to.equal(undefined);
    });

    test("rehydrates host metadata while omitting the file path from page pulls", () => {
        const storeRoot = path.join(root, "results");
        const first = new RunbookResultStore(storeRoot);
        const ref = first.put("run_artifact", "extract", payload());
        const restarted = new RunbookResultStore(storeRoot);

        expect(restarted.readOutputArtifact(ref.handleId)).to.include({
            fileName: "database.dacpac",
            artifactSha256: digest,
        });
        const page = restarted.fetchPage(ref.handleId, 0, 20);
        expect(page?.rows?.some((row) => row[0] === "artifactPath")).to.equal(false);
        expect(page?.rows).to.deep.include(["artifactSizeBytes", contents.length]);
    });
});
