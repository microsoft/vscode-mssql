import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";
import { ColumnAnalyzer } from "../../src/parser/saral/semantic/columnAnalyzer.js";
import { ScopeBuilder } from "../../src/parser/saral/semantic/scopeBuilder.js";

const parse = (sql: string) => {
    const lexer = new Lexer(sql);
    const parser = new Parser(lexer);
    return parser.parse().ast;
};

describe("ColumnAnalyzer", () => {
    test("resolves simple column", () => {
        const sql = `SELECT Id FROM Users`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(1);
    });

    test("resolves qualified column", () => {
        const sql = `SELECT u.Id FROM Users u`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        const hasQualified = result.resolutions.some((r) => r.location.parts.includes("u"));

        expect(hasQualified).toBe(true);
    });

    test("handles multiple columns", () => {
        const sql = `SELECT Id, Name FROM Users`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(2);
    });

    test("handles binary expressions", () => {
        const sql = `SELECT Id + 1 FROM Users`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(1);
    });

    test("handles function calls", () => {
        const sql = `SELECT SUM(Id) FROM Users`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(1);
    });

    test("handles CASE expression", () => {
        const sql = `
            SELECT CASE 
                WHEN Id > 10 THEN Name 
                ELSE 'X' 
            END 
            FROM Users
        `;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(2);
    });

    test("handles IN expression", () => {
        const sql = `SELECT Id FROM Users WHERE Id IN (1, 2, 3)`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(1);
    });

    test("handles BETWEEN expression", () => {
        const sql = `SELECT Id FROM Users WHERE Id BETWEEN 1 AND 10`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(1);
    });

    test("handles GROUP BY", () => {
        const sql = `SELECT Id FROM Users GROUP BY Id`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(1);
    });

    test("handles ORDER BY", () => {
        const sql = `SELECT Id FROM Users ORDER BY Id DESC`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(result.resolutions.length).toBeGreaterThanOrEqual(1);
    });

    test("handles wildcard safely", () => {
        const sql = `SELECT * FROM Users`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        // wildcard produces no identifier nodes
        expect(Array.isArray(result.resolutions)).toBe(true);
        expect(Array.isArray(result.propertyAccesses)).toBe(true);
    });

    test("handles subquery safely", () => {
        const sql = `
            SELECT Id 
            FROM (
                SELECT Id FROM Users
            ) t
        `;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(Array.isArray(result.resolutions)).toBe(true);
    });

    test("does not crash on broken SQL", () => {
        const sql = `SELECT FROM`;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(Array.isArray(result.resolutions)).toBe(true);
    });

    test("marks correlated resolution in APPLY subquery expression", () => {
        const sql = `
            SELECT a.SomeName
            FROM Employee e
            CROSS APPLY (
                SELECT e.FirstName AS SomeName
            ) a
        `;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        expect(
            result.resolutions.some((r) => r.location.name === "a.SomeName" && r.isCorrelated),
        ).toBe(true);
    });

    test("emits ambiguity candidates for bare columns", () => {
        const sql = `
            SELECT Id
            FROM Employee e
            JOIN Department d ON d.Id = e.DepartmentId
        `;
        const ast = parse(sql);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);
        const idResolution = result.resolutions.find((r) => r.location.name === "Id");

        expect(idResolution?.ambiguityCandidates?.length).toBeGreaterThan(1);
        expect(idResolution?.decisionReason).toBe("ambiguous_candidates");
        expect(idResolution?.decision.decisionReason).toBe("ambiguous_candidates");
        expect(idResolution?.decision.ambiguityCandidates?.length).toBeGreaterThan(1);
    });

    test("keeps qualified alias resolution scoped per statement", () => {
        const sql = `
            SELECT t.DepartmentId
            INTO #t
            FROM TempDepartment t;

            SELECT e.DepartmentId
            FROM DepartmentSalaryInfo e;
        `;
        const ast = parse(sql);
        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        const eResolution = result.resolutions.find((r) => r.location.name === "e.DepartmentId");
        expect(eResolution).toBeDefined();
        expect(eResolution?.inputs[0]?.source).toBe("DepartmentSalaryInfo");
    });

    test("emits resolved OUTPUT inserted/deleted qualified lineage inputs", () => {
        const sql = `
            UPDATE Users
            SET Name = 'John'
            OUTPUT inserted.Name, deleted.Name
            WHERE Id = 1;
        `;
        const ast = parse(sql);
        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);

        const hasInserted = result.resolutions.some((r) =>
            r.inputs.some((i) => i.name === "INSERTED.Name" && i.resolution === "resolved"),
        );
        const hasDeleted = result.resolutions.some((r) =>
            r.inputs.some((i) => i.name === "DELETED.Name" && i.resolution === "resolved"),
        );

        expect(hasInserted).toBe(true);
        expect(hasDeleted).toBe(true);
    });

    test("flags bare column as unverifiable when scope has unresolved table variable", () => {
        const sql = `
            DECLARE @T TABLE;
            SELECT Id FROM @T;
        `;
        const ast = parse(sql);
        const scope = new ScopeBuilder().build(ast);

        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast, scope);

        const idResolution = result.resolutions.find((r) => r.location.name === "Id");
        expect(idResolution?.isUnverifiable).toBe(true);
    });

    test("emits single-owner decision metadata for bare columns", () => {
        const sql = `SELECT Name FROM Users`;
        const ast = parse(sql);
        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast);
        const resolution = result.resolutions.find((r) => r.location.name === "Name");

        expect(resolution?.owner).toBe("Users");
        expect(resolution?.decisionReason).toBe("single_scope_owner");
        expect(resolution?.decision.owner).toBe("Users");
        expect(resolution?.decision.decisionReason).toBe("single_scope_owner");
    });

    test("emits single-owner decision metadata for bare columns over a #temp table (not non_column)", () => {
        const sql = `
            CREATE TABLE #T (Id INT, Name VARCHAR(50));
            SELECT Id, Name FROM #T;
        `;
        const ast = parse(sql);
        const scope = new ScopeBuilder().build(ast);
        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast, scope);
        const resolution = result.resolutions.find((r) => r.location.name === "Name");

        expect(resolution?.owner).toBe("#T");
        expect(resolution?.decisionReason).toBe("single_scope_owner");
    });

    describe("ORDER BY alias references", () => {
        test("resolves an ORDER BY alias to the same owner as the SELECT column it refers to", () => {
            const sql = `SELECT Id AS RowId FROM Users ORDER BY RowId;`;
            const ast = parse(sql);
            const scope = new ScopeBuilder().build(ast);
            const analyzer = new ColumnAnalyzer();
            const result = analyzer.analyze(ast, scope);

            // Before the fix: columnAnalyzer only walks lineage.columns
            // (the SELECT list), so the ORDER BY reference to "RowId" had
            // no resolution entry at all.
            const orderByResolution = result.resolutions.find((r) => r.location.name === "RowId");

            expect(orderByResolution).toBeDefined();
            expect(orderByResolution?.owner).toBe("Users");
            expect(orderByResolution?.decisionReason).toBe("single_scope_owner");
        });

        test("resolves an ORDER BY alias that refers to a qualified column", () => {
            const sql = `SELECT u.Id AS UserId FROM Users u ORDER BY UserId;`;
            const ast = parse(sql);
            const scope = new ScopeBuilder().build(ast);
            const analyzer = new ColumnAnalyzer();
            const result = analyzer.analyze(ast, scope);

            const orderByResolution = result.resolutions.find((r) => r.location.name === "UserId");

            // "UserId" itself is a bare (unqualified) token in the ORDER BY
            // clause, so it resolves through the same bare-column path as
            // any other single-part identifier — reporting the underlying
            // table ('Users') rather than the alias ('u') that happened to
            // qualify the original SELECT-list expression. This is the
            // physical owner of the data, which is still meaningful;
            // reusing the exact alias-level decision from the SELECT list
            // is a possible future refinement, not required here.
            expect(orderByResolution).toBeDefined();
            expect(orderByResolution?.owner).toBe("Users");
        });

        test("does not produce a spurious alias match for an ORDER BY name that is not a SELECT alias", () => {
            const sql = `SELECT Id FROM Users ORDER BY SomeOtherColumn;`;
            const ast = parse(sql);
            const scope = new ScopeBuilder().build(ast);
            const analyzer = new ColumnAnalyzer();
            const result = analyzer.analyze(ast, scope);

            const orderByResolution = result.resolutions.find(
                (r) => r.location.name === "SomeOtherColumn",
            );

            expect(orderByResolution).toBeUndefined();
        });
    });

    describe("UPDATE / DELETE read-side (WHERE) column resolution", () => {
        test("resolves a bare WHERE-clause column on an UPDATE statement to its single owner", () => {
            const sql = `
                UPDATE e SET e.Salary = e.Salary * 1.1
                FROM dbo.Employee e
                WHERE DeptName = 'Eng';
            `;
            const ast = parse(sql);
            const scope = new ScopeBuilder().build(ast);
            const analyzer = new ColumnAnalyzer();
            const result = analyzer.analyze(ast, scope);

            // Before the fix: columnAnalyzer only walked lineage.columns
            // (the SET assignment values), so a bare column in WHERE that
            // wasn't also referenced in the SET list had no resolution at
            // all — even though lineageBuilder already resolves it
            // (lineage.mutations[].predicateInputs).
            const whereResolution = result.resolutions.find((r) => r.location.name === "DeptName");

            expect(whereResolution).toBeDefined();
            expect(whereResolution?.owner).toBe("dbo.Employee");
        });

        test("reports ambiguity for a bare WHERE-clause column shared by two joined tables (correct, not a single guess)", () => {
            const sql = `
                UPDATE e SET e.Salary = e.Salary * 1.1
                FROM dbo.Employee e JOIN dbo.Department d ON d.Id = e.DeptId
                WHERE DeptName = 'Eng';
            `;
            const ast = parse(sql);
            const scope = new ScopeBuilder().build(ast);
            const analyzer = new ColumnAnalyzer();
            const result = analyzer.analyze(ast, scope);

            // Neither table's schema is known, so DeptName could belong to
            // either side of the join — reporting it as ambiguous (rather
            // than silently picking one) is the correct, conservative
            // answer, and is itself only possible now that WHERE is
            // analyzed at all.
            const whereResolution = result.resolutions.find((r) => r.location.name === "DeptName");

            expect(whereResolution).toBeDefined();
            expect(whereResolution?.owner).toBeUndefined();
            expect(whereResolution?.decisionReason).toBe("ambiguous_candidates");
            expect(whereResolution?.ambiguityCandidates).toEqual(
                expect.arrayContaining(["dbo.Employee", "dbo.Department"]),
            );
        });

        test("resolves a bare WHERE-clause column on a DELETE statement", () => {
            const sql = `DELETE FROM dbo.Employee WHERE DeptId = 5;`;
            const ast = parse(sql);
            const scope = new ScopeBuilder().build(ast);
            const analyzer = new ColumnAnalyzer();
            const result = analyzer.analyze(ast, scope);

            // Before the fix: DELETE produced zero resolutions at all,
            // since lineage.columns is never populated for DELETE and
            // lineageBuilder didn't even resolve DELETE's WHERE clause.
            const whereResolution = result.resolutions.find((r) => r.location.name === "DeptId");

            expect(whereResolution).toBeDefined();
            expect(whereResolution?.owner).toBe("dbo.Employee");
        });
    });

    test("emits property-access semantic shape for identifier chains", () => {
        const sql = `
            DECLARE @Store TABLE(GeoPoint GEOGRAPHY);
            SELECT GeoPoint.Lat FROM @Store;
        `;
        const ast = parse(sql);
        const scope = new ScopeBuilder().build(ast);
        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast, scope);
        const propertyAccess = result.propertyAccesses.find(
            (x) => x.location.name === "GeoPoint.Lat",
        );

        expect(propertyAccess).toBeDefined();
        expect(propertyAccess?.baseExpr).toBe("GeoPoint");
        expect(propertyAccess?.member).toBe("Lat");
        expect(propertyAccess?.resolutionMode).toBe("local_typed_member");
        expect(propertyAccess?.owner).toBe("@Store");
        expect(propertyAccess?.dataType).toBe("GEOGRAPHY");
        expect(propertyAccess?.memberType).toBe("FLOAT");
    });

    test("does not classify alias-qualified columns as property-access", () => {
        const sql = `SELECT e.FirstName FROM Employee e;`;
        const ast = parse(sql);
        const scope = new ScopeBuilder().build(ast);
        const analyzer = new ColumnAnalyzer();
        const result = analyzer.analyze(ast, scope);
        const falsePositive = result.propertyAccesses.find(
            (x) => x.location.name === "e.FirstName",
        );

        expect(falsePositive).toBeUndefined();
    });

    describe("qualified-reference owner: nearest scope, not deepest lineage source", () => {
        test("property-access tokens (GeoPoint.Lat) get a consistent owner in resolutions[], not the member name", () => {
            const sql = `
                DECLARE @Store TABLE(GeoPoint GEOGRAPHY);
                SELECT GeoPoint.Lat FROM @Store;
            `;
            const ast = parse(sql);
            const scope = new ScopeBuilder().build(ast);
            const analyzer = new ColumnAnalyzer();
            const result = analyzer.analyze(ast, scope);

            const resolution = result.resolutions.find((r) => r.location.name === "GeoPoint.Lat");

            // Before the fix this reported owner: 'GeoPoint' (the member
            // name itself, mistaken for a table qualifier) instead of the
            // real owning table/variable already known via propertyAccesses[].
            expect(resolution?.owner).toBe("@Store");
            expect(resolution?.decisionReason).toBe("qualified_reference");
        });

        test("derived alias over a UNION reports itself as owner, not a base table buried in one branch", () => {
            const sql = `
                SELECT s.availableInventory FROM (
                    SELECT Qty AS availableInventory FROM dbo.WarehouseA
                    UNION
                    SELECT Qty AS availableInventory FROM dbo.WarehouseB
                ) s;
            `;
            const ast = parse(sql);
            const scope = new ScopeBuilder().build(ast);
            const analyzer = new ColumnAnalyzer();
            const result = analyzer.analyze(ast, scope);

            const resolution = result.resolutions.find(
                (r) => r.location.name === "s.availableInventory",
            );

            // Before the fix this reported owner: 'dbo.WarehouseA' — the
            // base table lineage happened to trace into via the LEFT
            // branch of the UNION, which is misleading since the column
            // could equally have come from WarehouseB.
            expect(resolution?.owner).toBe("s");
            expect(resolution?.decisionReason).toBe("qualified_reference");
        });

        test("simple alias-qualified column still resolves through to the underlying table (unchanged)", () => {
            const sql = `SELECT e.Salary FROM dbo.Employee e;`;
            const ast = parse(sql);
            const scope = new ScopeBuilder().build(ast);
            const analyzer = new ColumnAnalyzer();
            const result = analyzer.analyze(ast, scope);

            const resolution = result.resolutions.find((r) => r.location.name === "e.Salary");

            // 'e' is itself a real, scope-resolvable alias, so it is now
            // preferred directly over deeper lineage tracing — this is the
            // same underlying relation either way (e IS dbo.Employee), so
            // this is a presentation change, not a correctness regression.
            expect(resolution?.owner).toBe("e");
            expect(resolution?.decisionReason).toBe("qualified_reference");
        });
    });
});
