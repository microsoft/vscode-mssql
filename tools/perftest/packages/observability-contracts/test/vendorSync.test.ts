/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vendor-sync guard (pre-branch stabilizer): the snapshot vendored into
 * vscode-mssql must be byte-identical to the generated output of THIS
 * package. Registry edits without regenerate+re-vendor fail here — the two
 * copies can never silently diverge across the feature branch split.
 */

import { describe, expect, test } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { format } from "prettier";
import { GENERATED_PRETTIER_OPTIONS, generateMarkdown, generateSnapshot } from "../src/generator";

const GENERATED_MARKDOWN = path.join(__dirname, "..", "generated", "markdown", "EVENTS.md");

const GENERATED = path.join(
    __dirname,
    "..",
    "generated",
    "typescript",
    "observabilityContract.generated.ts",
);
const VENDORED = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "extensions",
    "mssql",
    "src",
    "sharedInterfaces",
    "observabilityContract.generated.ts",
);

describe("vendored snapshot sync", () => {
    const formatSnapshot = () =>
        format(generateSnapshot(), {
            parser: "typescript",
            ...GENERATED_PRETTIER_OPTIONS,
        });

    const formatMarkdown = () =>
        format(generateMarkdown(), {
            parser: "markdown",
            ...GENERATED_PRETTIER_OPTIONS,
        });

    test("tracked generated output is fresh", async () => {
        expect(fs.readFileSync(GENERATED, "utf8")).toBe(await formatSnapshot());
        expect(fs.readFileSync(GENERATED_MARKDOWN, "utf8")).toBe(await formatMarkdown());
    });

    test("generated output matches the copy vendored into vscode-mssql", async () => {
        if (!fs.existsSync(VENDORED)) {
            // Standalone checkout of perftest without the sibling repo: nothing to
            // compare against — skip honestly rather than fake a pass.
            console.warn("vendored copy not found (standalone checkout) — skipped");
            return;
        }
        // The vscode-mssql pre-commit hook prettier-formats the vendored copy
        // (whitespace + unquoting identifier-safe object keys), so normalize both
        // transformations away: any SEMANTIC drift (registry content, types,
        // function bodies) still fails; reformatting does not.
        const normalize = (s: string) =>
            s
                .replace(/"([A-Za-z_][A-Za-z0-9_]*)":/g, "$1:")
                .replace(/\s+/g, "")
                .replace(/,([}\])])/g, "$1");
        const generated = normalize(await formatSnapshot());
        const vendored = normalize(fs.readFileSync(VENDORED, "utf8"));
        expect(
            generated === vendored,
            "vendored snapshot is STALE — run `npm run build && npm run generate` here, then copy generated/typescript/observabilityContract.generated.ts to extensions/mssql/src/sharedInterfaces/",
        ).toBe(true);
    });
});
