/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B8 / LS-0 core suite: full-fidelity lexer (coverage invariant, strings,
 * nested comments, brackets, variables, temp names, numbers, keyword
 * metadata, GO line rules, SQLCMD directives, line states), batch/statement
 * segmenter, EXECUTION-SPLITTER PARITY over a GO corpus, the feature router
 * (preference, maturity gate, circuit breaker), and the LS-0 native
 * structure features (folding, document symbols).
 */

import { expect } from "chai";
import {
    LineStartMode,
    Token,
    TokenKind,
    lex,
    tokenIndexAt,
} from "../../src/sqlLanguage/core/lexer";
import { segment } from "../../src/sqlLanguage/core/segmenter";
import { TextSnapshot } from "../../src/sqlLanguage/core/text/textSnapshot";
import { splitBatches } from "../../src/sql/batchSplitter";
import { LanguageFeatureRouter } from "../../src/sqlLanguage/host/router";
import { NativeSqlLanguageEngine } from "../../src/sqlLanguage/host/nativeEngine";
import { NullLanguageMetadataProvider } from "../../src/sqlLanguage/provider/nullProvider";
import { FixtureLanguageMetadataProvider } from "../../src/sqlLanguage/provider/fixtureProvider";
import { CompletionResult, SqlLanguageFeatureEngine } from "../../src/sqlLanguage/api";

function significant(text: string): Token[] {
    return lex(text).tokens.filter(
        (t) =>
            t.kind !== TokenKind.Whitespace &&
            t.kind !== TokenKind.NewLine &&
            t.kind !== TokenKind.LineComment &&
            t.kind !== TokenKind.BlockComment &&
            t.kind !== TokenKind.EndOfFile,
    );
}

suite("sqlLanguage lexer", () => {
    test("token spans cover the input exactly and end with EOF", () => {
        const text = "SELECT o.Name, 1.5E-2 FROM [Sales].[Orders] o -- tail\nWHERE x = N'a''b'";
        const { tokens } = lex(text);
        expect(tokens[tokens.length - 1].kind).to.equal(TokenKind.EndOfFile);
        let cursor = 0;
        for (const t of tokens) {
            expect(t.start).to.equal(cursor, `gap before token at ${t.start}`);
            cursor = t.end;
        }
        expect(cursor).to.equal(text.length);
    });

    test("strings: escapes, N-prefix, multi-line, unterminated", () => {
        const escaped = significant("'it''s'");
        expect(escaped).to.have.length(1);
        expect(escaped[0].kind).to.equal(TokenKind.StringLiteral);

        const national = significant("N'käse'");
        expect(national[0].kind).to.equal(TokenKind.StringLiteral);
        expect(national[0].start).to.equal(0); // N is part of the literal

        const multi = lex("SELECT 'line1\nline2' AS x");
        const str = multi.tokens.find((t) => t.kind === TokenKind.StringLiteral);
        expect(str).to.not.equal(undefined);
        expect(multi.lineStates[1].mode).to.equal(LineStartMode.String);

        const open = lex("SELECT 'oops");
        const last = open.tokens[open.tokens.length - 2];
        expect(last.kind).to.equal(TokenKind.StringLiteral);
        expect(last.unterminated).to.equal(true);
    });

    test("block comments nest and track line states", () => {
        const text = "/* a /* b */ still */ SELECT 1";
        const tokens = lex(text).tokens;
        expect(tokens[0].kind).to.equal(TokenKind.BlockComment);
        expect(tokens[0].end).to.equal(text.indexOf("SELECT") - 1);

        const multi = lex("/* top\nmiddle\n*/ SELECT 1");
        expect(multi.lineStates[1].mode).to.equal(LineStartMode.BlockComment);
        expect(multi.lineStates[2].mode).to.equal(LineStartMode.BlockComment);

        const open = lex("/* never closed");
        expect(open.tokens[0].unterminated).to.equal(true);
    });

    test("bracketed and quoted identifiers incl. escapes", () => {
        const brackets = significant("[Order]]s]");
        expect(brackets).to.have.length(1);
        expect(brackets[0].kind).to.equal(TokenKind.BracketedIdentifier);

        const quoted = significant('"My ""Table"""');
        expect(quoted).to.have.length(1);
        expect(quoted[0].kind).to.equal(TokenKind.QuotedIdentifier);
    });

    test("variables, system variables, temp and global temp names", () => {
        const tokens = significant("@x @@ROWCOUNT #tmp ##shared");
        expect(tokens.map((t) => t.kind)).to.deep.equal([
            TokenKind.Variable,
            TokenKind.SystemVariable,
            TokenKind.TempName,
            TokenKind.GlobalTempName,
        ]);
    });

    test("numbers: int, decimal, leading-dot, scientific, hex", () => {
        const tokens = significant("42 3.14 .5 1e5 1.5E-3 0xFF");
        expect(tokens.map((t) => t.kind)).to.deep.equal(new Array(6).fill(TokenKind.NumberLiteral));
    });

    test("keywords are identifiers WITH metadata, never hard tokens", () => {
        const tokens = significant("SELECT Name FROM Orders");
        expect(tokens[0].kind).to.equal(TokenKind.Identifier);
        expect(tokens[0].keyword?.id).to.equal("SELECT");
        expect(tokens[0].keyword?.category).to.equal("statement");
        expect(tokens[1].keyword).to.equal(undefined); // Name is plain
        expect(tokens[2].keyword?.id).to.equal("FROM");
    });

    test("GO: separator only as a whole batch-separator line", () => {
        const sep = lex("SELECT 1\nGO\nSELECT 2").tokens;
        expect(sep.filter((t) => t.kind === TokenKind.GoSeparator)).to.have.length(1);

        const counted = lex("SELECT 1\n  GO 5  -- five times\n").tokens;
        expect(counted.filter((t) => t.kind === TokenKind.GoSeparator)).to.have.length(1);

        // Mid-line GO is an identifier; "GO abc" is content, not a separator.
        const midline = lex("SELECT go FROM t\nGO abc\n").tokens;
        expect(midline.filter((t) => t.kind === TokenKind.GoSeparator)).to.have.length(0);
    });

    test("SQLCMD directive lines are opaque single tokens", () => {
        const tokens = lex(":setvar env prod\nSELECT '$(env)'").tokens;
        expect(tokens[0].kind).to.equal(TokenKind.SqlCmdDirective);
        expect(tokens[0].end).to.equal(":setvar env prod".length);
        // '::' mid-expression stays an operator, not a directive.
        const scoped = significant("SELECT x::y");
        expect(scoped.some((t) => t.kind === TokenKind.SqlCmdDirective)).to.equal(false);
    });

    test("tokenIndexAt finds the covering token and clamps", () => {
        const text = "SELECT [a] FROM t";
        const { tokens } = lex(text);
        const at = tokenIndexAt(tokens, text.indexOf("[a]") + 1);
        expect(tokens[at].kind).to.equal(TokenKind.BracketedIdentifier);
        expect(tokens[tokenIndexAt(tokens, 9999)].kind).to.equal(TokenKind.EndOfFile);
    });
});

const PARITY_CORPUS: string[] = [
    "SELECT 1\nGO\nSELECT 2",
    "SELECT 1\nGO 3\nSELECT 2\nGO",
    "SELECT 1;\n  go  \nSELECT 2",
    "SELECT 1\nGO -- trailing comment\nSELECT 2",
    "SELECT 1\nGO abc\nSELECT 2", // not a separator
    "SELECT 'text\nGO\nmore' \nGO\nSELECT 2", // GO inside a string is content
    "/* comment\nGO\nstill comment */\nSELECT 1\nGO",
    "SELECT [bracket\nGO\nname] FROM t", // GO inside a bracketed identifier
    "GO\nGO\nSELECT 1", // empty batches are dropped by both
    "  GO 0\nSELECT 1", // splitter clamps count to 1
    "SELECT 1\nGO 2 -- twice\n\n\nSELECT 2\nGO 10",
    "-- only a comment\nGO\nSELECT 1",
];

suite("sqlLanguage segmenter", () => {
    test("EXECUTION-SPLITTER PARITY: batch count, repeat counts, first lines", () => {
        for (const text of PARITY_CORPUS) {
            const splitter = splitBatches(text);
            // splitBatches expands GO n into n entries; group to unique batches.
            const unique: { startLine: number; repeatTotal: number }[] = [];
            for (const b of splitter) {
                if (b.repeatOrdinal === 0) {
                    unique.push({ startLine: b.startLine, repeatTotal: b.repeatTotal });
                }
            }
            const snapshot = new TextSnapshot(text);
            const { tokens } = lex(text);
            const ours = segment(text, tokens).batches;

            expect(ours.length, `batch count for: ${JSON.stringify(text)}`).to.equal(unique.length);
            for (let i = 0; i < ours.length; i++) {
                expect(
                    ours[i].repeatCount,
                    `repeat count [${i}] for: ${JSON.stringify(text)}`,
                ).to.equal(unique[i].repeatTotal);
                expect(
                    snapshot.positionAt(ours[i].start).line,
                    `start line [${i}] for: ${JSON.stringify(text)}`,
                ).to.equal(unique[i].startLine);
            }
        }
    });

    test("statements: semicolons and reserved statement-start keywords split", () => {
        const text = "SELECT 1; SELECT 2 SELECT 3\nDECLARE @x int SET @x = 1";
        const { tokens } = lex(text);
        const statements = segment(text, tokens).batches[0].statements;
        expect(statements.map((s) => s.leadingWord)).to.deep.equal([
            "SELECT",
            "SELECT",
            "SELECT",
            "DECLARE",
            "SET",
        ]);
    });

    test("statements: UNION/subquery/CASE do not split; unreserved words never split", () => {
        const union = "SELECT 1 UNION ALL SELECT 2 UNION SELECT 3";
        expect(segment(union, lex(union).tokens).batches[0].statements).to.have.length(1);

        const sub = "SELECT * FROM (SELECT 1 AS x) d WHERE EXISTS (SELECT 1)";
        expect(segment(sub, lex(sub).tokens).batches[0].statements).to.have.length(1);

        const kase = "SELECT CASE WHEN 1=1 THEN 2 ELSE 3 END, x FROM t";
        expect(segment(kase, lex(kase).tokens).batches[0].statements).to.have.length(1);

        const goColumn = "SELECT go FROM t"; // go is unreserved
        expect(segment(goColumn, lex(goColumn).tokens).batches[0].statements).to.have.length(1);
    });

    test("module body: CREATE PROCEDURE ... AS splits header and body statements", () => {
        const text = "CREATE PROCEDURE dbo.P @id int AS SELECT 1 SELECT 2";
        const statements = segment(text, lex(text).tokens).batches[0].statements;
        expect(statements).to.have.length(3);
        expect(statements[0].leadingWord).to.equal("CREATE");
        expect(statements[1].inModuleBody).to.equal(true);
        expect(statements[2].inModuleBody).to.equal(true);
    });

    test("END TRY / END CATCH stay attached to their block statement", () => {
        const text = "BEGIN TRY\nSELECT 1\nEND TRY\nBEGIN CATCH\nSELECT 2\nEND CATCH";
        const statements = segment(text, lex(text).tokens).batches[0].statements;
        // Tolerant v1: no statement may begin with a dangling TRY/CATCH word.
        for (const s of statements) {
            expect(s.leadingWord).to.not.equal("TRY");
            expect(s.leadingWord).to.not.equal("CATCH");
        }
    });
});

class ScriptedEngine implements SqlLanguageFeatureEngine {
    readonly engineId = "nativeTypeScript" as const;
    completionCalls = 0;
    constructor(private readonly behavior: "ok" | "throw") {}
    completion(): Promise<CompletionResult | undefined> {
        this.completionCalls++;
        if (this.behavior === "throw") {
            return Promise.reject(new Error("scripted native failure"));
        }
        return Promise.resolve({ items: [], isIncomplete: false });
    }
    hover(): Promise<undefined> {
        return Promise.resolve(undefined);
    }
    signatureHelp(): Promise<undefined> {
        return Promise.resolve(undefined);
    }
    diagnostics(): Promise<undefined> {
        return Promise.resolve(undefined);
    }
    definition(): Promise<undefined> {
        return Promise.resolve(undefined);
    }
    folding(): Promise<undefined> {
        return Promise.resolve(undefined);
    }
    documentSymbols(): Promise<undefined> {
        return Promise.resolve(undefined);
    }
    highlights(): Promise<undefined> {
        return Promise.resolve(undefined);
    }
    semanticTokens(): Promise<undefined> {
        return Promise.resolve(undefined);
    }
}

suite("sqlLanguage router", () => {
    const request = {
        text: "SELECT 1",
        version: 1,
        position: { line: 0, character: 0 },
        trigger: "invoke" as const,
    };

    test("sqlToolsService preference routes native ONLY for structure features", async () => {
        const native = new NativeSqlLanguageEngine(new NullLanguageMetadataProvider());
        const router = new LanguageFeatureRouter({
            native,
            getBridge: () => undefined,
            getPreference: () => "sqlToolsService",
        });
        expect(router.effectiveEngine("folding")).to.equal("nativeTypeScript");
        expect(router.effectiveEngine("completion")).to.equal("sqlToolsServiceBridge");
        // No bridge constructed -> completion is unserved but does not throw.
        const result = await router.route("completion", (e) => e.completion(request));
        expect(result).to.equal(undefined);
    });

    test("nativeTypeScript preference + maturity gate routes eligible features", async () => {
        const scripted = new ScriptedEngine("ok");
        const router = new LanguageFeatureRouter({
            native: scripted,
            getBridge: () => undefined,
            getPreference: () => "nativeTypeScript",
            capabilities: {
                completion: "preview",
                hover: "off",
                signatureHelp: "off",
                diagnostics: "off",
                definition: "off",
                folding: "preview",
                documentSymbols: "preview",
                highlights: "off",
                semanticTokens: "off",
            },
        });
        expect(router.effectiveEngine("completion")).to.equal("nativeTypeScript");
        expect(router.effectiveEngine("hover")).to.equal("sqlToolsServiceBridge");
        const result = await router.route("completion", (e) => e.completion(request));
        expect(result).to.deep.equal({ items: [], isIncomplete: false });
        expect(scripted.completionCalls).to.equal(1);
    });

    test("circuit breaker: repeated native failures fall back and stick", async () => {
        const scripted = new ScriptedEngine("throw");
        const router = new LanguageFeatureRouter({
            native: scripted,
            getBridge: () => undefined,
            getPreference: () => "nativeTypeScript",
            capabilities: {
                completion: "preview",
                hover: "off",
                signatureHelp: "off",
                diagnostics: "off",
                definition: "off",
                folding: "off",
                documentSymbols: "off",
                highlights: "off",
                semanticTokens: "off",
            },
            breakAfterFailures: 2,
        });
        expect(await router.route("completion", (e) => e.completion(request))).to.equal(undefined);
        expect(await router.route("completion", (e) => e.completion(request))).to.equal(undefined);
        // Circuit now open: native is no longer called.
        expect(router.effectiveEngine("completion")).to.equal("sqlToolsServiceBridge");
        await router.route("completion", (e) => e.completion(request));
        expect(scripted.completionCalls).to.equal(2);
        const status = router.status().find((s) => s.feature === "completion");
        expect(status?.circuitBroken).to.equal(true);
        router.resetCircuits();
        expect(router.effectiveEngine("completion")).to.equal("nativeTypeScript");
    });
});

suite("sqlLanguage LS-0 native features", () => {
    const engine = new NativeSqlLanguageEngine(
        new FixtureLanguageMetadataProvider({ objects: [] }),
    );

    test("folding: batches, block comments, regions", async () => {
        const text = [
            "--#region setup",
            "SELECT 1,",
            "       2",
            "GO",
            "/* multi",
            "   line */",
            "SELECT 3",
            "--#endregion",
        ].join("\n");
        const ranges = await engine.folding({ text, version: 1 });
        expect(ranges).to.not.equal(undefined);
        const kinds = ranges!.map((r) => r.kind ?? "code");
        expect(kinds).to.include("comment");
        expect(kinds).to.include("region");
        // The multi-line SELECT statement folds.
        expect(ranges!.some((r) => r.startLine === 1 && r.endLine === 2)).to.equal(true);
    });

    test("document symbols: batches with statements, CREATE object names", async () => {
        const text = "SELECT 1\nGO\nCREATE PROCEDURE dbo.GetOrders AS SELECT 2";
        const symbols = await engine.documentSymbols({ text, version: 2 });
        expect(symbols).to.not.equal(undefined);
        expect(symbols![0].name).to.equal("Batch 1");
        const batch2 = symbols![1];
        expect(batch2.children!.some((c) => c.name === "CREATE PROCEDURE dbo.GetOrders")).to.equal(
            true,
        );
    });

    test("no schema claims in LS-0: completion/hover/diagnostics are unserved", async () => {
        expect(
            await engine.completion({
                text: "SELECT ",
                version: 3,
                position: { line: 0, character: 7 },
                trigger: "invoke",
            }),
        ).to.equal(undefined);
        expect(await engine.diagnostics({ text: "SELECT", version: 4 })).to.equal(undefined);
    });
});
