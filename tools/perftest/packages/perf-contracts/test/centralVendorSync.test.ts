import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Vendored central-contract sync guard (C0.5): the copies under
 * vscode-mssql src/sharedInterfaces/centralContract/ must be byte-identical
 * to perf-contracts src/central/ after stripping the GENERATED header.
 * Skips when the vscode-mssql checkout is not present (CI without the
 * sibling repo).
 */
const SRC = join(__dirname, "..", "src", "central");
const VENDORED = join(
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
    "centralContract",
);

const maybe = existsSync(VENDORED) ? describe : describe.skip;

maybe("central contract vendor sync (vscode-mssql)", () => {
    it("every src/central file is vendored byte-identically after the header", () => {
        const files = readdirSync(SRC).filter((f) => f.endsWith(".ts"));
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            const source = readFileSync(join(SRC, file), "utf8");
            const vendoredPath = join(VENDORED, file);
            expect(existsSync(vendoredPath), `${file} not vendored`).toBe(true);
            const vendored = readFileSync(vendoredPath, "utf8");
            const headerEnd = vendored.indexOf("*/");
            expect(headerEnd, `${file} missing GENERATED header`).toBeGreaterThan(0);
            expect(vendored.slice(0, headerEnd)).toContain("GENERATED");
            // Content identity modulo line endings: the vscode-mssql pre-commit
            // hook rewrites the vendored copies to CRLF.
            const normalize = (s: string) => s.split("\r").join("");
            const body = normalize(vendored.slice(headerEnd + 3)).replace(/^\n/, "");
            expect(body, `${file} drifted — re-vendor from perf-contracts`).toBe(normalize(source));
        }
    });
});
