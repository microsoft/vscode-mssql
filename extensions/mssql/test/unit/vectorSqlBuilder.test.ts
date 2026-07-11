/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VEC-8 foundation: the vector Search SQL builder and recall-evidence math.
 * Covers QUOTENAME escaping, strict parameterization (no user value ever in
 * SQL text), AND-only structured predicates, the P0-6 structured exclusion
 * policy, A1 post-filter oversample disclosure on the TVF path, VEC-7 probe
 * gating, P0-7 read-consistency declaration, P0-10 frozen query vector, and
 * recall@K denominators — plus an optional gated live smoke against the
 * VectorLab corpus.
 */

import { expect } from "chai";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    buildApproxSearch,
    buildComparison,
    buildExactSearch,
    buildRecallComparison,
    classifyApproxEvidence,
    declaredReadConsistency,
    DEFAULT_OVERSAMPLE_MULTIPLIER,
    ProbeFacts,
    quoteIdentifier,
    SqlParameter,
    StructuredPredicate,
    validateQueryVectorJson,
    VECTOR_EXECUTION_EVIDENCE_COPY,
    VectorApproxSearchRequest,
    VectorApproxSearchSql,
    VectorSearchSqlRequest,
    VectorSearchTarget,
} from "../../src/queryResults/vector/vectorSqlBuilder";

const DIMS = 8;
const QUERY_VECTOR_JSON = JSON.stringify(
    Array.from({ length: DIMS }, (_, i) => Math.round((i * 0.5 - 1) * 100) / 100),
);

const TARGET: VectorSearchTarget = {
    schema: "dbo",
    table: "DocumentChunks",
    keyColumn: "chunk_id",
    vectorColumn: "embedding",
    labelColumn: "title",
};

const TVF_ACCEPTED: ProbeFacts = { vectorSearchTvf: "accepted", withApproximate: "rejected" };

function exactRequest(overrides?: Partial<VectorSearchSqlRequest>): VectorSearchSqlRequest {
    return {
        target: TARGET,
        metric: "cosine",
        k: 20,
        queryVectorJson: QUERY_VECTOR_JSON,
        dims: DIMS,
        ...overrides,
    };
}

function approxRequest(overrides?: Partial<VectorApproxSearchRequest>): VectorApproxSearchRequest {
    return { ...exactRequest(), probeFacts: TVF_ACCEPTED, ...overrides };
}

function approxOrFail(overrides?: Partial<VectorApproxSearchRequest>): VectorApproxSearchSql {
    const built = buildApproxSearch(approxRequest(overrides));
    expect("unavailable" in built, JSON.stringify(built)).to.equal(false);
    return built as VectorApproxSearchSql;
}

suite("vectorSqlBuilder identifier escaping", () => {
    test("quoteIdentifier doubles closing brackets QUOTENAME-style", () => {
        expect(quoteIdentifier("plain")).to.equal("[plain]");
        expect(quoteIdentifier("a]b")).to.equal("[a]]b]");
        expect(quoteIdentifier("]]")).to.equal("[]]]]]");
        expect(quoteIdentifier("we[ird")).to.equal("[we[ird]"); // opening bracket needs no doubling
        expect(() => quoteIdentifier("")).to.throw("non-empty");
        expect(() => quoteIdentifier("x".repeat(129))).to.throw("128");
    });

    test("every identifier in the statement is bracket-quoted, including ]-in-names", () => {
        const nasty: VectorSearchTarget = {
            schema: "sch]ema",
            table: "Ta]ble",
            keyColumn: "key] col",
            vectorColumn: "vec]tor",
            labelColumn: "lab]el",
        };
        const exact = buildExactSearch(
            exactRequest({
                target: nasty,
                predicates: [{ column: "cat]egory", op: "eq", value: "x" }],
            }),
        );
        expect(exact.sql).to.contain("[sch]]ema].[Ta]]ble]");
        expect(exact.sql).to.contain("[key]] col]");
        expect(exact.sql).to.contain("[vec]]tor]");
        expect(exact.sql).to.contain("[lab]]el]");
        expect(exact.sql).to.contain("[cat]]egory]");
        // No raw (unescaped) occurrence of the identifiers survives.
        expect(exact.sql).to.not.contain("[Ta]ble]");
        expect(exact.sql).to.not.contain("[cat]egory]");

        const approx = approxOrFail({ target: nasty });
        expect(approx.sql).to.contain("TABLE = [sch]]ema].[Ta]]ble] AS t");
        expect(approx.sql).to.contain("COLUMN = [vec]]tor]");
    });
});

suite("vectorSqlBuilder parameterization", () => {
    const SENTINEL_STRING = "rob']; DROP TABLE students; --";
    const SENTINEL_INT = 987654321;
    const SENTINEL_FLOAT = 3.14159;

    function allSql(): { sql: string; parameters: readonly SqlParameter[] } {
        const comparison = buildComparison(
            approxRequest({
                predicates: [
                    { column: "category", op: "eq", value: SENTINEL_STRING },
                    { column: "tenant_id", op: "gt", value: SENTINEL_INT },
                    { column: "score", op: "le", value: SENTINEL_FLOAT },
                    { column: "active", op: "eq", value: true },
                ],
                exclusion: {
                    excludeSourceRow: true,
                    excludeExactVectorDuplicates: true,
                    excludeSameDocument: true,
                    keyPredicate: {
                        sourceRowKey: 100042,
                        exactDuplicateKeys: [111, 222],
                        documentColumn: "document_id",
                        sourceDocumentValue: "doc-7",
                    },
                },
            }),
        );
        expect("unavailable" in comparison.approx).to.equal(false);
        const approxSql = (comparison.approx as { sql: string }).sql;
        return { sql: comparison.exact.sql + "\n" + approxSql, parameters: comparison.parameters };
    }

    test("no user value ever appears in the SQL text; all values ride typed parameters", () => {
        const { sql, parameters } = allSql();
        expect(sql).to.not.contain(SENTINEL_STRING);
        expect(sql).to.not.contain("DROP TABLE");
        expect(sql).to.not.contain(String(SENTINEL_INT));
        expect(sql).to.not.contain(String(SENTINEL_FLOAT));
        expect(sql).to.not.contain("100042");
        expect(sql).to.not.contain("doc-7");
        // The query vector JSON is a value too — parameter only, never inline.
        expect(sql).to.not.contain(QUERY_VECTOR_JSON);

        const byName = new Map(parameters.map((p) => [p.name, p]));
        expect(byName.get("@qv")).to.deep.equal({
            name: "@qv",
            type: "vector",
            value: QUERY_VECTOR_JSON,
        });
        expect(byName.get("@k")).to.deep.equal({ name: "@k", type: "bigint", value: 20 });
        expect(byName.get("@p0")).to.deep.equal({
            name: "@p0",
            type: "nvarchar",
            value: SENTINEL_STRING,
        });
        expect(byName.get("@p1")).to.deep.equal({
            name: "@p1",
            type: "bigint",
            value: SENTINEL_INT,
        });
        expect(byName.get("@p2")).to.deep.equal({
            name: "@p2",
            type: "float",
            value: SENTINEL_FLOAT,
        });
        expect(byName.get("@p3")).to.deep.equal({ name: "@p3", type: "bit", value: true });
        expect(byName.get("@xsrc")).to.deep.equal({
            name: "@xsrc",
            type: "bigint",
            value: 100042,
        });
        expect(byName.get("@xdup0")).to.deep.equal({ name: "@xdup0", type: "bigint", value: 111 });
        expect(byName.get("@xdup1")).to.deep.equal({ name: "@xdup1", type: "bigint", value: 222 });
        expect(byName.get("@xdoc")).to.deep.equal({
            name: "@xdoc",
            type: "nvarchar",
            value: "doc-7",
        });
    });

    test("frozen query vector is validated once and strictly", () => {
        expect(() => validateQueryVectorJson(QUERY_VECTOR_JSON, DIMS)).to.not.throw();
        expect(() => validateQueryVectorJson("not json", DIMS)).to.throw("not valid JSON");
        expect(() => validateQueryVectorJson("{}", DIMS)).to.throw("flat numeric array");
        expect(() => validateQueryVectorJson("[1,2,3]", DIMS)).to.throw("expected 8");
        expect(() => validateQueryVectorJson("[[1,2],[3,4]]", 2)).to.throw("finite");
        expect(() => validateQueryVectorJson("[1e400,0,0,0,0,0,0,0]", DIMS)).to.throw("finite");
        expect(() => buildExactSearch(exactRequest({ queryVectorJson: "[1]" }))).to.throw(
            "expected 8",
        );
    });

    test("k and multiplier are validated as positive integers", () => {
        expect(() => buildExactSearch(exactRequest({ k: 0 }))).to.throw("positive integer");
        expect(() => buildExactSearch(exactRequest({ k: -3 }))).to.throw("positive integer");
        expect(() => buildExactSearch(exactRequest({ k: 2.5 }))).to.throw("positive integer");
        expect(() =>
            buildApproxSearch(
                approxRequest({
                    oversampleMultiplier: 0,
                    predicates: [{ column: "c", op: "eq", value: 1 }],
                }),
            ),
        ).to.throw("positive integer");
    });
});

suite("vectorSqlBuilder predicates", () => {
    test("AND-only chain in declaration order, after the IS NOT NULL guard", () => {
        const predicates: StructuredPredicate[] = [
            { column: "category", op: "eq", value: "news" },
            { column: "year", op: "ge", value: 2020 },
            { column: "rank", op: "lt", value: 1.5 },
            { column: "flag", op: "ne", value: false },
        ];
        const built = buildExactSearch(exactRequest({ predicates }));
        expect(built.sql).to.contain("WHERE t.[embedding] IS NOT NULL");
        expect(built.sql).to.contain("AND t.[category] = @p0");
        expect(built.sql).to.contain("AND t.[year] >= @p1");
        expect(built.sql).to.contain("AND t.[rank] < @p2");
        expect(built.sql).to.contain("AND t.[flag] <> @p3");
        expect(built.sql).to.not.contain(" OR ");
        const order = ["@p0", "@p1", "@p2", "@p3"].map((n) => built.sql.indexOf(n));
        expect([...order].sort((a, b) => a - b)).to.deep.equal(order);
    });

    test("null values become IS NULL / IS NOT NULL without parameters; other ops reject null", () => {
        const built = buildExactSearch(
            exactRequest({
                predicates: [
                    { column: "deleted_at", op: "eq", value: null },
                    { column: "author", op: "ne", value: null },
                ],
            }),
        );
        expect(built.sql).to.contain("t.[deleted_at] IS NULL");
        expect(built.sql).to.contain("t.[author] IS NOT NULL");
        expect(built.parameters.map((p) => p.name)).to.deep.equal(["@qv", "@k"]);
        expect(() =>
            buildExactSearch(
                exactRequest({ predicates: [{ column: "x", op: "gt", value: null }] }),
            ),
        ).to.throw("NULL only supports eq/ne");
    });
});

suite("vectorSqlBuilder exclusion policy (P0-6, structured)", () => {
    test("source row excluded by KEY predicate, never by vector equality", () => {
        const built = buildExactSearch(
            exactRequest({
                exclusion: {
                    excludeSourceRow: true,
                    excludeExactVectorDuplicates: false,
                    keyPredicate: { sourceRowKey: 100042 },
                },
            }),
        );
        expect(built.sql).to.contain("t.[chunk_id] <> @xsrc");
        expect(built.sql).to.not.contain("[embedding] <>");
        expect(built.parameters.find((p) => p.name === "@xsrc")?.value).to.equal(100042);
    });

    test("exact-duplicate exclusion is a key list — float equality on the vector column is wrong", () => {
        const built = buildExactSearch(
            exactRequest({
                exclusion: {
                    excludeSourceRow: false,
                    excludeExactVectorDuplicates: true,
                    keyPredicate: { exactDuplicateKeys: [7, 8, 9] },
                },
            }),
        );
        expect(built.sql).to.contain("t.[chunk_id] NOT IN (@xdup0, @xdup1, @xdup2)");
        // The wrong implementation the brief warns about must not exist:
        expect(built.sql).to.not.contain("[embedding] <> @q");
        expect(built.sql).to.not.match(/\[embedding\]\s*<>/);

        // Empty key list = nothing known to exclude: no fragment, still disclosed.
        const empty = buildExactSearch(
            exactRequest({
                exclusion: {
                    excludeSourceRow: false,
                    excludeExactVectorDuplicates: true,
                    keyPredicate: { exactDuplicateKeys: [] },
                },
            }),
        );
        expect(empty.sql).to.not.contain("NOT IN");
    });

    test("same-document exclusion keeps NULL-document rows eligible", () => {
        const built = buildExactSearch(
            exactRequest({
                exclusion: {
                    excludeSourceRow: false,
                    excludeExactVectorDuplicates: false,
                    excludeSameDocument: true,
                    keyPredicate: { documentColumn: "document_id", sourceDocumentValue: 55 },
                },
            }),
        );
        expect(built.sql).to.contain("(t.[document_id] <> @xdoc OR t.[document_id] IS NULL)");
    });

    test("missing structured key facts fail loudly instead of building a weaker predicate", () => {
        expect(() =>
            buildExactSearch(
                exactRequest({
                    exclusion: { excludeSourceRow: true, excludeExactVectorDuplicates: false },
                }),
            ),
        ).to.throw("sourceRowKey");
        expect(() =>
            buildExactSearch(
                exactRequest({
                    exclusion: { excludeSourceRow: false, excludeExactVectorDuplicates: true },
                }),
            ),
        ).to.throw("exactDuplicateKeys");
        expect(() =>
            buildExactSearch(
                exactRequest({
                    exclusion: {
                        excludeSourceRow: false,
                        excludeExactVectorDuplicates: false,
                        excludeSameDocument: true,
                        keyPredicate: { documentColumn: "document_id" },
                    },
                }),
            ),
        ).to.throw("sourceDocumentValue");
    });

    test("comparison surfaces the P0-6 disclosure lines", () => {
        const comparison = buildComparison(
            approxRequest({
                exclusion: {
                    excludeSourceRow: true,
                    excludeExactVectorDuplicates: false,
                    keyPredicate: { sourceRowKey: 100042 },
                },
            }),
        );
        expect(comparison.exclusionDisclosures).to.deep.equal([
            "Source row excluded by key: chunk_id <> 100042",
            "Exact vector duplicates included",
            "Same-document chunks included",
        ]);
    });
});

suite("vectorSqlBuilder approximate search (TVF path, A1 semantics)", () => {
    test("no filters: TOP_N = k, no oversample disclosure", () => {
        const built = approxOrFail({ k: 10 });
        expect(built.sql).to.contain("TOP_N = 10");
        expect(built.sql).to.contain("SIMILAR_TO = @q,");
        expect(built.sql).to.contain("METRIC = 'cosine',");
        expect(built.sql).to.contain("FROM VECTOR_SEARCH(");
        expect(built.sql).to.not.contain("WHERE");
        expect(built.filterSemantics).to.equal("iterative");
        expect(built.disclosedMultiplier).to.equal(undefined);
        expect(built.disclosure).to.equal(undefined);
        expect(built.topN).to.equal(10);
    });

    test("predicates present: TOP_N = k×M with post-filter disclosure in result AND SQL text", () => {
        const built = approxOrFail({
            k: 7,
            oversampleMultiplier: 3,
            predicates: [{ column: "category", op: "eq", value: "news" }],
        });
        expect(built.topN).to.equal(21);
        expect(built.sql).to.contain("TOP_N = 21");
        expect(built.sql).to.contain("WHERE t.[category] = @p0");
        expect(built.filterSemantics).to.equal("postFilteredOversample");
        expect(built.disclosedMultiplier).to.equal(3);
        expect(built.disclosure).to.equal("Post-filtered, TOP_N ×3");
        expect(built.sql).to.contain("TOP_N oversampled ×3");
        // The outer TOP (@k) trims the oversample back to K.
        expect(built.sql).to.contain("SELECT TOP (@k)");
    });

    test("exclusions alone are outer filters on the TVF path and trigger the oversample too", () => {
        const built = approxOrFail({
            k: 10,
            exclusion: {
                excludeSourceRow: true,
                excludeExactVectorDuplicates: false,
                keyPredicate: { sourceRowKey: 1 },
            },
        });
        expect(built.filterSemantics).to.equal("postFilteredOversample");
        expect(built.disclosedMultiplier).to.equal(DEFAULT_OVERSAMPLE_MULTIPLIER);
        expect(built.topN).to.equal(10 * DEFAULT_OVERSAMPLE_MULTIPLIER);
        expect(built.sql).to.contain("WHERE t.[chunk_id] <> @xsrc");
    });

    test("probe gating: rejected and needsPreview return { unavailable }, never SQL", () => {
        const rejected = buildApproxSearch(
            approxRequest({
                probeFacts: { vectorSearchTvf: "rejected", withApproximate: "rejected" },
            }),
        );
        expect(rejected).to.have.property("unavailable").that.contains("rejected");

        const preview = buildApproxSearch(
            approxRequest({
                probeFacts: { vectorSearchTvf: "needsPreview", withApproximate: "rejected" },
            }),
        );
        expect(preview).to.have.property("unavailable").that.contains("PREVIEW_FEATURES");
        expect(preview).to.have.property("unavailable").that.does.not.contain("SELECT");
    });

    test("the rejected syntaxes of this generation are never emitted", () => {
        const built = approxOrFail();
        expect(built.sql).to.not.contain("WITH APPROXIMATE");
        expect(built.sql).to.not.contain("FORCE_ANN_ONLY");
    });
});

suite("vectorSqlBuilder comparison (P0-10 frozen vector, shared parameters)", () => {
    test("one vector parameter, referenced by both statements through the DECLARE header", () => {
        const comparison = buildComparison(
            approxRequest({
                predicates: [{ column: "category", op: "eq", value: "news" }],
                exclusion: {
                    excludeSourceRow: true,
                    excludeExactVectorDuplicates: false,
                    keyPredicate: { sourceRowKey: 5 },
                },
            }),
        );
        const vectorParams = comparison.parameters.filter((p) => p.type === "vector");
        expect(vectorParams).to.have.length(1);
        expect(vectorParams[0].name).to.equal("@qv");
        expect(comparison.queryVectorParameterName).to.equal("@qv");

        expect("unavailable" in comparison.approx).to.equal(false);
        const approxSql = (comparison.approx as { sql: string }).sql;
        const header = `DECLARE @q VECTOR(${DIMS}) = CAST(@qv AS VECTOR(${DIMS}));`;
        expect(comparison.exact.sql).to.contain(header);
        expect(approxSql).to.contain(header);

        // Identical predicate + exclusion parameters serve both statements.
        for (const name of ["@p0", "@xsrc", "@k"]) {
            expect(comparison.exact.sql).to.contain(name);
            expect(approxSql).to.contain(name);
        }
        // Deterministic tie-break on both variants (distance, then key).
        expect(comparison.exact.sql).to.contain("ORDER BY [distance] ASC, t.[chunk_id] ASC;");
        expect(approxSql).to.contain("ORDER BY [distance] ASC, t.[chunk_id] ASC;");
        expect(comparison.exactEvidence).to.equal("exactGroundTruth");
        expect(comparison.approxEvidence).to.equal("approxStrategyUnverified");
    });

    test("standalone builders produce the same shared parameter list as the comparison", () => {
        const request = approxRequest({
            predicates: [{ column: "year", op: "ge", value: 2021 }],
        });
        const exact = buildExactSearch(request);
        const approx = approxOrFail(request);
        const comparison = buildComparison(request);
        expect(exact.parameters).to.deep.equal(comparison.parameters);
        expect(approx.parameters).to.deep.equal(comparison.parameters);
    });

    test("TVF unavailable propagates: exact still built, approx evidence honest", () => {
        const comparison = buildComparison(
            approxRequest({
                probeFacts: { vectorSearchTvf: "needsPreview", withApproximate: "rejected" },
            }),
        );
        expect(comparison.exact.sql).to.contain("VECTOR_DISTANCE");
        expect(comparison.approx).to.have.property("unavailable");
        expect(comparison.approxEvidence).to.equal("syntaxUnavailable");
        expect(comparison.parameters.map((p) => p.name)).to.include("@qv");
    });

    test("label column present in the select list; optional when absent", () => {
        const withLabel = buildExactSearch(exactRequest());
        expect(withLabel.sql).to.contain("t.[title],");
        const withoutLabel = buildExactSearch(
            exactRequest({ target: { ...TARGET, labelColumn: undefined } }),
        );
        expect(withoutLabel.sql).to.not.contain("[title]");
    });

    test("metric map covers the enum; unknown metric throws", () => {
        expect(buildExactSearch(exactRequest({ metric: "euclidean" })).sql).to.contain(
            "VECTOR_DISTANCE('euclidean'",
        );
        expect(approxOrFail({ metric: "dot" }).sql).to.contain("METRIC = 'dot',");
        expect(() => buildExactSearch(exactRequest({ metric: "manhattan" as never }))).to.throw(
            "unsupported metric",
        );
    });
});

suite("vectorSqlBuilder recall math", () => {
    test("full overlap: recall 1 with K denominator", () => {
        const recall = buildRecallComparison([1, 2, 3, 4], [4, 3, 2, 1], 4);
        expect(recall.recallAtK).to.equal(1);
        expect(recall.overlap).to.equal(4);
        expect(recall.exactOnly).to.deep.equal([]);
        expect(recall.approxOnly).to.deep.equal([]);
        expect(recall.denominatorDisclosure).to.equal("Recall@4 denominator = 4 exact neighbors");
    });

    test("partial overlap keeps exact-only and approx-only key order", () => {
        const recall = buildRecallComparison([1, 2, 3, 4, 5], [3, 9, 1, 8, 5], 5);
        expect(recall.recallAtK).to.equal(3 / 5);
        expect(recall.overlap).to.equal(3);
        expect(recall.exactOnly).to.deep.equal([2, 4]);
        expect(recall.approxOnly).to.deep.equal([9, 8]);
        expect(recall.exactCount).to.equal(5);
        expect(recall.approxCount).to.equal(5);
    });

    test("|E| < K uses the exact count as denominator and discloses it", () => {
        // Exact returned only 3 eligible rows for K=20 (spec:647).
        const recall = buildRecallComparison([10, 11, 12], [10, 12, 99], 20);
        expect(recall.recallAtK).to.equal(2 / 3);
        expect(recall.denominatorDisclosure).to.equal(
            "Recall@20 denominator = 3: exact search returned fewer than K eligible rows",
        );
    });

    test("|E| = 0 leaves recall undefined instead of inventing a number", () => {
        const recall = buildRecallComparison([], [1, 2], 10);
        expect(recall.recallAtK).to.equal(undefined);
        expect(recall.overlap).to.equal(0);
        expect(recall.denominatorDisclosure).to.equal(
            "Recall@10 undefined: exact search returned no eligible rows",
        );
    });

    test("duplicate keys are collapsed to set semantics", () => {
        const recall = buildRecallComparison([1, 1, 2], [2, 2, 3], 2);
        expect(recall.exactCount).to.equal(2);
        expect(recall.approxCount).to.equal(2);
        expect(recall.overlap).to.equal(1);
        expect(recall.recallAtK).to.equal(1 / 2);
    });

    test("string keys work (table keys are not always integers)", () => {
        const recall = buildRecallComparison(["a", "b"], ["b", "c"], 2);
        expect(recall.overlap).to.equal(1);
        expect(recall.exactOnly).to.deep.equal(["a"]);
        expect(recall.approxOnly).to.deep.equal(["c"]);
    });
});

suite("vectorSqlBuilder read consistency (P0-7) and evidence labels", () => {
    test("declares, never sets: built SQL contains no isolation hints", () => {
        const comparison = buildComparison(approxRequest());
        const approxSql = (comparison.approx as { sql: string }).sql;
        for (const sql of [comparison.exact.sql, approxSql]) {
            expect(sql.toUpperCase()).to.not.contain("ISOLATION");
            expect(sql.toUpperCase()).to.not.contain("NOLOCK");
            expect(sql.toUpperCase()).to.not.contain("SET TRANSACTION");
        }
    });

    test("declaredReadConsistency maps session defaults to the P0-7 disclosure strings", () => {
        expect(declaredReadConsistency("read committed")).to.equal(
            "Read consistency: read committed; concurrent changes may affect comparison",
        );
        expect(declaredReadConsistency("snapshot")).to.equal(
            "Read consistency: database snapshot isolation",
        );
        expect(declaredReadConsistency("one read-only snapshot transaction")).to.equal(
            "Read consistency: one read-only snapshot transaction",
        );
        // Unknown levels are declared verbatim with the caveat — never upgraded.
        expect(declaredReadConsistency("repeatable read")).to.equal(
            "Read consistency: repeatable read; concurrent changes may affect comparison",
        );
    });

    test("evidence labels match the UX-spec taxonomy for this engine generation", () => {
        expect(VECTOR_EXECUTION_EVIDENCE_COPY.approxStrategyUnverified).to.equal(
            "Approximate requested, strategy unverified",
        );
        expect(VECTOR_EXECUTION_EVIDENCE_COPY.noCompatibleIndex).to.equal(
            "No compatible vector index",
        );
        expect(classifyApproxEvidence(TVF_ACCEPTED)).to.equal("approxStrategyUnverified");
        expect(
            classifyApproxEvidence({ vectorSearchTvf: "rejected", withApproximate: "rejected" }),
        ).to.equal("syntaxUnavailable");
        expect(
            classifyApproxEvidence({
                vectorSearchTvf: "needsPreview",
                withApproximate: "rejected",
            }),
        ).to.equal("syntaxUnavailable");
        // A successful TVF run alone can never claim proven ANN on this generation.
        const built = approxOrFail();
        expect(built.sql).to.contain("Approximate requested, strategy unverified");
    });
});

// ---------------------------------------------------------------------------
// Optional live smoke against the VectorLab corpus (skip-not-fail gated on
// STS2_SQLSERVER_CONNSTRING + a local sqlcmd). Executes the BUILT exact and
// approximate statements and measures recall@K against the DiskANN index.
// ---------------------------------------------------------------------------

/**
 * TEST-ONLY parameter inlining. sqlcmd cannot bind parameters, so this inlines
 * the typed parameter values as T-SQL literals purely for the live smoke.
 * Production execution (VEC-7 executor) MUST bind the emitted parameters —
 * this function must never move into product code.
 */
function inlineParametersForSqlcmdTestOnly(
    sql: string,
    parameters: readonly SqlParameter[],
): string {
    let inlined = sql;
    const byLengthDesc = [...parameters].sort((a, b) => b.name.length - a.name.length);
    for (const parameter of byLengthDesc) {
        let literal: string;
        switch (parameter.type) {
            case "nvarchar":
            case "vector":
                literal = `N'${String(parameter.value).replace(/'/g, "''")}'`;
                break;
            case "bigint":
            case "float":
                if (typeof parameter.value !== "number" || !Number.isFinite(parameter.value)) {
                    throw new Error(`test inliner: ${parameter.name} must be a finite number`);
                }
                literal = String(parameter.value);
                break;
            case "bit":
                literal = parameter.value ? "1" : "0";
                break;
            default:
                throw new Error(`test inliner: unsupported type ${String(parameter.type)}`);
        }
        const pattern = new RegExp(
            parameter.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9_$#@])",
            "g",
        );
        inlined = inlined.replace(pattern, () => literal);
    }
    return inlined;
}

function sqlcmdArgsFromConnectionString(connectionString: string, database: string): string[] {
    const settings = new Map<string, string>();
    for (const part of connectionString.split(";")) {
        const separator = part.indexOf("=");
        if (separator < 0) {
            continue;
        }
        settings.set(
            part.slice(0, separator).trim().toLowerCase(),
            part.slice(separator + 1).trim(),
        );
    }
    // Note: -W (trim) is mutually exclusive with -y, and -y 0 with -h -1, so use
    // a wide fixed -y and trim each parsed cell instead.
    const args = ["-d", database, "-I", "-b", "-h", "-1", "-y", "8000", "-s", "|"];
    const server =
        settings.get("server") ??
        settings.get("data source") ??
        settings.get("address") ??
        "localhost";
    args.push("-S", server);
    const user = settings.get("user id") ?? settings.get("uid");
    if (user !== undefined) {
        args.push("-U", user, "-P", settings.get("password") ?? settings.get("pwd") ?? "");
    } else {
        args.push("-E");
    }
    if ((settings.get("trustservercertificate") ?? "").toLowerCase() === "true") {
        args.push("-C");
    }
    return args;
}

suite("vectorSqlBuilder live smoke (VectorLab, gated)", function () {
    this.timeout(120_000);
    const connectionString = process.env.STS2_SQLSERVER_CONNSTRING;
    const K = 10;

    function runSqlcmd(batchSql: string): string {
        const args = sqlcmdArgsFromConnectionString(connectionString!, "VectorLab");
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vec-sql-smoke-"));
        const inputPath = path.join(scratch, "batch.sql");
        fs.writeFileSync(inputPath, "SET NOCOUNT ON;\n" + batchSql, "utf8");
        const result = spawnSync("sqlcmd", [...args, "-i", inputPath], {
            encoding: "utf8",
            timeout: 90_000,
        });
        expect(result.status, `sqlcmd failed: ${result.stderr}\n${result.stdout}`).to.equal(0);
        return result.stdout;
    }

    function parseRows(stdout: string): Array<{ key: number; distance: number }> {
        return stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && line.includes("|"))
            .map((line) => {
                const cells = line.split("|");
                return {
                    key: Number(cells[0].trim()),
                    distance: Number(cells[cells.length - 1].trim()),
                };
            });
    }

    test("built exact + approx SQL both return K rows with recall ≥ 0.8", function () {
        if (connectionString === undefined || connectionString.length === 0) {
            this.skip(); // no live SQL Server configured
        }
        const probe = spawnSync("sqlcmd", ["-?"], { encoding: "utf8", timeout: 15_000 });
        if (probe.error !== undefined) {
            this.skip(); // sqlcmd not installed
        }

        // Frozen query vector (P0-10): fetched ONCE from a corpus row, reused verbatim.
        const seed = runSqlcmd(
            "SELECT TOP (1) chunk_id, CAST(embedding AS NVARCHAR(MAX)) " +
                "FROM dbo.VectorLabSearchCorpus WHERE embedding IS NOT NULL ORDER BY chunk_id;",
        );
        const seedLine = seed
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.includes("|"));
        expect(seedLine, `unexpected seed output: ${seed}`).to.not.equal(undefined);
        const [, queryVectorJson] = seedLine!.split("|");
        const dims = (JSON.parse(queryVectorJson) as number[]).length;
        expect(dims).to.be.greaterThan(0);

        const comparison = buildComparison({
            target: {
                schema: "dbo",
                table: "VectorLabSearchCorpus",
                keyColumn: "chunk_id",
                vectorColumn: "embedding",
            },
            metric: "cosine",
            k: K,
            queryVectorJson,
            dims,
            probeFacts: TVF_ACCEPTED,
        });
        expect("unavailable" in comparison.approx).to.equal(false);
        const approxSql = (comparison.approx as { sql: string }).sql;

        const exactRows = parseRows(
            runSqlcmd(
                inlineParametersForSqlcmdTestOnly(comparison.exact.sql, comparison.parameters),
            ),
        );
        const approxRows = parseRows(
            runSqlcmd(inlineParametersForSqlcmdTestOnly(approxSql, comparison.parameters)),
        );

        expect(exactRows, "exact row count").to.have.length(K);
        expect(approxRows, "approx row count").to.have.length(K);
        // Deterministic ordering: distances non-decreasing on both variants.
        for (const rows of [exactRows, approxRows]) {
            for (let i = 1; i < rows.length; i++) {
                expect(rows[i].distance).to.be.at.least(rows[i - 1].distance - 1e-9);
            }
        }
        // The query vector IS a corpus row's vector: exact top hit at distance ~0.
        expect(exactRows[0].distance).to.be.closeTo(0, 1e-4);

        const recall = buildRecallComparison(
            exactRows.map((row) => row.key),
            approxRows.map((row) => row.key),
            K,
        );

        console.log(
            `[vectorSqlBuilder live smoke] dims=${dims} recall@${K}=${recall.recallAtK} ` +
                `overlap=${recall.overlap} exactOnly=[${recall.exactOnly}] approxOnly=[${recall.approxOnly}]`,
        );
        expect(recall.recallAtK, recall.denominatorDisclosure).to.be.at.least(0.8);
    });
});
