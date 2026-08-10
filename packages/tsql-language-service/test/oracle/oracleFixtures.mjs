/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Engine-neutral editor behavior fixtures derived from an audit of SqlParser's observable tests.
 *
 * The SQL and expectations below were independently authored with synthetic object names. The
 * `provenance` entries identify behavioral inspiration; they are not runtime dependencies and no
 * SqlParser implementation or baseline output is reproduced here.
 */

export const oracleAreas = Object.freeze([
    "diagnostics",
    "recovery",
    "hover",
    "navigation",
    "completion",
    "dml-ddl",
    "go-temp",
    "incremental",
]);

export const oracleCatalog = deepFreeze({
    world: "closed",
    database: "OracleDb",
    schemas: {
        dbo: {
            Customers: {
                CustomerId: { type: "int", nullable: false },
                DisplayName: { type: "nvarchar(120)", nullable: false },
                CreditLimit: { type: "decimal(12,2)", nullable: true },
                IsActive: { type: "bit", nullable: false },
            },
            AuditLog: {
                AuditId: { type: "bigint", nullable: false },
                CustomerId: { type: "int", nullable: false },
                Message: { type: "nvarchar(max)", nullable: true },
            },
        },
        Sales: {
            Invoices: {
                InvoiceId: { type: "int", nullable: false },
                CustomerId: { type: "int", nullable: false },
                Amount: { type: "decimal(12,2)", nullable: false },
                IssuedAt: { type: "datetime2", nullable: false },
            },
        },
    },
    procedures: {
        "dbo.ArchiveCustomer": {
            parameters: [{ name: "@CustomerId", type: "int" }],
        },
    },
    functions: {
        "dbo.CustomerBalance": {
            parameters: [{ name: "@CustomerId", type: "int" }],
            returnType: "decimal(12,2)",
        },
    },
});

const invalidObjectSources = Object.freeze([
    "src/FunctionalTest/RadParserTest/TestFiles/Input/InvalidObjectName/InvalidObjectsInFromClauseTests/TablesAndViews.xml",
    "src/FunctionalTest/RadParserTest/SkippedTestFiles/InvalidObjectName/InvalidObjectsInSelectClause.xml",
]);
const invalidExecSource =
    "src/FunctionalTest/RadParserTest/TestFiles/Input/InvalidObjectName/InvalidObjectsInExecClauseTests/Simple.xml";
const completionSources = Object.freeze([
    "src/FunctionalTest/RadParserTest/CompletionListTest.cs",
    "src/FunctionalTest/RadParserTest/TestFiles/Input/Intellisense/Level1Verification/CompletionListBVTTests/ColumnRefInSelectClause.xml",
]);
const tooltipSource =
    "src/FunctionalTest/RadParserTest/SkippedTestFiles/Intellisense/UILevel1Verification/TooltipInfoUI.xml";
const incrementalSource = "src/FunctionalTest/RadParserTest/CycleGuardTest.cs";

export const oracleFixtures = deepFreeze([
    fixture(
        "diag-unknown-select-source",
        "diagnostics",
        "P0",
        "SELECT * FROM dbo.MissingCustomers;",
        [diagnostic("unknown-object", selector("dbo.MissingCustomers"), 1)],
        invalidObjectSources,
    ),
    fixture(
        "diag-unknown-projected-column",
        "diagnostics",
        "P0",
        "SELECT c.MissingName FROM dbo.Customers AS c;",
        [diagnostic("unknown-column", selector("MissingName"), 1)],
        invalidObjectSources,
    ),
    fixture(
        "diag-ambiguous-join-column",
        "diagnostics",
        "P0",
        "SELECT CustomerId FROM dbo.Customers AS c JOIN Sales.Invoices AS i ON i.CustomerId = c.CustomerId;",
        [diagnostic("ambiguous-column", selector("CustomerId", 0), 1)],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/InvalidObjectName/InvalidObjectsInFromClauseTests/Joins.xml",
        ],
    ),
    fixture(
        "diag-unknown-exec-target",
        "diagnostics",
        "P0",
        "EXEC dbo.MissingArchive @CustomerId = 7;",
        [diagnostic("unknown-object", selector("dbo.MissingArchive"), 1)],
        [invalidExecSource],
    ),
    ...[
        ["insert", "INSERT INTO dbo.MissingTarget (CustomerId) VALUES (7);"],
        ["update", "UPDATE dbo.MissingTarget SET CustomerId = 7;"],
        ["delete", "DELETE FROM dbo.MissingTarget WHERE CustomerId = 7;"],
        [
            "merge",
            "MERGE dbo.MissingTarget AS t USING dbo.Customers AS s ON t.CustomerId = s.CustomerId WHEN MATCHED THEN DELETE;",
        ],
    ].map(([operation, sql]) =>
        fixture(
            `diag-unknown-${operation}-target`,
            "diagnostics",
            "P0",
            sql,
            [
                mutationTarget(operation, selector("dbo.MissingTarget")),
                diagnostic("unknown-object", selector("dbo.MissingTarget"), 1),
            ],
            ["src/FunctionalTest/RadParserTest/TestFiles/Input/DML", ...invalidObjectSources],
        ),
    ),
    fixture(
        "diag-clean-correlated-query",
        "diagnostics",
        "P0",
        "SELECT c.CustomerId FROM dbo.Customers AS c WHERE EXISTS (SELECT 1 FROM Sales.Invoices AS i WHERE i.CustomerId = c.CustomerId);",
        [{ kind: "diagnostic-set", exact: [] }],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/Intellisense/Level1Verification/WhereClause/Where_Two_Predicates3Tests/WhereTwoPredicatesThree.xml",
        ],
    ),

    fixture(
        "recovery-incomplete-where-at-eof",
        "recovery",
        "P0",
        "SELECT CustomerId FROM dbo.Customers WHERE",
        [diagnostic("syntax", eof(), 1), { kind: "no-throw" }],
        ["src/FunctionalTest/RadParserTest/ParserTest.cs"],
    ),
    fixture(
        "recovery-broken-middle-preserves-tail",
        "recovery",
        "P0",
        "SELECT c.CustomerId FROM dbo.Customers AS c WHERE c.CustomerId = ;\nSELECT AuditId FROM dbo.AuditLog;",
        [
            diagnostic("syntax", selector("="), 1),
            { kind: "statement-preserved", target: selector("SELECT AuditId") },
            { kind: "no-throw" },
        ],
        ["src/FunctionalTest/RadParserTest/ParserTest.cs", incrementalSource],
    ),
    fixture(
        "recovery-malformed-insert-tree-safe",
        "recovery",
        "P0",
        "INSERT INTO VALUES (1, 2,",
        [diagnostic("syntax", selector("VALUES"), 1), { kind: "no-throw" }],
        [incrementalSource],
    ),
    fixture(
        "recovery-incomplete-alias-keeps-completion",
        "recovery",
        "P0",
        "SELECT * FROM dbo.Customers AS c JOIN Sales.Invoices AS i ON i.",
        [
            diagnostic("syntax", eof(), 1),
            completion(
                eof(),
                ["InvoiceId", "CustomerId", "Amount", "IssuedAt"],
                ["DisplayName", "CreditLimit"],
            ),
        ],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/Intellisense/Level1Verification/CompletionListBVTTests/ColumnsInJoinClauses.xml",
            "src/FunctionalTest/RadParserTest/ParserTest.cs",
        ],
    ),

    fixture(
        "hover-catalog-column-type",
        "hover",
        "P0",
        "SELECT c.DisplayName FROM dbo.Customers AS c;",
        [hover(selector("DisplayName"), "nvarchar(120)", "dbo.Customers.DisplayName")],
        [tooltipSource],
    ),
    fixture(
        "hover-preserves-decimal-precision-scale",
        "hover",
        "P0",
        "SELECT i.Amount FROM Sales.Invoices AS i;",
        [hover(selector("Amount"), "decimal(12,2)", "Sales.Invoices.Amount")],
        [
            tooltipSource,
            "src/FunctionalTest/RadParserTest/TestFiles/DatabaseCache/DataTypeTablesDatabase.xml",
        ],
    ),
    fixture(
        "hover-variable-declared-type",
        "hover",
        "P0",
        "DECLARE @limit numeric(10,3); SELECT @limit;",
        [hover(selector("@limit", 1), "numeric(10,3)", "@limit")],
        [tooltipSource],
    ),
    fixture(
        "hover-aggregate-result-type",
        "hover",
        "P1",
        "SELECT MAX(i.Amount) FROM Sales.Invoices AS i;",
        [hover(selector("MAX(i.Amount)"), "decimal(12,2)", "MAX")],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/Intellisense/Level1Verification/DataTypes/SelectAGGTests/BuildInAgg.xml",
        ],
    ),

    fixture(
        "nav-variable-definition-and-references",
        "navigation",
        "P0",
        "DECLARE @minimum decimal(12,2) = 10; SELECT InvoiceId FROM Sales.Invoices WHERE Amount > @minimum; SELECT @minimum;",
        [
            definition(selector("@minimum", 1), selector("@minimum", 0)),
            references(selector("@minimum", 1), [
                selector("@minimum", 0),
                selector("@minimum", 1),
                selector("@minimum", 2),
            ]),
        ],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Baseline/Parser/XmlExpressions/XML_Variable/Variation_6.xml",
        ],
    ),
    fixture(
        "nav-cte-definition-and-references",
        "navigation",
        "P0",
        "WITH RecentInvoices AS (SELECT InvoiceId, CustomerId FROM Sales.Invoices) SELECT r.InvoiceId FROM RecentInvoices AS r;",
        [
            definition(selector("RecentInvoices", 1), selector("RecentInvoices", 0)),
            references(selector("RecentInvoices", 1), [
                selector("RecentInvoices", 0),
                selector("RecentInvoices", 1),
            ]),
        ],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/CTE",
            "src/FunctionalTest/RadParserTest/TestFiles/Input/Intellisense/Level1Verification/CompletionListBVTTests/ColumnsInDerivedTable.xml",
        ],
    ),
    fixture(
        "nav-derived-column-definition",
        "navigation",
        "P0",
        "SELECT x.TotalAmount FROM (SELECT SUM(Amount) AS TotalAmount FROM Sales.Invoices) AS x;",
        [definition(selector("TotalAmount", 0), selector("TotalAmount", 1))],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/Intellisense/Level1Verification/CompletionListBVTTests/ColumnsInDerivedTable.xml",
            "src/FunctionalTest/RadParserTest/TestFiles/Input/DerivedTableColumnBindingTests",
        ],
    ),
    fixture(
        "nav-table-variable-column",
        "navigation",
        "P1",
        "DECLARE @selected TABLE (CustomerId int); SELECT s.CustomerId FROM @selected AS s;",
        [
            definition(selector("CustomerId", 1), selector("CustomerId", 0)),
            references(selector("@selected", 1), [
                selector("@selected", 0),
                selector("@selected", 1),
            ]),
        ],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/TableVariableBindingTests/SelectFromSingleTableVariable.xml",
        ],
    ),

    fixture(
        "completion-qualified-alias-columns",
        "completion",
        "P0",
        "SELECT c. FROM dbo.Customers AS c;",
        [
            completion(
                selector("c."),
                ["CustomerId", "DisplayName", "CreditLimit", "IsActive"],
                ["InvoiceId", "Amount"],
            ),
        ],
        completionSources,
    ),
    fixture(
        "completion-derived-table-columns",
        "completion",
        "P0",
        "SELECT x. FROM (SELECT InvoiceId, Amount AS TotalAmount FROM Sales.Invoices) AS x;",
        [completion(selector("x."), ["InvoiceId", "TotalAmount"], ["IssuedAt"])],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/Intellisense/Level1Verification/CompletionListBVTTests/ColumnsInDerivedTable.xml",
        ],
    ),
    fixture(
        "completion-insert-target-columns",
        "completion",
        "P0",
        "INSERT INTO dbo.Customers (",
        [completion(eof(), ["CustomerId", "DisplayName", "CreditLimit", "IsActive"], [])],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/DML/InsertTests/Insert_BVT.xml",
            ...completionSources,
        ],
    ),
    fixture(
        "completion-group-by-source-columns",
        "completion",
        "P1",
        "SELECT CustomerId, COUNT(*) FROM Sales.Invoices GROUP BY ",
        [completion(eof(), ["InvoiceId", "CustomerId", "Amount", "IssuedAt"], ["DisplayName"])],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/Intellisense/Level1Verification/CompletionListBVTTests/ColumnsInGroupByClauses.xml",
        ],
    ),
    fixture(
        "completion-cte-source",
        "completion",
        "P1",
        "WITH CurrentCustomers AS (SELECT CustomerId FROM dbo.Customers) SELECT * FROM Current",
        [completion(eof(), ["CurrentCustomers"], [])],
        ["src/FunctionalTest/RadParserTest/TestFiles/Input/CTE", ...completionSources],
    ),

    fixture(
        "dml-update-joined-source",
        "dml-ddl",
        "P0",
        "UPDATE c SET CreditLimit = i.Amount FROM dbo.Customers AS c JOIN Sales.Invoices AS i ON i.CustomerId = c.CustomerId WHERE i.Amount > 0;",
        [
            mutationTarget("update", selector("c", 0), "dbo.Customers"),
            { kind: "diagnostic-set", exact: [] },
        ],
        ["src/FunctionalTest/RadParserTest/TestFiles/Input/DML/UpdateTests/SetClause.xml"],
    ),
    fixture(
        "dml-delete-joined-source",
        "dml-ddl",
        "P0",
        "DELETE c FROM dbo.Customers AS c JOIN dbo.AuditLog AS a ON a.CustomerId = c.CustomerId WHERE a.AuditId < 10;",
        [
            mutationTarget("delete", selector("c", 0), "dbo.Customers"),
            { kind: "diagnostic-set", exact: [] },
        ],
        ["src/FunctionalTest/RadParserTest/TestFiles/Input/DML/DeleteTests/FromClause.xml"],
    ),
    fixture(
        "dml-merge-output-pseudo-tables",
        "dml-ddl",
        "P0",
        "MERGE dbo.Customers AS target USING dbo.AuditLog AS source ON target.CustomerId = source.CustomerId WHEN MATCHED THEN UPDATE SET target.IsActive = 0 WHEN NOT MATCHED THEN INSERT (CustomerId, DisplayName, IsActive) VALUES (source.CustomerId, N'new', 1) OUTPUT $action, inserted.CustomerId, deleted.CustomerId;",
        [
            mutationTarget("merge", selector("dbo.Customers")),
            {
                kind: "symbol",
                at: selector("inserted.CustomerId"),
                symbolKind: "column",
                source: "inserted",
            },
            {
                kind: "symbol",
                at: selector("deleted.CustomerId"),
                symbolKind: "column",
                source: "deleted",
            },
            { kind: "diagnostic-set", exact: [] },
        ],
        ["src/FunctionalTest/RadParserTest/TestFiles/Input/DML/MergeTests/Merge_BVT.xml"],
    ),
    fixture(
        "ddl-create-then-select-position-aware",
        "dml-ddl",
        "P0",
        "CREATE TABLE dbo.SessionItems (ItemId int, Label nvarchar(50)); SELECT Label FROM dbo.SessionItems;",
        [
            { kind: "object-visible", name: "dbo.SessionItems", at: selector("SELECT Label") },
            hover(selector("Label", 1), "nvarchar(50)", "dbo.SessionItems.Label"),
            { kind: "diagnostic-set", exact: [] },
        ],
        [
            "src/FunctionalTest/RadParserTest/SkippedTestFiles/Intellisense/UILevel1Verification/TooltipInfoUI.xml",
            "src/FunctionalTest/RadParserTest/TestFiles/Input/createAndAlterTableTests",
        ],
    ),
    fixture(
        "ddl-drop-invalidates-later-reference",
        "dml-ddl",
        "P0",
        "CREATE TABLE dbo.SessionItems (ItemId int); DROP TABLE dbo.SessionItems; SELECT * FROM dbo.SessionItems;",
        [
            diagnostic("unknown-object", selector("dbo.SessionItems", 2), 1),
            { kind: "object-hidden", name: "dbo.SessionItems", at: selector("SELECT *") },
        ],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/DropStatementTests/DropStatement.xml",
            "src/FunctionalTest/RadParserTest/TestFiles/Input/createAndAlterTableTests",
        ],
    ),
    fixture(
        "ddl-alter-add-column-visible-later",
        "dml-ddl",
        "P1",
        "CREATE TABLE dbo.SessionItems (ItemId int); ALTER TABLE dbo.SessionItems ADD Label nvarchar(50); SELECT Label FROM dbo.SessionItems;",
        [
            {
                kind: "object-visible",
                name: "dbo.SessionItems.Label",
                at: selector("SELECT Label"),
            },
            { kind: "diagnostic-set", exact: [] },
        ],
        ["src/FunctionalTest/RadParserTest/TestFiles/Input/createAndAlterTableTests"],
    ),

    fixture(
        "go-variable-scope-resets",
        "go-temp",
        "P0",
        "DECLARE @batchValue int = 1;\nGO\nSELECT @batchValue;",
        [diagnostic("undeclared-variable", selector("@batchValue", 1), 1)],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/Intellisense/Level1Verification/Lexicalscoping/LexicalScopingBasic2Tests/BasicTwo.xml",
        ],
    ),
    fixture(
        "go-table-variable-scope-resets",
        "go-temp",
        "P0",
        "DECLARE @items TABLE (ItemId int);\nGO\nSELECT ItemId FROM @items;",
        [diagnostic("undeclared-variable", selector("@items", 1), 1)],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/TableVariableBindingTests/SelectFromSingleTableVariable.xml",
            "src/FunctionalTest/RadParserTest/TestFiles/Input/Intellisense/Level1Verification/DataTypes/SelectAGGTests/BuildInAgg.xml",
        ],
    ),
    fixture(
        "go-temp-table-survives-batch",
        "go-temp",
        "P0",
        "CREATE TABLE #items (ItemId int, Label nvarchar(50));\nGO\nSELECT Label FROM #items;",
        [
            { kind: "object-visible", name: "#items", at: selector("SELECT Label") },
            hover(selector("Label", 1), "nvarchar(50)", "#items.Label"),
            { kind: "diagnostic-set", exact: [] },
        ],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/Intellisense/Level1Verification/Identifiers/RegularIdentifier_BasicTests/RegularIdentifierBasicNine.xml",
            "src/FunctionalTest/RadParserTest/TestFiles/Input/DML/UpdateTests/OutputIntoClause.xml",
        ],
    ),
    fixture(
        "temp-select-into-defines-shape",
        "go-temp",
        "P0",
        "SELECT CustomerId, DisplayName INTO #active FROM dbo.Customers WHERE IsActive = 1; SELECT a. FROM #active AS a;",
        [completion(selector("a."), ["CustomerId", "DisplayName"], ["CreditLimit"])],
        [
            "src/FunctionalTest/RadParserTest/TestFiles/Input/Intellisense/UILevel1Verification/SSMSUIPri1Tests/SSMSPri1UITest1.xml",
        ],
    ),
    fixture(
        "temp-drop-invalidates-shape",
        "go-temp",
        "P1",
        "CREATE TABLE #items (ItemId int); DROP TABLE #items; SELECT ItemId FROM #items;",
        [diagnostic("unknown-object", selector("#items", 2), 1)],
        ["src/FunctionalTest/RadParserTest/TestFiles/Input/DropStatementTests/DropStatement.xml"],
    ),

    updateFixture(
        "incremental-introduce-and-fix-diagnostic",
        "P0",
        "SELECT CustomerId FROM dbo.Customers;",
        "SELECT MissingId FROM dbo.Customers;",
        [
            { kind: "prior-snapshot-immutable" },
            { kind: "version-advances" },
            diagnostic("unknown-column", selector("MissingId"), 1, "updated"),
        ],
        [incrementalSource],
    ),
    updateFixture(
        "incremental-middle-statement-edit-preserves-neighbors",
        "P0",
        "SELECT CustomerId FROM dbo.Customers;\nSELECT Amount FROM Sales.Invoices;\nSELECT AuditId FROM dbo.AuditLog;",
        "SELECT CustomerId FROM dbo.Customers;\nSELECT IssuedAt FROM Sales.Invoices;\nSELECT AuditId FROM dbo.AuditLog;",
        [
            { kind: "prior-snapshot-immutable" },
            { kind: "unchanged-statement-results", indexes: [0, 2] },
            { kind: "diagnostic-set", exact: [], phase: "updated" },
        ],
        [incrementalSource],
    ),
    updateFixture(
        "incremental-offset-shift-keeps-reference-spans",
        "P0",
        "DECLARE @id int = 1; SELECT @id;",
        "-- prefix grows\nDECLARE @id int = 1; SELECT @id;",
        [
            definition(selector("@id", 1), selector("@id", 0), "updated"),
            references(
                selector("@id", 1),
                [selector("@id", 0), selector("@id", 1)],
                undefined,
                "updated",
            ),
            { kind: "prior-snapshot-immutable" },
        ],
        [incrementalSource],
    ),
    updateFixture(
        "incremental-go-boundary-changes-scope",
        "P0",
        "DECLARE @id int = 1; SELECT @id;",
        "DECLARE @id int = 1;\nGO\nSELECT @id;",
        [
            diagnostic("undeclared-variable", selector("@id", 1), 1, "updated"),
            { kind: "prior-snapshot-immutable" },
        ],
        [incrementalSource],
    ),
    updateFixture(
        "incremental-malformed-text-never-crashes",
        "P0",
        "SELECT CustomerId FROM dbo.Customers;",
        "SELECT CustomerId FROM dbo.Customers WHERE (",
        [
            { kind: "prior-snapshot-immutable" },
            { kind: "no-throw", phase: "updated" },
            diagnostic("syntax", eof(), 1, "updated"),
        ],
        [incrementalSource],
    ),
]);

export function resolveSelector(text, target) {
    if (target.eof) {
        return { start: text.length, end: text.length };
    }
    const occurrence = target.occurrence ?? 0;
    let start = -1;
    let from = 0;
    for (let index = 0; index <= occurrence; index++) {
        start = text.indexOf(target.needle, from);
        if (start < 0) {
            throw new Error(
                `Cannot resolve ${JSON.stringify(target.needle)} occurrence ${occurrence}`,
            );
        }
        from = start + target.needle.length;
    }
    return { start, end: start + target.needle.length };
}

export function selectorsOf(assertion) {
    return [assertion.target, assertion.at, assertion.definition]
        .concat(assertion.references ?? [])
        .filter(Boolean);
}

function fixture(id, area, priority, text, assertions, provenance) {
    return { id, area, priority, text, assertions, provenance: [...provenance] };
}

function updateFixture(id, priority, initialText, updatedText, assertions, provenance) {
    return {
        id,
        area: "incremental",
        priority,
        initialText,
        updatedText,
        assertions,
        provenance: [...provenance],
    };
}

function selector(needle, occurrence = 0) {
    return { needle, occurrence };
}

function eof() {
    return { eof: true };
}

function diagnostic(family, target, exactCount, phase = "single") {
    return { kind: "diagnostic", family, target, exactCount, phase };
}

function completion(at, include, exclude) {
    return { kind: "completion", at, position: "end", include, exclude };
}

function hover(at, type, display) {
    return { kind: "hover", at, type, display };
}

function definition(at, target, phase = "single") {
    return { kind: "definition", at, definition: target, phase };
}

function references(at, expected, symbolKind, phase = "single") {
    return { kind: "references", at, references: expected, symbolKind, phase };
}

function mutationTarget(operation, target, resolvedName) {
    return { kind: "mutation-target", operation, target, resolvedName };
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
        return value;
    }
    for (const nested of Object.values(value)) {
        deepFreeze(nested);
    }
    return Object.freeze(value);
}
