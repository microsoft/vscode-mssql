/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
    computeDabCliTreeDigest,
    DAB_CLI_TREE_DIGESTS,
    getPinnedDabCliTreeDigest,
    isOfficialDabCliInstallation,
} from "../../../src/dab/dabCliIntegrity";
import { getConfiguredDabCliFeedUrl } from "../../../src/dab/dabCliTool";
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

suite("DAB CLI feed setting", () => {
    let sandbox: sinon.SinonSandbox;

    function stubSetting(values: {
        globalValue?: string;
        workspaceValue?: string;
        workspaceFolderValue?: string;
    }): void {
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            inspect: () => ({ key: "mssql.dab.cliPackageFeedUrl", ...values }),
            get: () => values.workspaceFolderValue ?? values.workspaceValue ?? values.globalValue,
        } as unknown as vscode.WorkspaceConfiguration);
    }

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("ignores a feed set in workspace or folder settings", () => {
        stubSetting({
            workspaceValue: "https://other.example/flat",
            workspaceFolderValue: "https://other.example/flat",
        });

        expect(getConfiguredDabCliFeedUrl()).to.equal(undefined);
    });

    test("uses a feed the user set in their own settings", () => {
        stubSetting({
            globalValue: " https://mirror.contoso.example/v3-flatcontainer ",
            workspaceValue: "https://other.example/flat",
        });

        expect(getConfiguredDabCliFeedUrl()).to.equal(
            "https://mirror.contoso.example/v3-flatcontainer",
        );
    });

    test("ignores a feed that does not use HTTPS", () => {
        stubSetting({ globalValue: "http://mirror.contoso.example/v3-flatcontainer" });

        expect(getConfiguredDabCliFeedUrl()).to.equal(undefined);
    });

    test("is declared machine-scoped, so VS Code keeps it out of workspace settings", async () => {
        const manifest = JSON.parse(
            await fs.readFile(path.join(__dirname, "..", "..", "..", "..", "package.json"), "utf8"),
        ) as {
            contributes: { configuration: { properties?: Record<string, { scope?: string }> }[] };
        };
        const declaration = manifest.contributes.configuration
            .map((section) => section.properties?.["mssql.dab.cliPackageFeedUrl"])
            .find((property) => property !== undefined);

        expect(declaration?.scope).to.equal("machine");
    });
});
