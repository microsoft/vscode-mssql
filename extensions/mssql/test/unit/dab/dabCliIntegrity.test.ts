/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
    computeDabCliTreeDigest,
    DAB_CLI_TREE_DIGESTS,
    getPinnedDabCliTreeDigest,
    isOfficialDabCliInstallation,
} from "../../../src/dab/dabCliIntegrity";
import { DAB_AZURE_CLI_ZIP_SHA256 } from "../../../src/dab/dabAzureCli";
import { Dab } from "../../../src/sharedInterfaces/dab";

suite("DAB CLI integrity", () => {
    let root: string;

    async function writeTree(files: Record<string, string>): Promise<void> {
        for (const [relativePath, contents] of Object.entries(files)) {
            const fullPath = path.join(root, ...relativePath.split("/"));
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, contents);
        }
    }

    setup(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "dab-integrity-"));
    });

    teardown(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    test("pins a digest for every runtime the pinned release publishes", () => {
        for (const runtimeIdentifier of [
            "win-x64",
            "linux-x64",
            "linux-arm64",
            "osx-x64",
            "osx-arm64",
        ]) {
            expect(
                getPinnedDabCliTreeDigest(Dab.DAB_CLI_VERSION, runtimeIdentifier),
                runtimeIdentifier,
            ).to.match(/^[0-9a-f]{64}$/);
        }
        expect(Object.keys(DAB_CLI_TREE_DIGESTS)).to.include(Dab.DAB_CLI_VERSION);
    });

    test("digests a tree by path and contents, leaving out the install marker", async () => {
        await writeTree({
            "tools/net10.0/any/DotnetToolSettings.xml": "<x/>",
            "tools/net10.0/win-x64/Microsoft.DataApiBuilder.dll": "assembly",
        });
        const digest = await computeDabCliTreeDigest(root);

        await writeTree({ ".installed": "2.1.5" });
        expect(
            await computeDabCliTreeDigest(root),
            "The marker is not part of the release",
        ).to.equal(digest);

        await writeTree({ "tools/net10.0/win-x64/Microsoft.DataApiBuilder.dll": "changed" });
        expect(await computeDabCliTreeDigest(root)).to.not.equal(digest);
    });

    test("notices a file added next to the release", async () => {
        await writeTree({ "tools/net10.0/win-x64/Microsoft.DataApiBuilder.dll": "assembly" });
        const digest = await computeDabCliTreeDigest(root);

        await writeTree({ "tools/net10.0/win-x64/extra.dll": "extra" });
        expect(await computeDabCliTreeDigest(root)).to.not.equal(digest);
    });

    test("does not accept an install that is not the official release", async () => {
        await writeTree({ "tools/net10.0/any/Microsoft.DataApiBuilder.dll": "extra" });

        expect(await isOfficialDabCliInstallation(root, Dab.DAB_CLI_VERSION, "win-x64")).to.be
            .false;
    });

    test("never accepts a release or runtime with no pinned digest", async () => {
        await writeTree({ "tools/net10.0/any/Microsoft.DataApiBuilder.dll": "assembly" });

        expect(await isOfficialDabCliInstallation(root, "0.0.0", "win-x64")).to.be.false;
        expect(await isOfficialDabCliInstallation(root, Dab.DAB_CLI_VERSION, "win-arm64")).to.be
            .false;
    });

    test("pins the Azure CLI download by its SHA-256", () => {
        expect(DAB_AZURE_CLI_ZIP_SHA256).to.match(/^[0-9a-f]{64}$/);
    });
});
