/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Scan-and-detect framework + the two shipped rules (SQLCMD_MODE_PLAN.md
 * §3.4): per-rule sampling policies, rule isolation, and conservative
 * detection matrices — `::` casts are not sqlcmd, `\` in strings is not
 * psql, directives buried past the sample window are not seen (by design).
 */

import { expect } from "chai";
import { runScanRules, sampleText, ScanRule } from "../../src/queryStudio/scanDetect";
import {
    psqlDetectRule,
    QUERY_STUDIO_SCAN_RULES,
    sqlcmdDetectRule,
} from "../../src/queryStudio/scanDetectRules";

suite("scan-and-detect framework", () => {
    test("headLines sampling clips and reports truncation", () => {
        const text = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
        const sample = sampleText(text, { kind: "headLines", lines: 50 });
        expect(sample.lines).to.have.length(50);
        expect(sample.lines[0]).to.equal("line0");
        expect(sample.totalLines).to.equal(100);
        expect(sample.truncated).to.equal(true);
        const all = sampleText(text, { kind: "fullText" });
        expect(all.lines).to.have.length(100);
        expect(all.truncated).to.equal(false);
    });

    test("fullText maxChars guard clips", () => {
        const sample = sampleText("abcdef\nghij", { kind: "fullText", maxChars: 4 });
        expect(sample.truncated).to.equal(true);
        expect(sample.lines).to.deep.equal(["abcd"]);
        expect(sample.totalLines).to.equal(2);
    });

    test("a throwing rule never blocks the others", () => {
        const bad: ScanRule = {
            id: "bad",
            sampling: { kind: "headLines", lines: 5 },
            detect: () => {
                throw new Error("rule bug");
            },
        };
        const good: ScanRule<boolean> = {
            id: "good",
            sampling: { kind: "headLines", lines: 5 },
            detect: () => true,
        };
        const matches = runScanRules("SELECT 1", [bad, good]);
        expect(matches.map((m) => m.id)).to.deep.equal(["good"]);
    });

    test("distinct sampling policies get distinct samples; same policy is shared", () => {
        const seen: number[] = [];
        const mk = (id: string, lines: number): ScanRule<number> => ({
            id,
            sampling: { kind: "headLines", lines },
            detect: (sample) => {
                seen.push(sample.lines.length);
                return sample.lines.length;
            },
        });
        const text = Array.from({ length: 30 }, () => "x").join("\n");
        runScanRules(text, [mk("a", 10), mk("b", 10), mk("c", 20)]);
        expect(seen).to.deep.equal([10, 10, 20]);
    });
});

suite("scan rule: sqlcmd", () => {
    const detect = (text: string) =>
        runScanRules(text, [sqlcmdDetectRule]).find((m) => m.id === "sqlcmd");

    test("hits: functional and rejected directives at line start", () => {
        for (const text of [
            ":setvar env prod\nSELECT '$(env)'",
            "SELECT 1\nGO\n:connect otherserver",
            "  :r .\\includes\\common.sql",
            ":on error exit\nDELETE FROM t",
            ":OUT results.txt\nSELECT 1", // rejected commands still mark the file
            ":listvar",
            ":!!dir",
        ]) {
            expect(detect(text), text).to.not.equal(undefined);
        }
    });

    test("misses: casts, labels, strings, comments, unknown commands", () => {
        for (const text of [
            "SELECT CAST(x AS int) FROM t",
            "SELECT money::numeric FROM t", // pg cast is not a directive head we know
            "SELECT ':setvar not a command'",
            "SELECT '\n:setvar x 1\n' AS s", // inside a multi-line string
            "/*\n:quit\n*/\nSELECT 1", // inside a block comment
            ":frobnicate 1", // unknown :command — not a sqlcmd signal
            "DECLARE @x int -- :setvar in a comment tail is content",
        ]) {
            expect(detect(text), text).to.equal(undefined);
        }
    });

    test("directives beyond the 50-line window are not seen (bounded by design)", () => {
        const text = Array.from({ length: 60 }, () => "SELECT 1").join("\n") + "\n:setvar x 1";
        expect(detect(text)).to.equal(undefined);
    });

    test("detection reports count and first line", () => {
        const match = detect("SELECT 1\n:setvar a 1\n:setvar b 2");
        expect(match?.detection).to.deep.equal({ directives: 2, firstLine: 1 });
    });
});

suite("scan rule: psql", () => {
    const detect = (text: string) =>
        runScanRules(text, [psqlDetectRule]).find((m) => m.id === "psql");

    test("hits: meta-commands and strong syntax pairs", () => {
        for (const text of [
            "\\c mydb\nSELECT * FROM t;",
            "\\dt\n",
            "  \\set ON_ERROR_STOP on",
            "CREATE EXTENSION postgis;\nCREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE plpgsql;",
            "CREATE FUNCTION f() RETURNS trigger AS $$\nBEGIN\nEND\n$$ LANGUAGE plpgsql;",
        ]) {
            expect(detect(text), text).to.not.equal(undefined);
        }
    });

    test("misses: T-SQL with backslashes in strings, lone $$, comments", () => {
        for (const text of [
            "SELECT 'C:\\temp\\file.txt' AS p",
            "SELECT '$$' AS marker", // one signal only — not enough
            "-- \\dt is a psql thing\nSELECT 1",
            "SELECT 1\nGO\nSELECT 2",
            "/*\n\\c mydb\n*/\nSELECT 1",
        ]) {
            expect(detect(text), text).to.equal(undefined);
        }
    });
});

suite("scan rules: shipped set", () => {
    test("both rules run together and match independently", () => {
        const text = ":setvar x 1\n\\dt\nCREATE EXTENSION hstore;";
        const ids = runScanRules(text, QUERY_STUDIO_SCAN_RULES).map((m) => m.id);
        expect(ids).to.deep.equal(["sqlcmd", "psql"]);
    });
});
