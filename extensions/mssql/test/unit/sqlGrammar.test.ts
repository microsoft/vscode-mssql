/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import * as plist from "plist";
import { INITIAL, type IGrammar, type IToken, parseRawGrammar, Registry } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";

interface GrammarPattern {
    name?: string;
    match?: string;
    begin?: string;
    end?: string;
    applyEndPatternLast?: number;
    patterns?: GrammarPattern[];
}

interface SqlGrammar {
    patterns?: GrammarPattern[];
}

interface SqlGrammarContribution {
    language?: string;
    scopeName?: string;
    unbalancedBracketScopes?: string[];
}

interface SqlPackageManifest {
    contributes?: {
        grammars?: SqlGrammarContribution[];
    };
}

// Regression coverage for https://github.com/microsoft/azuredatastudio/issues/4630
const databaseNameWithEscapedClosingBrackets =
    "[Verify_Hierarchy_Baseline_Sqlv150'']]]]]]'{a15a7e31-47ab-48f4-a380-42279406d3ed}]";

const schemaNameWithEscapedClosingBrackets = "[]]]]]]]]dbo[[[]";

const alternateSchemaNameWithEscapedClosingBrackets = "[[[]]]]]]]]]]dbo[[[]";

const externalTableNameWithEscapedClosingBrackets = "[test[table]]]";

let textMateGrammarPromise: Promise<IGrammar> | undefined;

function getSqlGrammarPath(): string {
    return path.join(__dirname, "..", "..", "..", "syntaxes", "SQL.plist");
}

function getSqlPackagePath(): string {
    return path.join(__dirname, "..", "..", "..", "package.json");
}

function getSqlGrammar(): SqlGrammar {
    return plist.parse(fs.readFileSync(getSqlGrammarPath(), "utf8")) as SqlGrammar;
}

function getSqlPackageManifest(): SqlPackageManifest {
    return JSON.parse(fs.readFileSync(getSqlPackagePath(), "utf8")) as SqlPackageManifest;
}

function getBracketedIdentifierPattern(): GrammarPattern {
    const grammar = getSqlGrammar();
    const bracketedIdentifierPattern = grammar.patterns?.find(
        (pattern) => pattern.name === "text.bracketed",
    );

    expect(bracketedIdentifierPattern, "Expected SQL grammar bracketed identifier rule").to.not.be
        .undefined;

    return bracketedIdentifierPattern!;
}

function getSqlGrammarContribution(): SqlGrammarContribution {
    const manifest = getSqlPackageManifest();
    const sqlGrammarContribution = manifest.contributes?.grammars?.find(
        (grammar) => grammar.language === "sql" && grammar.scopeName === "source.sql",
    );

    expect(sqlGrammarContribution, "Expected SQL grammar contribution in package.json").to.not.be
        .undefined;

    return sqlGrammarContribution!;
}

function getArrayBuffer(filePath: string): ArrayBuffer {
    const buffer = fs.readFileSync(filePath);

    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function getTextMateGrammar(): Promise<IGrammar> {
    textMateGrammarPromise ??= (async () => {
        await loadWASM(getArrayBuffer(require.resolve("vscode-oniguruma/release/onig.wasm")));

        const grammarPath = getSqlGrammarPath();
        const rawGrammar = fs.readFileSync(grammarPath, "utf8");
        const registry = new Registry({
            onigLib: Promise.resolve({
                createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
                createOnigString: (value: string) => new OnigString(value),
            }),
            loadGrammar: async (scopeName: string) =>
                scopeName === "source.sql" ? parseRawGrammar(rawGrammar, grammarPath) : undefined,
        });
        const grammar = await registry.loadGrammar("source.sql");

        expect(grammar, "Expected SQL TextMate grammar").to.not.be.null;

        return grammar!;
    })();

    return textMateGrammarPromise;
}

async function tokenizeLines(lines: string[]): Promise<IToken[][]> {
    const grammar = await getTextMateGrammar();
    const tokensByLine: IToken[][] = [];
    let ruleStack = INITIAL;

    for (const line of lines) {
        const result = grammar.tokenizeLine(line, ruleStack);

        tokensByLine.push(result.tokens);
        ruleStack = result.ruleStack;
    }

    return tokensByLine;
}

function getTokenText(line: string, token: IToken): string {
    return line.slice(token.startIndex, token.endIndex);
}

function findToken(line: string, tokens: IToken[], text: string): IToken | undefined {
    return tokens.find((token) => getTokenText(line, token) === text);
}

function findTokenAtOffset(tokens: IToken[], offset: number): IToken | undefined {
    return tokens.find((token) => token.startIndex <= offset && offset < token.endIndex);
}

suite("SQL Grammar Tests", () => {
    suite("Grammar definition", () => {
        test("defines bracketed identifiers with escaped bracket handling for bracket pair colorization", () => {
            const bracketedIdentifierPattern = getBracketedIdentifierPattern();
            const sqlGrammarContribution = getSqlGrammarContribution();

            expect(bracketedIdentifierPattern.begin).to.equal("\\[");
            expect(bracketedIdentifierPattern.end).to.equal("\\]");
            expect(bracketedIdentifierPattern.applyEndPatternLast).to.equal(1);
            expect(bracketedIdentifierPattern.patterns).to.deep.include({
                match: "\\[|\\]\\]",
                name: "constant.character.bracket.sql",
            });
            expect(sqlGrammarContribution.unbalancedBracketScopes).to.include(
                "constant.character.bracket.sql",
            );
        });
    });

    suite("Bracketed identifiers", () => {
        [
            {
                label: "a simple bracketed identifier",
                identifier: "[MyDatabase]",
            },
            {
                label: "escaped closing brackets inside a single identifier",
                identifier: "[c[o]]l1]",
            },
            {
                label: "a database name with escaped closing brackets",
                identifier: databaseNameWithEscapedClosingBrackets,
            },
            {
                label: "a schema name with escaped closing brackets",
                identifier: schemaNameWithEscapedClosingBrackets,
            },
            {
                label: "an alternate schema name with escaped closing brackets",
                identifier: alternateSchemaNameWithEscapedClosingBrackets,
            },
            {
                label: "an external table name with escaped closing brackets",
                identifier: externalTableNameWithEscapedClosingBrackets,
            },
        ].forEach(({ label, identifier }) =>
            test(`tokenizes ${label}`, async () => {
                const [tokens] = await tokenizeLines([identifier]);
                const openingBracketToken = findTokenAtOffset(tokens, 0);
                const closingBracketToken = findTokenAtOffset(tokens, identifier.length - 1);

                expect(openingBracketToken?.scopes).to.include(
                    "punctuation.definition.bracket.begin.sql",
                );
                expect(closingBracketToken?.scopes).to.include(
                    "punctuation.definition.bracket.end.sql",
                );
            }),
        );

        test("marks literal bracket characters inside bracketed identifiers so bracket pair colorization ignores them", async () => {
            const identifier = "[c[o]]l1]";
            const [tokens] = await tokenizeLines([identifier]);
            const literalOpeningBracketToken = findTokenAtOffset(
                tokens,
                identifier.indexOf("[", 1),
            );
            const escapedClosingBracketToken = findTokenAtOffset(tokens, identifier.indexOf("]]"));

            expect(literalOpeningBracketToken?.scopes).to.include("constant.character.bracket.sql");
            expect(escapedClosingBracketToken?.scopes).to.include("constant.character.bracket.sql");
        });
    });

    suite("TextMate tokenization", () => {
        test("keeps later SQL keywords tokenized after a USE statement with escaped closing brackets", async () => {
            const useLine = `USE ${databaseNameWithEscapedClosingBrackets};`;
            const createLine = "CREATE DATABASE SCOPED CREDENTIAL [sa]";
            const [useTokens, createTokens] = await tokenizeLines([useLine, createLine]);
            const databaseNameStart = useLine.indexOf(databaseNameWithEscapedClosingBrackets);
            const databaseNameEnd =
                databaseNameStart + databaseNameWithEscapedClosingBrackets.length - 1;

            const databaseNameOpeningToken = findTokenAtOffset(useTokens, databaseNameStart);
            const databaseNameClosingToken = findTokenAtOffset(useTokens, databaseNameEnd);
            const createToken = findToken(createLine, createTokens, "CREATE");

            expect(databaseNameOpeningToken?.scopes).to.include(
                "punctuation.definition.bracket.begin.sql",
            );
            expect(databaseNameClosingToken?.scopes).to.include(
                "punctuation.definition.bracket.end.sql",
            );
            expect(createToken?.scopes).to.include("keyword.other.create.sql");
            expect(createToken?.scopes).to.not.include("string.quoted.single.sql");
        });

        test("tokenizes external table identifiers with escaped closing brackets as bracketed identifiers", async () => {
            const line = `CREATE EXTERNAL TABLE ${schemaNameWithEscapedClosingBrackets}.${externalTableNameWithEscapedClosingBrackets}`;
            const [tokens] = await tokenizeLines([line]);
            const schemaStart = line.indexOf(schemaNameWithEscapedClosingBrackets);
            const schemaEnd = schemaStart + schemaNameWithEscapedClosingBrackets.length - 1;
            const tableStart = line.indexOf(externalTableNameWithEscapedClosingBrackets);
            const tableEnd = tableStart + externalTableNameWithEscapedClosingBrackets.length - 1;

            const schemaOpeningToken = findTokenAtOffset(tokens, schemaStart);
            const schemaClosingToken = findTokenAtOffset(tokens, schemaEnd);
            const tableOpeningToken = findTokenAtOffset(tokens, tableStart);
            const tableClosingToken = findTokenAtOffset(tokens, tableEnd);

            expect(schemaOpeningToken?.scopes).to.include(
                "punctuation.definition.bracket.begin.sql",
            );
            expect(schemaClosingToken?.scopes).to.include("punctuation.definition.bracket.end.sql");
            expect(tableOpeningToken?.scopes).to.include(
                "punctuation.definition.bracket.begin.sql",
            );
            expect(tableClosingToken?.scopes).to.include("punctuation.definition.bracket.end.sql");
        });

        test("tokenizes a bracketed column identifier with escaped closing brackets and the following type", async () => {
            const line = "[c[o]]l1] INT";
            const [tokens] = await tokenizeLines([line]);
            const columnStart = 0;
            const columnEnd = line.indexOf(" INT") - 1;

            const columnOpeningToken = findTokenAtOffset(tokens, columnStart);
            const columnClosingToken = findTokenAtOffset(tokens, columnEnd);
            const typeToken = findToken(line, tokens, "INT");

            expect(columnOpeningToken?.scopes).to.include(
                "punctuation.definition.bracket.begin.sql",
            );
            expect(columnClosingToken?.scopes).to.include("punctuation.definition.bracket.end.sql");
            expect(typeToken?.scopes).to.include("storage.type.sql");
        });

        test("keeps VALUES parentheses outside string literals in transaction logging statements", async () => {
            // Regression coverage for https://github.com/microsoft/azuredatastudio/issues/4630
            const lines = [
                "if @error_count = 0",
                "begin",
                "    COMMIT TRANSACTION @tran_name;",
                "    insert into ##LOGS values('Processo finalizado com sucesso!');",
                "end",
                "else",
                "begin",
                "    insert into ##LOGS values('Encontrado erros durante a atualização :(');",
                "end;",
            ];
            const tokensByLine = await tokenizeLines(lines);
            const successLine = lines[3];
            const failureLine = lines[7];
            const successTokens = tokensByLine[3];
            const failureTokens = tokensByLine[7];
            const successValuesParenOffset = successLine.indexOf(
                "(",
                successLine.indexOf("values"),
            );
            const failureValuesParenOffset = failureLine.indexOf(
                "(",
                failureLine.indexOf("values"),
            );
            const successOpeningQuoteOffset = successValuesParenOffset + 1;
            const failureOpeningQuoteOffset = failureValuesParenOffset + 1;

            const successValuesParenToken = findTokenAtOffset(
                successTokens,
                successValuesParenOffset,
            );
            const failureValuesParenToken = findTokenAtOffset(
                failureTokens,
                failureValuesParenOffset,
            );
            const successOpeningQuoteToken = findTokenAtOffset(
                successTokens,
                successOpeningQuoteOffset,
            );
            const failureOpeningQuoteToken = findTokenAtOffset(
                failureTokens,
                failureOpeningQuoteOffset,
            );

            expect(successValuesParenToken).to.not.be.undefined;
            expect(failureValuesParenToken).to.not.be.undefined;
            expect(successValuesParenToken?.scopes).to.not.include("string.quoted.single.sql");
            expect(failureValuesParenToken?.scopes).to.not.include("string.quoted.single.sql");
            expect(successOpeningQuoteToken?.scopes).to.include("string.quoted.single.sql");
            expect(successOpeningQuoteToken?.scopes).to.include(
                "punctuation.definition.string.begin.sql",
            );
            expect(failureOpeningQuoteToken?.scopes).to.include("string.quoted.single.sql");
            expect(failureOpeningQuoteToken?.scopes).to.include(
                "punctuation.definition.string.begin.sql",
            );
        });

        test("keeps the sad-face parenthesis inside the quoted string", async () => {
            const line =
                "    insert into ##LOGS values('Encontrado erros durante a atualização :(');";
            const [tokens] = await tokenizeLines([line]);
            const sadFaceParenOffset = line.lastIndexOf("(");
            const closingQuoteOffset = line.lastIndexOf("'");
            const closingValuesParenOffset = line.lastIndexOf(")");

            const sadFaceParenToken = findTokenAtOffset(tokens, sadFaceParenOffset);
            const closingQuoteToken = findTokenAtOffset(tokens, closingQuoteOffset);
            const closingValuesParenToken = findTokenAtOffset(tokens, closingValuesParenOffset);

            expect(sadFaceParenToken).to.not.be.undefined;
            expect(sadFaceParenToken?.scopes).to.include("string.quoted.single.sql");
            expect(closingQuoteToken?.scopes).to.include("punctuation.definition.string.end.sql");
            expect(closingValuesParenToken?.scopes).to.not.include("string.quoted.single.sql");
        });
    });
});
