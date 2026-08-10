/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    SaralSqlAnalysisEngine,
    type SqlCatalogProvider,
} from "@vscode-mssql/tsql-language-service";

suite("Parser-independent SQL analysis engine", () => {
    const catalog: SqlCatalogProvider = {
        version: 1,
        world: "closed",
        columnsFor: (parts) =>
            parts.map((part) => part.toLowerCase()).join(".") === "dbo.users"
                ? [
                      { name: "Id", type: "int", nullable: false },
                      { name: "DisplayName", type: "nvarchar", nullable: true },
                  ]
                : undefined,
        tableCandidates: (parts) =>
            parts.at(-1)?.toLowerCase() === "users" ? [["dbo", "Users"]] : [],
        childrenOf: (parts) =>
            parts.length === 1 && parts[0].toLowerCase() === "dbo"
                ? [{ name: "Users", kind: "table" }]
                : [],
        tables: () => ["Users"],
    };

    test("reports its editor-analysis capabilities explicitly", () => {
        const engine = new SaralSqlAnalysisEngine();

        expect(engine.id).to.equal("saralsql");
        expect(Object.keys(engine.capabilities)).to.have.members([
            "incrementalUpdate",
            "syntaxDiagnostics",
            "semanticDiagnostics",
            "lexicalTokens",
            "statements",
            "scopes",
            "symbols",
            "completion",
            "references",
            "typeLookup",
            "lineage",
            "externalReferences",
            "mutationTargets",
            "starExpansion",
            "signatureHelp",
            "clauseGeometry",
            "identifierNormalization",
            "reservedWords",
            "catalogAwareAnalysis",
        ]);
        expect(engine.capabilities.incrementalUpdate.level).to.equal("partial");
        expect(engine.capabilities.externalReferences.level).to.equal("partial");
        expect(engine.capabilities.mutationTargets.level).to.equal("partial");
        expect(Object.isFrozen(engine.capabilities)).to.equal(true);
    });

    test("keeps snapshots immutable while advancing an incremental successor", () => {
        const engine = new SaralSqlAnalysisEngine();
        const first = engine.createSnapshot({
            text: "SELECT Id FROM dbo.Users;\nSELECT DisplayName FROM dbo.Users;",
            uri: "file:///analysis-contract.sql",
            catalog,
        });
        const second = engine.updateSnapshot(first, {
            text: "SELECT Id FROM dbo.Users;\nSELECT Id FROM dbo.Users;",
        });

        expect(second).to.not.equal(first);
        expect(first.version).to.equal(1);
        expect(second.version).to.equal(2);
        expect(first.text).to.contain("SELECT DisplayName");
        expect(second.text).to.contain("SELECT Id FROM dbo.Users;\nSELECT Id");
        expect(second.uri).to.equal(first.uri);
        expect(first.statements).to.have.length(2);
        expect(second.statements).to.have.length(2);
        expect(Object.isFrozen(second.statements)).to.equal(true);
    });

    test("normalizes diagnostics, tokens, statements, scopes, symbols, and types", () => {
        const engine = new SaralSqlAnalysisEngine();
        const sql = "SELECT u.Id FROM dbo.Users AS u WHERE u.Missing > 0;";
        const snapshot = engine.createSnapshot({ text: sql, catalog });

        expect(snapshot.syntaxDiagnostics).to.be.empty;
        expect(snapshot.semanticDiagnostics.map((diagnostic) => diagnostic.code)).to.be.an("array");
        expect(snapshot.tokens.some((token) => token.role === "keyword")).to.equal(true);
        expect(snapshot.statements[0]).to.deep.include({
            index: 0,
            span: { start: 0, end: sql.length - 1 },
            category: "query",
            syntaxErrorCount: 0,
        });
        expect(snapshot.scopes).to.not.be.empty;
        expect(snapshot.scopeAt(sql.indexOf("WHERE"))).to.not.equal(undefined);
        expect(snapshot.clausesAt(sql.indexOf("WHERE")).map((clause) => clause.kind)).to.include(
            "where",
        );
        expect(snapshot.symbols().some((symbol) => symbol.name.includes("Id"))).to.equal(true);
        expect(snapshot.symbolAt(sql.indexOf("u.Id") + 2)?.kind).to.equal("column");
        expect(snapshot.typeAt(sql.indexOf("u.Id") + 2).kind).to.equal("scalar");
        const tableReference = snapshot
            .externalReferences()
            .find((reference) => reference.name === "dbo.Users");
        expect(tableReference).to.deep.include({
            name: "dbo.Users",
            kind: "table",
            role: "read",
        });
        expect(sql.slice(tableReference?.span.start, tableReference?.span.end)).to.equal(
            "dbo.Users",
        );
        expect(snapshot.lineage()).to.deep.include({
            output: "Id",
            origins: [{ table: ["dbo", "Users"], column: "Id" }],
        });
        expect(snapshot.mutationTargets()).to.be.empty;
        expect(snapshot.expandStarAt(sql.indexOf("u.Id"))).to.equal(undefined);
        expect(snapshot.positionAt(sql.indexOf("WHERE"))).to.deep.equal({
            line: 0,
            character: sql.indexOf("WHERE"),
        });
        expect(snapshot.offsetAt({ line: 0, character: sql.indexOf("WHERE") })).to.equal(
            sql.indexOf("WHERE"),
        );
    });

    test("normalizes completion, references, signatures, and reserved words", () => {
        const engine = new SaralSqlAnalysisEngine();
        const referenceSql = "DECLARE @value int; SELECT @value AS Result;";
        const references = engine
            .createSnapshot({ text: referenceSql, catalog })
            .referencesAt(referenceSql.lastIndexOf("@value") + 1);
        const completionSql = "SELECT  FROM dbo.Users";
        const completionOffset = "SELECT ".length;
        const completion = engine
            .createSnapshot({ text: completionSql, catalog })
            .completeAt(completionOffset);
        const signatureSql = "SELECT ABS(";
        const signature = engine
            .createSnapshot({ text: signatureSql, catalog })
            .signatureAt(signatureSql.length);
        const starSql = "SELECT * FROM dbo.Users";
        const starExpansion = engine
            .createSnapshot({ text: starSql, catalog })
            .expandStarAt(starSql.indexOf("*"));

        expect(references?.occurrences.map((occurrence) => occurrence.role)).to.deep.equal([
            "declaration",
            "reference",
        ]);
        expect(completion.items).to.not.be.empty;
        expect(Object.isFrozen(completion.items)).to.equal(true);
        expect(signature?.signatures).to.not.be.empty;
        expect(starExpansion).to.deep.equal([
            { name: "Id", sourceKey: "Users" },
            { name: "DisplayName", sourceKey: "Users" },
        ]);
        expect(engine.createSnapshot({ text: "" }).isReservedKeyword("select")).to.equal(true);
        expect(engine.createSnapshot({ text: "" }).isReservedKeyword("ordinary_name")).to.equal(
            false,
        );
        expect(engine.createSnapshot({ text: "" }).normalizeIdentifier("[MixedCase]")).to.equal(
            "mixedcase",
        );
        expect(engine.createSnapshot({ text: "" }).displayIdentifier("[MixedCase]")).to.equal(
            "MixedCase",
        );
    });

    test("exposes SaralSQL behavior without borrowing unsupported catalog semantics", () => {
        const engine = new SaralSqlAnalysisEngine();
        const sql =
            "INSERT INTO dbo.Users (Id) VALUES (1); " +
            "MERGE dbo.Missing AS target USING dbo.Users AS source " +
            "ON target.Id = source.Id WHEN MATCHED THEN DELETE;";
        const first = engine.createSnapshot({ text: sql, catalog });
        const second = engine.updateSnapshot(first, { text: `${sql}\nSELECT 1;` });

        expect(engine.capabilities.incrementalUpdate.level).to.equal("partial");
        expect(engine.capabilities.catalogAwareAnalysis.level).to.equal("partial");
        expect(engine.capabilities.mutationTargets.level).to.equal("partial");
        expect(first.semanticDiagnostics).to.deep.include({
            kind: "semantic",
            code: "MSSQL208",
            message: "Invalid object name 'dbo.Missing'.",
            span: { start: sql.indexOf("dbo.Missing"), end: sql.indexOf("dbo.Missing") + 11 },
            severity: "error",
        });
        expect(first.mutationTargets().map((target) => target.operation)).to.deep.equal([
            "insert",
            "merge",
        ]);
        expect(
            first
                .externalReferences()
                .some(
                    (reference) => reference.name === "dbo.Missing" && reference.role === "write",
                ),
        ).to.equal(true);
        expect(first.tokens.some((token) => token.role === "keyword")).to.equal(true);
        expect(first.normalizeIdentifier("[dbo].[MixedCase]", "table")).to.equal("dbo.mixedcase");
        expect(first.displayIdentifier("[dbo].[MixedCase]")).to.equal("dbo.MixedCase");
        expect(first.version).to.equal(1);
        expect(second.version).to.equal(2);
        expect(first.text).to.equal(sql);
        expect(second.text.endsWith("SELECT 1;")).to.equal(true);
    });
});
