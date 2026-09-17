/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B11 / LS-3 native signature-help suite (design 05 §12.2): curated builtins
 * from the data asset (overloads, optional parameters, reserved-word
 * builtins), user routines from pinned metadata, active-parameter rules
 * (comma index within the call's paren span; EXEC named arguments win over
 * position), and the honesty ladder — empty whenever the callee cannot be
 * bound (unknown routines, parameters not ready, dynamic EXEC, USE-switched
 * statements, strings/comments).
 */

import { expect } from "chai";
import { SignatureHelpResult } from "../../src/sqlLanguage/api";
import { NativeSqlLanguageEngine } from "../../src/sqlLanguage/host/nativeEngine";
import {
    FixtureCatalogSpec,
    FixtureLanguageMetadataProvider,
} from "../../src/sqlLanguage/provider/fixtureProvider";
import { NullLanguageMetadataProvider } from "../../src/sqlLanguage/provider/nullProvider";
import { ISqlLanguageMetadataProvider } from "../../src/sqlLanguage/provider/types";
import { TextSnapshot } from "../../src/sqlLanguage/core/text/textSnapshot";
import { parseFourslash } from "../../src/sqlLanguage/testSupport/fourslash";
import { STANDARD_FIXTURE_CATALOG } from "../../src/sqlLanguage/testSupport/fixtureCatalog";

/** Standard catalog + a scalar function and a two-parameter function. */
const ROUTINE_CATALOG: FixtureCatalogSpec = {
    ...STANDARD_FIXTURE_CATALOG,
    objects: [
        ...STANDARD_FIXTURE_CATALOG.objects,
        {
            schema: "dbo",
            name: "OrderCount",
            kind: "scalarFunction",
            parameters: [
                { ordinal: 0, name: "", typeDisplay: "int", isOutput: false },
                { ordinal: 1, name: "@CustomerID", typeDisplay: "int", isOutput: false },
            ],
        },
        {
            schema: "dbo",
            name: "Calc",
            kind: "scalarFunction",
            parameters: [
                { ordinal: 0, name: "", typeDisplay: "money", isOutput: false },
                { ordinal: 1, name: "@a", typeDisplay: "int", isOutput: false },
                { ordinal: 2, name: "@b", typeDisplay: "money", isOutput: false },
            ],
        },
    ],
};

const standardProvider = new FixtureLanguageMetadataProvider(ROUTINE_CATALOG);

async function signature(
    source: string,
    provider: ISqlLanguageMetadataProvider = standardProvider,
): Promise<SignatureHelpResult | undefined> {
    const fixture = parseFourslash(source);
    if (fixture.caret === undefined) {
        throw new Error("fixture needs /*caret*/");
    }
    const engine = new NativeSqlLanguageEngine(provider);
    const snapshot = new TextSnapshot(fixture.text, 1);
    return engine.signatureHelp({
        text: fixture.text,
        version: 1,
        position: snapshot.positionAt(fixture.caret),
    });
}

async function expectHelp(
    source: string,
    provider: ISqlLanguageMetadataProvider = standardProvider,
): Promise<SignatureHelpResult> {
    const result = await signature(source, provider);
    expect(result, "expected signature help").to.not.equal(undefined);
    return result!;
}

suite("sqlLanguage native signature help: builtins", () => {
    test("open paren: signature label, parameters, active 0", async () => {
        const help = await expectHelp("SELECT SUBSTRING(/*caret*/");
        expect(help.signatures).to.have.length(1);
        expect(help.signatures[0].label).to.contain("SUBSTRING(expression, start, length)");
        expect(help.signatures[0].parameters.map((p) => p.label)).to.deep.equal([
            "expression",
            "start",
            "length",
        ]);
        expect(help.activeParameter).to.equal(0);
        expect(help.activeSignature).to.equal(0);
    });

    test("after the first comma the second parameter is active", async () => {
        const help = await expectHelp("SELECT SUBSTRING(Comments, /*caret*/");
        expect(help.activeParameter).to.equal(1);
    });

    test("after the second comma the third parameter is active", async () => {
        const help = await expectHelp("SELECT SUBSTRING(Comments, 1, /*caret*/");
        expect(help.activeParameter).to.equal(2);
    });

    test("with a typed argument before the caret the index holds", async () => {
        const help = await expectHelp("SELECT SUBSTRING(Comments, 1/*caret*/");
        expect(help.activeParameter).to.equal(1);
    });

    test("inside a closed argument list segment", async () => {
        const help = await expectHelp(
            "SELECT SUBSTRING(Comments, 1, 2/*caret*/) FROM Sales.Orders",
        );
        expect(help.activeParameter).to.equal(2);
    });

    test("label carries the return type", async () => {
        const help = await expectHelp("SELECT SUBSTRING(/*caret*/");
        expect(help.signatures[0].label).to.contain("→ same as input");
    });

    test("documentation carries the curated description", async () => {
        const help = await expectHelp("SELECT SUBSTRING(/*caret*/");
        expect(help.signatures[0].documentation).to.contain("Returns part of a character");
    });

    test("optional parameters are marked in their documentation", async () => {
        const help = await expectHelp("SELECT ROUND(1.5, /*caret*/");
        const optional = help.signatures[0].parameters[2];
        expect(optional.label).to.equal("function");
        expect(optional.documentation).to.contain("(optional)");
    });

    test("case-insensitive builtin lookup", async () => {
        const help = await expectHelp("select substring(/*caret*/");
        expect(help.signatures[0].label).to.contain("SUBSTRING");
    });

    test("reserved-word builtins (LEFT) still produce help", async () => {
        const help = await expectHelp("SELECT LEFT(Comments, /*caret*/");
        expect(help.signatures[0].label).to.contain("LEFT(character_expression");
        expect(help.activeParameter).to.equal(1);
    });

    test("reserved-word builtins (COALESCE) still produce help", async () => {
        const help = await expectHelp("SELECT COALESCE(a, /*caret*/");
        expect(help.signatures[0].label).to.contain("COALESCE(");
        expect(help.activeParameter).to.equal(1);
    });

    test("COUNT overloads: both signatures returned", async () => {
        const help = await expectHelp("SELECT COUNT(/*caret*/");
        expect(help.signatures).to.have.length(2);
    });

    test("COUNT overloads: active signature prefers one with a parameter", async () => {
        const help = await expectHelp("SELECT COUNT(/*caret*/");
        // COUNT(*) has zero parameters; the expression overload can host the caret.
        expect(help.signatures[help.activeSignature].parameters.length).to.be.greaterThan(0);
    });

    test("DATEADD three-parameter shape", async () => {
        const help = await expectHelp("SELECT DATEADD(day, 1, /*caret*/");
        expect(help.signatures[0].parameters).to.have.length(3);
        expect(help.activeParameter).to.equal(2);
    });

    test("zero-parameter builtins report no parameters", async () => {
        const help = await expectHelp("SELECT GETDATE(/*caret*/");
        expect(help.signatures[0].parameters).to.have.length(0);
        expect(help.activeParameter).to.equal(0);
    });

    test("more commas than parameters: index passes the end (no highlight)", async () => {
        const help = await expectHelp("SELECT SUBSTRING(a, b, c, /*caret*/");
        expect(help.activeParameter).to.equal(3);
    });

    test("builtins work with an offline provider (local data asset)", async () => {
        const help = await expectHelp(
            "SELECT SUBSTRING(x, /*caret*/",
            new NullLanguageMetadataProvider(),
        );
        expect(help.activeParameter).to.equal(1);
    });

    test("unknown function name: honest empty", async () => {
        expect(await signature("SELECT NOTAFUNC(/*caret*/")).to.equal(undefined);
    });
});

suite("sqlLanguage native signature help: nesting and grouping", () => {
    test("nested call: the innermost callee wins", async () => {
        const help = await expectHelp("SELECT SUBSTRING(LEFT(Comments, /*caret*/");
        expect(help.signatures[0].label).to.contain("LEFT(");
        expect(help.activeParameter).to.equal(1);
    });

    test("after a closed nested call the outer callee resumes", async () => {
        const help = await expectHelp("SELECT SUBSTRING(LEFT(Comments, 2), /*caret*/");
        expect(help.signatures[0].label).to.contain("SUBSTRING(");
        expect(help.activeParameter).to.equal(1);
    });

    test("balanced parens inside arguments do not shift the comma count", async () => {
        const help = await expectHelp("SELECT SUBSTRING(ROUND(1, 2), (3 + 4), /*caret*/");
        expect(help.signatures[0].label).to.contain("SUBSTRING(");
        expect(help.activeParameter).to.equal(2);
    });

    test("grouping parens are not treated as calls", async () => {
        const help = await expectHelp("SELECT SUBSTRING((1 + 2), /*caret*/");
        expect(help.signatures[0].label).to.contain("SUBSTRING(");
        expect(help.activeParameter).to.equal(1);
    });

    test("caret inside a grouping paren binds to the enclosing call", async () => {
        const help = await expectHelp("SELECT SUBSTRING(Comments, (1 + /*caret*/");
        expect(help.signatures[0].label).to.contain("SUBSTRING(");
        expect(help.activeParameter).to.equal(1);
    });

    test("commas inside a grouping paren do not leak into the outer count", async () => {
        const help = await expectHelp("SELECT DATEADD(day, (CHOOSE(1, 2, /*caret*/");
        // The innermost callee is CHOOSE; its own commas set the index.
        expect(help.signatures[0].label).to.contain("CHOOSE(");
        expect(help.activeParameter).to.equal(2);
    });

    test("WHERE-clause grouping paren alone produces nothing", async () => {
        expect(await signature("SELECT 1 FROM Sales.Orders WHERE (OrderID = /*caret*/")).to.equal(
            undefined,
        );
    });

    test("closed call before the caret produces nothing", async () => {
        expect(await signature("SELECT * FROM dbo.OrdersByCustomer(1) /*caret*/")).to.equal(
            undefined,
        );
    });
});

suite("sqlLanguage native signature help: user routines (call form)", () => {
    test("table function: parameters from metadata", async () => {
        const help = await expectHelp("SELECT * FROM dbo.OrdersByCustomer(/*caret*/");
        expect(help.signatures).to.have.length(1);
        expect(help.signatures[0].label).to.contain("dbo.OrdersByCustomer(@CustomerID int)");
        expect(help.signatures[0].parameters.map((p) => p.label)).to.deep.equal([
            "@CustomerID int",
        ]);
        expect(help.activeParameter).to.equal(0);
    });

    test("scalar function: label carries the return type", async () => {
        const help = await expectHelp("SELECT dbo.OrderCount(/*caret*/");
        expect(help.signatures[0].label).to.contain("→ int");
    });

    test("two-parameter function: comma advances the active parameter", async () => {
        const help = await expectHelp("SELECT dbo.Calc(1, /*caret*/");
        expect(help.signatures[0].parameters.map((p) => p.label)).to.deep.equal([
            "@a int",
            "@b money",
        ]);
        expect(help.activeParameter).to.equal(1);
    });

    test("unqualified function names resolve via the default schema", async () => {
        const help = await expectHelp("SELECT Calc(/*caret*/");
        expect(help.signatures[0].label).to.contain("dbo.Calc(");
    });

    test("nested user function inside a builtin wins as innermost", async () => {
        const help = await expectHelp("SELECT ROUND(dbo.Calc(1, /*caret*/");
        expect(help.signatures[0].label).to.contain("dbo.Calc(");
        expect(help.activeParameter).to.equal(1);
    });

    test("unknown routine: honest empty", async () => {
        expect(await signature("SELECT dbo.NoSuchFn(/*caret*/")).to.equal(undefined);
    });

    test("tables are not callees", async () => {
        expect(await signature("SELECT Sales.Orders(/*caret*/")).to.equal(undefined);
    });

    test("parameters loading: honest empty for user routines", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...ROUTINE_CATALOG,
            readiness: { parameters: "loading" },
        });
        expect(await signature("SELECT dbo.Calc(/*caret*/", provider)).to.equal(undefined);
    });

    test("objects loading: honest empty for user routines", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...ROUTINE_CATALOG,
            readiness: { objects: "loading" },
        });
        expect(await signature("SELECT dbo.Calc(/*caret*/", provider)).to.equal(undefined);
    });

    test("offline provider: honest empty for user routines", async () => {
        expect(
            await signature("SELECT dbo.Calc(/*caret*/", new NullLanguageMetadataProvider()),
        ).to.equal(undefined);
    });
});

suite("sqlLanguage native signature help: EXEC procedures", () => {
    test("after the procedure name: full signature, active 0", async () => {
        const help = await expectHelp("EXEC Sales.GetOrders /*caret*/");
        expect(help.signatures).to.have.length(1);
        expect(help.signatures[0].label).to.contain("Sales.GetOrders");
        expect(help.signatures[0].label).to.contain("@CustomerID int");
        expect(help.signatures[0].label).to.contain("@Since datetime2(7)");
        expect(help.signatures[0].label).to.contain("@Total money OUTPUT");
        expect(help.activeParameter).to.equal(0);
    });

    test("parameter labels include the OUTPUT badge", async () => {
        const help = await expectHelp("EXEC Sales.GetOrders /*caret*/");
        expect(help.signatures[0].parameters.map((p) => p.label)).to.deep.equal([
            "@CustomerID int",
            "@Since datetime2(7)",
            "@Total money OUTPUT",
        ]);
    });

    test("positional: first comma advances to the second parameter", async () => {
        const help = await expectHelp("EXEC Sales.GetOrders 1, /*caret*/");
        expect(help.activeParameter).to.equal(1);
    });

    test("positional: second comma advances to the third parameter", async () => {
        const help = await expectHelp("EXEC Sales.GetOrders 1, '2026-01-01', /*caret*/");
        expect(help.activeParameter).to.equal(2);
    });

    test("named argument resolution wins over the segment index", async () => {
        const help = await expectHelp("EXEC Sales.GetOrders @Total = /*caret*/");
        expect(help.activeParameter).to.equal(2);
    });

    test("named argument out of positional order still resolves by name", async () => {
        const help = await expectHelp(
            "EXEC Sales.GetOrders @Since = '2026', @CustomerID = /*caret*/",
        );
        expect(help.activeParameter).to.equal(0);
    });

    test("named then next segment falls back to the segment index", async () => {
        const help = await expectHelp("EXEC Sales.GetOrders @CustomerID = 1, /*caret*/");
        expect(help.activeParameter).to.equal(1);
    });

    test("commas inside parenthesized argument values do not miscount", async () => {
        const help = await expectHelp(
            "EXEC Sales.GetOrders @CustomerID = COALESCE(1, 2), /*caret*/",
        );
        expect(help.signatures[0].label).to.contain("Sales.GetOrders");
        expect(help.activeParameter).to.equal(1);
    });

    test("caret inside a builtin call within an EXEC argument binds to the builtin", async () => {
        const help = await expectHelp("EXEC Sales.GetOrders @CustomerID = COALESCE(1, /*caret*/");
        expect(help.signatures[0].label).to.contain("COALESCE(");
        expect(help.activeParameter).to.equal(1);
    });

    test("EXEC @return = proc form still resolves the procedure", async () => {
        const help = await expectHelp("DECLARE @rc int\nEXEC @rc = Sales.GetOrders /*caret*/");
        expect(help.signatures[0].label).to.contain("Sales.GetOrders");
    });

    test("EXECUTE spelling works", async () => {
        const help = await expectHelp("EXECUTE Sales.GetOrders /*caret*/");
        expect(help.signatures[0].label).to.contain("Sales.GetOrders");
    });

    test("INSERT ... EXEC also serves signature help", async () => {
        const help = await expectHelp("INSERT INTO Sales.Orders EXEC Sales.GetOrders /*caret*/");
        expect(help.signatures[0].label).to.contain("Sales.GetOrders");
    });

    test("caret before the argument region gives nothing", async () => {
        expect(await signature("EXEC Sales.Get/*caret*/Orders")).to.equal(undefined);
    });

    test("dynamic EXEC('…') is opaque — honest empty", async () => {
        expect(await signature("DECLARE @sql nvarchar(100)\nEXEC(@sql + /*caret*/)")).to.equal(
            undefined,
        );
    });

    test("unknown procedure: honest empty", async () => {
        expect(await signature("EXEC dbo.NoSuchProc /*caret*/")).to.equal(undefined);
    });

    test("parameters loading: honest empty for EXEC", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...ROUTINE_CATALOG,
            readiness: { parameters: "loading" },
        });
        expect(await signature("EXEC Sales.GetOrders /*caret*/", provider)).to.equal(undefined);
    });

    test("offline provider: honest empty for EXEC", async () => {
        expect(
            await signature("EXEC Sales.GetOrders /*caret*/", new NullLanguageMetadataProvider()),
        ).to.equal(undefined);
    });
});

suite("sqlLanguage native signature help: honesty positions", () => {
    test("inside string literals: nothing", async () => {
        expect(await signature("SELECT 'SUBSTRING(/*caret*/'")).to.equal(undefined);
    });

    test("inside comments: nothing", async () => {
        expect(await signature("SELECT 1 -- SUBSTRING(/*caret*/")).to.equal(undefined);
        expect(await signature("SELECT 1 /* SUBSTRING(/*caret*/ */")).to.equal(undefined);
    });

    test("no enclosing call and no EXEC: nothing", async () => {
        expect(await signature("SELECT OrderID FROM Sales.Orders/*caret*/")).to.equal(undefined);
        expect(await signature("/*caret*/")).to.equal(undefined);
    });

    test("USE other-db suppresses user-routine signatures", async () => {
        expect(await signature("USE master\nEXEC Sales.GetOrders /*caret*/")).to.equal(undefined);
        expect(await signature("USE master\nSELECT dbo.Calc(/*caret*/")).to.equal(undefined);
    });

    test("USE other-db keeps builtin signatures (local facts)", async () => {
        const help = await expectHelp("USE master\nSELECT SUBSTRING(/*caret*/");
        expect(help.signatures[0].label).to.contain("SUBSTRING(");
    });

    test("cross-database routine names are never claimed", async () => {
        expect(await signature("EXEC OtherDb.dbo.SomeProc /*caret*/")).to.equal(undefined);
    });

    test("case-sensitive catalog: wrong-case routine name is honest empty", async () => {
        const provider = new FixtureLanguageMetadataProvider({
            ...ROUTINE_CATALOG,
            env: { ...ROUTINE_CATALOG.env, caseSensitive: true },
        });
        expect(await signature("SELECT dbo.calc(/*caret*/", provider)).to.equal(undefined);
        const right = await expectHelp("SELECT dbo.Calc(/*caret*/", provider);
        expect(right.signatures[0].label).to.contain("dbo.Calc(");
    });
});
