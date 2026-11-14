/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import * as yauzl from "yauzl";
import { addConnectionButton } from "./utils/commonSelectors";
import { test, expect } from "./baseFixtures";
import { getWebviewByTitle } from "./utils/testHelpers";
import { usePerTestVsCodeLifecycle } from "./utils/testLifecycle";
import { testCases } from "./utils/testCases";

const EXTENSION_ROOT = path.join(__dirname, "..", "..");
const sourceManifest = JSON.parse(
    fs.readFileSync(path.join(EXTENSION_ROOT, "package.json"), "utf8"),
) as { name: string; publisher: string; version: string };

/**
 * Upper bound for a packaged MSSQL VSIX. Packages were about 124 MB in November 2026 (the
 * baseline published by publish-baseline.yml); this leaves headroom for normal growth while still
 * catching a package that balloons unexpectedly.
 */
const MAX_VSIX_SIZE_MB = 160;

function getBuiltVsixPath(): string | undefined {
    return process.env["BUILT_VSIX_PATH"];
}

/** Reads one file out of a VSIX (a zip archive). */
function readVsixEntry(vsixPath: string, entryName: string): Promise<string> {
    return new Promise((resolve, reject) => {
        yauzl.open(vsixPath, { lazyEntries: true }, (openError, zip) => {
            if (openError || !zip) {
                reject(openError ?? new Error(`Could not open ${vsixPath}`));
                return;
            }
            zip.on("entry", (entry: yauzl.Entry) => {
                if (entry.fileName !== entryName) {
                    zip.readEntry();
                    return;
                }
                zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError || !stream) {
                        reject(streamError ?? new Error(`Could not read ${entryName}`));
                        return;
                    }
                    const chunks: Buffer[] = [];
                    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                    stream.on("end", () => {
                        zip.close();
                        resolve(Buffer.concat(chunks).toString("utf8"));
                    });
                    stream.on("error", reject);
                });
            });
            zip.on("end", () => reject(new Error(`${entryName} is not in ${vsixPath}`)));
            zip.on("error", reject);
            zip.readEntry();
        });
    });
}

/**
 * CI stamps pre-release builds with a suffix such as `-pr.<run>+<sha>`, so a packaged version is
 * correct when it is the source version, optionally followed by pre-release or build metadata.
 */
function expectSourceVersion(version: string | undefined): void {
    const escaped = sourceManifest.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(version).toMatch(new RegExp(`^${escaped}([-+].*)?$`));
}

/** Markdown headings, which identify a README's structure independently of link rewriting. */
function getMarkdownHeadings(markdown: string): string[] {
    return markdown
        .split(/\r?\n/)
        .filter((line) => /^#{1,6}\s/.test(line))
        .map((line) => line.trim());
}

/**
 * Running a few launch specific tests to ensure the VSIX package is working correctly.
 * Since code-coverage is not supported for VSIX based tests, we are converting all tests to use the VSIX package.
 */
test.describe("MSSQL Extension - VSIX Based tests", async () => {
    test.skip(!getBuiltVsixPath(), "Skipping VSIX-based tests because BUILT_VSIX_PATH is not set.");

    const getContext = usePerTestVsCodeLifecycle({
        launchOptions: {
            useVsix: true,
        },
    });

    // Test if extension activates correctly
    test("Extension activates correctly", testCases(5878822), async () => {
        const { electronApp: vsCodeApp } = getContext();
        expect(vsCodeApp).not.toBeNull();
    });

    // Test if the webview loads correctly
    test("MSSQL add connection webview is loaded correctly", testCases(5878822), async () => {
        const { page: vsCodePage } = getContext();
        const addButton = await vsCodePage.locator(addConnectionButton);
        await addButton.click();
        const connectionDialog = await getWebviewByTitle(vsCodePage, "Connection Dialog");
        await expect(
            connectionDialog.getByRole("button", { name: "Connect", exact: true }),
        ).toBeVisible();
    });

    test("the installed extension reports the source version", testCases(5878822), async () => {
        const { extensionsDir } = getContext();
        const installed = JSON.parse(
            fs.readFileSync(path.join(extensionsDir, "extensions.json"), "utf8"),
        ) as Array<{ identifier: { id: string }; version: string }>;
        const mssql = installed.find(
            (extension) =>
                extension.identifier.id.toLowerCase() ===
                `${sourceManifest.publisher}.${sourceManifest.name}`.toLowerCase(),
        );
        expectSourceVersion(mssql?.version);
    });
});

/** Checks the packaged VSIX itself: the version, README, and size a user downloads. */
test.describe("MSSQL Extension - VSIX package contents", testCases(5878822), () => {
    test.skip(
        !getBuiltVsixPath(),
        "Skipping VSIX package checks because BUILT_VSIX_PATH is not set.",
    );

    test("the packaged manifest has the source version", async () => {
        const packaged = JSON.parse(
            await readVsixEntry(getBuiltVsixPath()!, "extension/package.json"),
        ) as { name: string; publisher: string; version: string };
        expect(packaged.publisher).toBe(sourceManifest.publisher);
        expect(packaged.name).toBe(sourceManifest.name);
        expectSourceVersion(packaged.version);
    });

    test("the packaged README matches the repository README", async () => {
        // vsce stores the README under a lower-cased name.
        const packaged = await readVsixEntry(getBuiltVsixPath()!, "extension/readme.md");
        const source = fs.readFileSync(path.join(EXTENSION_ROOT, "README.md"), "utf8");
        // vsce rewrites relative links, so compare structure rather than the raw text.
        const headings = getMarkdownHeadings(source);
        expect(headings).toContain("# MSSQL extension for Visual Studio Code");
        expect(getMarkdownHeadings(packaged)).toEqual(headings);
    });

    test(`the VSIX is smaller than ${MAX_VSIX_SIZE_MB} MB`, async () => {
        const sizeInMb = fs.statSync(getBuiltVsixPath()!).size / (1024 * 1024);
        expect(sizeInMb).toBeGreaterThan(1);
        expect(sizeInMb).toBeLessThan(MAX_VSIX_SIZE_MB);
    });
});
