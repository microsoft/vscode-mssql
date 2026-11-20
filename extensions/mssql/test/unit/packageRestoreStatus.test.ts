/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { isPackageRestoreOutOfSync } from "../../src/codeAnalysis/packageRestoreStatus";

/** Builds a project.assets.json body for a single-framework restore. */
function assetsJson(options: {
    libraries?: string[];
    dependencies?: Record<string, string>;
    logs?: { code: string; level: string }[];
}): string {
    return JSON.stringify({
        version: 3,
        libraries: Object.fromEntries(
            (options.libraries ?? []).map((library) => [library, { type: "package" }]),
        ),
        project: {
            frameworks: {
                "net8.0": {
                    dependencies: Object.fromEntries(
                        Object.entries(options.dependencies ?? {}).map(([name, version]) => [
                            name,
                            { target: "Package", version },
                        ]),
                    ),
                },
            },
        },
        logs: options.logs ?? [],
    });
}

const sampleRules = { name: "SampleRules", version: "1.0.4" };
const inSyncAssets = assetsJson({
    libraries: ["SampleRules/1.0.4"],
    dependencies: { SampleRules: "[1.0.4, )" },
});

suite("isPackageRestoreOutOfSync", () => {
    test("is in sync when the project references no packages, even without an assets file", () => {
        expect(isPackageRestoreOutOfSync([], undefined)).to.be.false;
    });

    test("is out of sync when the project has never been restored", () => {
        expect(isPackageRestoreOutOfSync([sampleRules], undefined)).to.be.true;
    });

    test("is out of sync when the assets file can't be parsed", () => {
        expect(isPackageRestoreOutOfSync([sampleRules], "{ not json")).to.be.true;
    });

    test("is in sync when the restored range matches the referenced version", () => {
        expect(isPackageRestoreOutOfSync([sampleRules], inSyncAssets)).to.be.false;
    });

    test("is out of sync when the last restore failed", () => {
        // NuGet records the new range and the NU1102 error even though nothing was resolved.
        const failedRestore = assetsJson({
            libraries: ["SampleRules/1.0.3"],
            dependencies: { SampleRules: "[1.0.4, )" },
            logs: [{ code: "NU1102", level: "Error" }],
        });

        expect(isPackageRestoreOutOfSync([sampleRules], failedRestore)).to.be.true;
    });

    test("is out of sync when the .sqlproj version changed since the last restore", () => {
        const staleRestore = assetsJson({
            libraries: ["SampleRules/1.0.3"],
            dependencies: { SampleRules: "[1.0.3, )" },
        });

        expect(isPackageRestoreOutOfSync([sampleRules], staleRestore)).to.be.true;
    });

    test("is out of sync when a package was added since the last restore", () => {
        expect(
            isPackageRestoreOutOfSync(
                [sampleRules, { name: "OtherRules", version: "2.0.0" }],
                inSyncAssets,
            ),
        ).to.be.true;
    });

    test("is out of sync when a referenced package wasn't resolved", () => {
        const unresolved = assetsJson({ dependencies: { SampleRules: "[1.0.4, )" } });

        expect(isPackageRestoreOutOfSync([sampleRules], unresolved)).to.be.true;
    });

    test("normalizes versions and ignores package name casing", () => {
        const restored = assetsJson({
            libraries: ["samplerules/1.0.0-beta"],
            dependencies: { samplerules: "[1.0.0-beta, 2.0.0)" },
        });

        expect(
            isPackageRestoreOutOfSync(
                [{ name: "SampleRules", version: "[1.0-Beta,2.0)" }],
                restored,
            ),
        ).to.be.false;
    });

    test("skips the version comparison for versions it can't compare", () => {
        const restored = assetsJson({
            libraries: ["SampleRules/1.0.4"],
            dependencies: { SampleRules: "[1.0.4, )" },
        });

        expect(isPackageRestoreOutOfSync([{ name: "SampleRules", version: "1.*" }], restored)).to.be
            .false;
        expect(isPackageRestoreOutOfSync([{ name: "SampleRules", version: undefined }], restored))
            .to.be.false;
    });
});
