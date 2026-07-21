/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    buildLocalToolchainProvenance,
    readDacFxVersionFromServiceRoot,
} from "../../src/runbookStudio/runtime/localToolchainProvenance";

suite("Runbook Studio local toolchain provenance", () => {
    let root: string;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-toolchain-"));
    });

    teardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("records runtime and extension versions plus the hosted DacFx dependency", () => {
        fs.writeFileSync(
            path.join(root, "MicrosoftSqlToolsServiceLayer.deps.json"),
            JSON.stringify({ libraries: { "Microsoft.SqlServer.DacFx/170.5.38-preview": {} } }),
        );

        const result = buildLocalToolchainProvenance({
            vscodeVersion: "1.106.0-insider",
            mssqlExtensionVersion: "1.45.0",
            sqlDatabaseProjectsExtensionVersion: "1.5.0",
            sqlToolsServiceRuntimeVersion: "6.0.0.0",
            sqlToolsServiceConfiguredVersion: "6.0.20260713.1",
            sqlToolsServiceRoot: root,
            dockerEngineVersion: "29.6.1",
        });

        expect(result.complete).to.equal(true);
        expect(result.components.map((entry) => entry.id)).to.deep.equal([
            "vscode",
            "mssqlExtension",
            "sqlDatabaseProjectsExtension",
            "sqlToolsService",
            "dacFx",
            "dockerEngine",
        ]);
        expect(result.components.find((entry) => entry.id === "sqlToolsService")).to.include({
            version: "6.0.0.0",
            configuredVersion: "6.0.20260713.1",
            versionSource: "runtimeRequest",
        });
        expect(result.components.find((entry) => entry.id === "dacFx")).to.include({
            version: "170.5.38-preview",
            hostComponent: "sqlToolsService",
        });
    });

    test("uses configured STS identity but marks unverified runtime provenance incomplete", () => {
        const result = buildLocalToolchainProvenance({
            vscodeVersion: "1.106.0",
            mssqlExtensionVersion: "1.45.0",
            sqlDatabaseProjectsExtensionVersion: undefined,
            sqlToolsServiceRuntimeVersion: undefined,
            sqlToolsServiceConfiguredVersion: "6.0.20260713.1",
        });

        expect(result.complete).to.equal(false);
        expect(result.components.find((entry) => entry.id === "sqlToolsService")).to.include({
            version: "6.0.20260713.1",
            status: "unverified",
            versionSource: "packagedConfiguration",
        });
        expect(result.components.find((entry) => entry.id === "dacFx")).to.include({
            version: null,
            status: "unavailable",
        });
    });

    test("rejects oversized, malformed, and unsafe dependency versions", () => {
        const manifestPath = path.join(root, "MicrosoftSqlToolsServiceLayer.deps.json");
        fs.writeFileSync(manifestPath, "not json");
        expect(readDacFxVersionFromServiceRoot(root)).to.equal(null);

        fs.writeFileSync(
            manifestPath,
            JSON.stringify({ libraries: { "Microsoft.SqlServer.DacFx/../../private": {} } }),
        );
        expect(readDacFxVersionFromServiceRoot(root)).to.equal(null);
    });
});
