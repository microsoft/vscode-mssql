/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQLCMD preprocessor (SQLCMD_MODE_PLAN.md §5): STS ManagedBatchParser
 * parity — the six functional commands work, everything else is recognized
 * then rejected, undefined variables are fatal, and directives are never
 * recognized inside strings/comments.
 */

import { expect } from "chai";
import {
    parseSqlcmdScript,
    SqlcmdBatchStep,
    SqlcmdConnectStep,
    SqlcmdOnErrorStep,
    SqlcmdParseResult,
    SqlcmdSeams,
    SQLCMD_DIRECTIVE_HEADS,
} from "../../src/sql/sqlcmdPreprocessor";

function okSteps(
    text: string,
    seams?: SqlcmdSeams,
): Extract<SqlcmdParseResult, { kind: "script" }> {
    const result = parseSqlcmdScript(text, seams);
    if (result.kind === "parseError") {
        throw new Error(`expected ok, got ${result.code}: ${result.message}`);
    }
    return result;
}

function errOf(
    text: string,
    seams?: SqlcmdSeams,
): Extract<SqlcmdParseResult, { kind: "parseError" }> {
    const result = parseSqlcmdScript(text, seams);
    if (result.kind === "script") {
        throw new Error("expected a parse error");
    }
    return result;
}

suite("sqlcmd preprocessor: plain SQL passthrough", () => {
    test("no directives, no variables → one byte-identical batch step", () => {
        const text = "SELECT 1\nGO 2\nSELECT ':not a directive literal?' -- no\nGO";
        const result = okSteps(text);
        expect(result.steps).to.have.length(1);
        const step = result.steps[0] as SqlcmdBatchStep;
        expect(step.kind).to.equal("batch");
        expect(step.text).to.equal(text);
        expect(step.startLine).to.equal(0);
        expect(result.stats.substitutions).to.equal(0);
    });

    test("empty and whitespace-only input yields no steps", () => {
        expect(okSteps("").steps).to.deep.equal([]);
        expect(okSteps("  \n\t\n").steps).to.deep.equal([]);
    });
});

suite("sqlcmd preprocessor: :setvar and $(var)", () => {
    test("setvar then substitution (case-insensitive lookup)", () => {
        const result = okSteps(':setvar TableName "Sales.Orders"\nSELECT * FROM $(tablename)');
        expect(result.steps).to.have.length(1);
        expect((result.steps[0] as SqlcmdBatchStep).text).to.equal("SELECT * FROM Sales.Orders");
        expect(result.stats.setvars).to.equal(1);
        expect(result.stats.substitutions).to.equal(1);
    });

    test("later setvar wins; setvar without value removes (STS parity)", () => {
        const result = okSteps(":setvar x 1\n:setvar x 2\nSELECT $(x)");
        expect((result.steps[0] as SqlcmdBatchStep).text).to.equal("SELECT 2");
        const removed = errOf(":setvar x 1\n:setvar x\nSELECT $(x)");
        expect(removed.code).to.equal("variableNotDefined");
        expect(removed.line).to.equal(2);
    });

    test("environment seam is the fallback; setvar shadows it", () => {
        const seams: SqlcmdSeams = { env: (n) => (n === "COMPUTERNAME" ? "BOX9" : undefined) };
        expect(
            (okSteps("SELECT '$(COMPUTERNAME)'", seams).steps[0] as SqlcmdBatchStep).text,
        ).to.equal("SELECT 'BOX9'");
        expect(
            (
                okSteps(":setvar COMPUTERNAME me\nSELECT '$(COMPUTERNAME)'", seams)
                    .steps[0] as SqlcmdBatchStep
            ).text,
        ).to.equal("SELECT 'me'");
    });

    test("undefined variable is fatal for the whole parse", () => {
        const err = errOf("SELECT 1\nSELECT $(nope)");
        expect(err.code).to.equal("variableNotDefined");
        expect(err.line).to.equal(1);
    });

    test("unclosed $( and invalid names are fatal", () => {
        expect(errOf("SELECT $(broken").code).to.equal("invalidVariableName");
        expect(errOf("SELECT $(a b)").code).to.equal("invalidVariableName");
        expect(errOf(":setvar 'bad name' 1\nSELECT 1").code).to.equal("badSyntax");
    });

    test("substitution applies on directive arguments too", () => {
        const result = okSteps(":setvar srv myserver\n:connect $(srv)\nSELECT 1");
        const connect = result.steps.find((s) => s.kind === "connect") as SqlcmdConnectStep;
        expect(connect.server).to.equal("myserver");
    });

    test("multiple references on one line", () => {
        const result = okSteps(":setvar a 1\n:setvar b 2\nSELECT $(a)+$(b), '$(a)'");
        expect((result.steps[0] as SqlcmdBatchStep).text).to.equal("SELECT 1+2, '1'");
    });
});

suite("sqlcmd preprocessor: directive recognition vs strings/comments", () => {
    test("a ':' line inside a multi-line string is content, not a command", () => {
        const text = "SELECT '\n:setvar x 1\n' AS s";
        const result = okSteps(text);
        expect(result.steps).to.have.length(1);
        expect(result.stats.setvars).to.equal(0);
        expect((result.steps[0] as SqlcmdBatchStep).text).to.equal(text);
    });

    test("a ':' line inside a block comment is content", () => {
        const text = "/*\n:quit\n*/\nSELECT 1";
        const result = okSteps(text);
        expect(result.steps).to.have.length(1);
        expect((result.steps[0] as SqlcmdBatchStep).text).to.equal(text);
    });

    test("directive after the string closes IS recognized", () => {
        const err = errOf("SELECT '\ntext\n' AS s\n:quit");
        expect(err.code).to.equal("unsupportedCommand");
        expect(err.line).to.equal(3);
    });
});

suite("sqlcmd preprocessor: :on error and :connect", () => {
    test(":on error exit|ignore split batches and are case-insensitive", () => {
        const result = okSteps("SELECT 1\n:ON ERROR exit\nSELECT 2\n:on error IGNORE\nSELECT 3");
        expect(result.steps.map((s) => s.kind)).to.deep.equal([
            "batch",
            "onError",
            "batch",
            "onError",
            "batch",
        ]);
        expect((result.steps[1] as SqlcmdOnErrorStep).action).to.equal("exit");
        expect((result.steps[3] as SqlcmdOnErrorStep).action).to.equal("ignore");
        expect((result.steps[2] as SqlcmdBatchStep).startLine).to.equal(2);
    });

    test(":on error anything-else is badSyntax", () => {
        expect(errOf(":on error retry").code).to.equal("badSyntax");
        expect(errOf(":on failure exit").code).to.equal("badSyntax");
    });

    test(":connect parses server, -U, -P (quoted values allowed)", () => {
        const result = okSteps(':connect "my server" -U sa -P "p ss"\nSELECT 1');
        const connect = result.steps[0] as SqlcmdConnectStep;
        expect(connect).to.include({ kind: "connect", server: "my server", user: "sa" });
        expect(connect.password).to.equal("p ss");
    });

    test(":connect integrated (no -U/-P) and syntax errors", () => {
        const connect = okSteps(":connect srv\nSELECT 1").steps[0] as SqlcmdConnectStep;
        expect(connect.user).to.equal(undefined);
        expect(connect.password).to.equal(undefined);
        expect(errOf(":connect").code).to.equal("badSyntax");
        expect(errOf(":connect srv extra").code).to.equal("badSyntax");
        expect(errOf(":connect srv -U").code).to.equal("badSyntax");
    });
});

suite("sqlcmd preprocessor: :r includes", () => {
    const files: Record<string, string> = {
        "vars.sql": ":setvar t Included\nSELECT '$(t)'",
        "a.sql": ":r b.sql\nSELECT 'a'",
        "b.sql": ":r a.sql",
        "self.sql": ":r self.sql",
    };
    const seams: SqlcmdSeams = {
        readInclude: (raw) =>
            raw in files ? { path: `C:/inc/${raw}`, text: files[raw] } : undefined,
    };

    test("included lines splice inline and carry the :r line", () => {
        const result = okSteps("SELECT 0\n:r vars.sql\nSELECT 'after'", seams);
        expect(result.stats.includes).to.equal(1);
        const texts = result.steps.map((s) => (s as SqlcmdBatchStep).text);
        expect(texts.join("\n")).to.contain("SELECT 'Included'");
        expect(texts.join("\n")).to.contain("SELECT 'after'");
    });

    test("missing file, no seam, and circular includes fail honestly", () => {
        expect(errOf(":r missing.sql", seams).code).to.equal("includeFailed");
        expect(errOf(":r vars.sql").code).to.equal("includeFailed");
        expect(errOf(":r self.sql", seams).code).to.equal("circularInclude");
        expect(errOf(":r a.sql", seams).code).to.equal("circularInclude");
    });
});

suite("sqlcmd preprocessor: rejected commands (STS parity)", () => {
    test("recognized-but-unsupported commands error with unsupportedCommand", () => {
        for (const cmd of [
            "out results.txt",
            "exit",
            "quit",
            "reset",
            "xml on",
            "listvar",
            "!!dir",
        ]) {
            const err = errOf(`:${cmd}\nSELECT 1`);
            expect(err.code, cmd).to.equal("unsupportedCommand");
            expect(err.line, cmd).to.equal(0);
        }
    });

    test("unknown commands error with unrecognizedCommand", () => {
        expect(errOf(":frobnicate 1").code).to.equal("unrecognizedCommand");
    });

    test("directive head set covers functional + rejected commands", () => {
        for (const head of ["setvar", "r", "on", "connect", "out", "exit", "listvar"]) {
            expect(SQLCMD_DIRECTIVE_HEADS.has(head), head).to.equal(true);
        }
        expect(SQLCMD_DIRECTIVE_HEADS.has("select")).to.equal(false);
    });
});
