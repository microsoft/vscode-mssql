import { analyze, DiagnosticCode } from "../../src/parser/saral/index.js";
import { parseResult } from "./parser.helpers.js";

// Independently authored regression cases based on SqlParser's Vector.xml,
// CreateVectorIndex.xml, and VectorSearch.xml feature suites.
describe("SQL Server vector grammar", () => {
    test("parses vector declarations and scalar functions", () => {
        const result = parseResult(`
            DECLARE @left vector(1536), @right vector(1536);
            SELECT
                VECTOR_DISTANCE('cosine', @left, @right),
                VECTOR_NORM(@left, 'norm2'),
                VECTOR_NORMALIZE(@left, 'norm2');
        `);

        expect(result.issues).toEqual([]);
        const select = result.ast.body[1] as any;
        expect(select.columns.map((column: any) => column.expression.name)).toEqual([
            "VECTOR_DISTANCE",
            "VECTOR_NORM",
            "VECTOR_NORMALIZE",
        ]);
    });

    test("parses ordered VECTOR_SEARCH parameters and TOP WITH APPROX", () => {
        const result = parseResult(`
            SELECT TOP (10) WITH APPROX ann.distance
            FROM VECTOR_SEARCH(
                TABLE = dbo.Products AS source,
                COLUMN = Embedding,
                SIMILAR_TO = @query,
                METRIC = 'cosine',
                TOP_N = 10,
                L = 20,
                M = 8,
                START_ID = 0
            ) AS ann
            ORDER BY ann.distance;
        `);

        expect(result.issues).toEqual([]);
        const select = result.ast.body[0] as any;
        expect(select.top.approximate).toBe(true);
        expect(select.from[0].table.vectorSearch.parameters.map((item: any) => item.name)).toEqual([
            "TABLE",
            "COLUMN",
            "SIMILAR_TO",
            "METRIC",
            "TOP_N",
            "L",
            "M",
            "START_ID",
        ]);
        expect(select.from[0].table.vectorSearch.parameters[0].tableAlias).toBe("SOURCE");
    });

    test("parses FETCH APPROX with VECTOR_SEARCH", () => {
        const result = parseResult(`
            SELECT ann.distance
            FROM VECTOR_SEARCH(
                TABLE = dbo.Products,
                COLUMN = Embedding,
                SIMILAR_TO = @query,
                METRIC = 'cosine'
            ) AS ann
            ORDER BY ann.distance
            OFFSET 0 ROWS FETCH APPROX FIRST 10 ROWS ONLY;
        `);

        expect(result.issues).toEqual([]);
        expect((result.ast.body[0] as any).fetchApproximate).toBe(true);
    });

    test("parses the VECTOR_SEARCH FORCE_ANN_ONLY hint", () => {
        const result = parseResult(`
            SELECT * FROM VECTOR_SEARCH(
                TABLE = dbo.Products,
                COLUMN = Embedding,
                SIMILAR_TO = @query,
                METRIC = 'cosine'
            ) AS ann WITH (FORCE_ANN_ONLY);
        `);
        expect(result.issues).toEqual([]);
        expect((result.ast.body[0] as any).from[0].hints).toEqual(["FORCE_ANN_ONLY"]);
    });

    test("parses CREATE VECTOR INDEX and validates METRIC", () => {
        const valid = parseResult(`
            CREATE VECTOR INDEX IX_Embedding ON dbo.Products(Embedding)
            WITH (METRIC = 'cosine', TYPE = 'DiskANN', MAXDOP = 1, R = 48, L = 50, M = 4);
        `);
        expect(valid.issues).toEqual([]);
        expect(valid.ast.body[0]).toMatchObject({
            type: "CreateIndexStatement",
            indexKind: "VECTOR",
            name: "IX_Embedding",
        });

        const invalid = analyze("CREATE VECTOR INDEX IX ON dbo.T(Embedding)").semanticDiagnostics;
        expect(invalid).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: DiagnosticCode.InvalidSpecializedIndex,
                    message: expect.stringContaining("METRIC"),
                }),
            ]),
        );
    });

    test.each([
        ["SELECT VECTOR_DISTANCE('cosine', @left)", "VECTOR_DISTANCE"],
        ["SELECT VECTOR_NORM(@left)", "VECTOR_NORM"],
        ["SELECT VECTOR_NORMALIZE(@left, 'norm2', 1)", "VECTOR_NORMALIZE"],
    ])("diagnoses invalid vector function arity: %s", (sql, functionName) => {
        const diagnostics = analyze(sql).semanticDiagnostics.filter(
            (diagnostic) => diagnostic.code === DiagnosticCode.InvalidVectorFunctionArgument,
        );
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].message).toContain(functionName);
    });

    test("diagnoses malformed VECTOR_SEARCH parameter contracts", () => {
        const diagnostics = analyze(`
            SELECT * FROM VECTOR_SEARCH(
                TABL = dbo.Products,
                SIMILAR_TO = @query,
                COLUMN = dbo.Embedding,
                METRIC = @metric
            ) AS ann;
        `).semanticDiagnostics;
        const vectorDiagnostics = diagnostics.filter(
            (diagnostic) => diagnostic.code === DiagnosticCode.InvalidVectorSearch,
        );
        expect(vectorDiagnostics.map((diagnostic) => diagnostic.message)).toEqual(
            expect.arrayContaining([
                expect.stringContaining("requires the TABLE parameter"),
                expect.stringContaining("'TABL' is not a valid"),
                expect.stringContaining("must appear in that order"),
                expect.stringContaining("one-part column name"),
                expect.stringContaining("METRIC parameter"),
            ]),
        );
    });

    test("diagnoses approximate retrieval without VECTOR_SEARCH", () => {
        const diagnostics = analyze("SELECT TOP (5) WITH APPROX * FROM dbo.Products");
        expect(diagnostics.semanticDiagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: DiagnosticCode.InvalidApproximateQuery,
                    message: expect.stringContaining("requires VECTOR_SEARCH"),
                }),
            ]),
        );
    });

    test("diagnoses approximate retrieval ordered by a non-distance column", () => {
        const diagnostics = analyze(`
            SELECT TOP (5) WITH APPROX ann.ProductId
            FROM VECTOR_SEARCH(
                TABLE = dbo.Products,
                COLUMN = Embedding,
                SIMILAR_TO = @query,
                METRIC = 'cosine'
            ) AS ann
            ORDER BY ann.ProductId;
        `).semanticDiagnostics;
        expect(diagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: DiagnosticCode.InvalidApproximateQuery,
                    message: expect.stringContaining("distance column"),
                }),
            ]),
        );
    });
});
