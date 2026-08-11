import { analyze, DiagnosticCode } from "../../src/parser/saral/index.js";
import { parseResult } from "./parser.helpers.js";

// Independently authored regression cases based on the feature matrix in SqlParser's
// SystemScalarFunctionsParserTests/Json.xml and JsonIndex/CreateJsonIndex.xml suites.
describe("modern SQL Server JSON grammar", () => {
    test("parses constructors, aggregates, null handling, and RETURNING json", () => {
        const result = parseResult(`
            SELECT
                JSON_ARRAY(1, 2, NULL ABSENT ON NULL RETURNING json),
                JSON_OBJECT('name': Name NULL ON NULL RETURNING json),
                JSON_ARRAYAGG(Id NULL ON NULL RETURNING json),
                JSON_OBJECTAGG(Name: Id ABSENT ON NULL RETURNING json)
            FROM dbo.Products;
        `);

        expect(result.issues).toEqual([]);
        const statement = result.ast.body[0] as any;
        expect(statement.columns.map((column: any) => column.expression.name)).toEqual([
            "JSON_ARRAY",
            "JSON_OBJECT",
            "JSON_ARRAYAGG",
            "JSON_OBJECTAGG",
        ]);
        expect(statement.columns[0].expression.jsonClause).toMatchObject({
            nullHandling: "ABSENT ON NULL",
            returningType: "JSON",
        });
        expect(statement.columns[1].expression.jsonClause.entries).toHaveLength(1);
    });

    test("parses JSON_QUERY array wrappers and JSON_VALUE returning types", () => {
        const result = parseResult(`
            SELECT
                JSON_QUERY('{"a":"b"}', '$.a' WITH ARRAY WRAPPER),
                JSON_VALUE('{"a":"123"}', '$.a' RETURNING nvarchar(max));
        `);

        expect(result.issues).toEqual([]);
        const statement = result.ast.body[0] as any;
        expect(statement.columns[0].expression.jsonClause.arrayWrapper).toBe(true);
        expect(statement.columns[1].expression.jsonClause.returningType).toBe("NVARCHAR(max)");
    });

    test("parses CREATE JSON INDEX paths and supported options", () => {
        const result = parseResult(`
            CREATE JSON INDEX IX_Payload ON dbo.Products(Payload)
            FOR ('$.name', '$.tags[*]')
            WITH (OPTIMIZE_FOR_ARRAY_SEARCH = ON, ALLOW_PAGE_LOCKS = OFF);
        `);

        expect(result.issues).toEqual([]);
        expect(result.ast.body[0]).toMatchObject({
            type: "CreateIndexStatement",
            indexKind: "JSON",
            name: "IX_Payload",
        });
        expect((result.ast.body[0] as any).jsonPaths).toHaveLength(2);
    });

    test.each([
        ["SELECT JSON_MODIFY('{}', '$.a')", "JSON_MODIFY"],
        ["SELECT JSON_PATH_EXISTS('{}')", "JSON_PATH_EXISTS"],
        ["SELECT JSON_CONTAINS('{}')", "JSON_CONTAINS"],
    ])("diagnoses invalid JSON function arity: %s", (sql, functionName) => {
        const diagnostics = analyze(sql).semanticDiagnostics.filter(
            (diagnostic) => diagnostic.code === DiagnosticCode.InvalidJsonFunctionArgument,
        );
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].message).toContain(functionName);
    });

    test("diagnoses an invalid ISJSON type constraint", () => {
        const diagnostics = analyze("SELECT ISJSON('{}', RANDOM)").semanticDiagnostics;
        expect(diagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: DiagnosticCode.InvalidJsonFunctionArgument,
                    message: expect.stringContaining("VALUE, ARRAY, OBJECT, or SCALAR"),
                }),
            ]),
        );
    });

    test("diagnoses unsupported JSON index options", () => {
        const diagnostics = analyze(
            "CREATE JSON INDEX IX ON dbo.T(Payload) WITH (CHANGE_TRACKING = ON)",
        ).semanticDiagnostics;
        expect(diagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: DiagnosticCode.InvalidSpecializedIndex,
                    message: expect.stringContaining("CHANGE_TRACKING"),
                }),
            ]),
        );
    });
});
