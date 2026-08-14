/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { ImmutableTextSnapshot, LezerSyntaxService } = require("../dist/index.js");

suite("T-SQL XML and full-text index grammar", () => {
    // Verifies selective XML paths retain XQUERY/SQL types, namespaces, and physical options.
    test("parses selective XML index creation", () => {
        const snapshot = parse(`
CREATE SELECTIVE XML INDEX sxi ON dbo.Documents(XmlBody)
WITH XMLNAMESPACES ('urn:doc' AS d, DEFAULT 'urn:default')
FOR (
  title = '/d:doc/title' AS XQUERY 'xs:string' MAXLENGTH(200) SINGLETON,
  score = '/d:doc/score' AS SQL DECIMAL(10,2)
)
WITH (DROP_EXISTING = ON, FILLFACTOR = 90);
CREATE XML INDEX sxi_path ON dbo.Documents(XmlBody)
USING XML INDEX sxi FOR (title, score);`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/XmlIndexStatement\(/g) ?? []).length, 2);
    });

    // Verifies ALTER INDEX can add/remove selective paths with an optional namespace declaration.
    test("parses selective XML index path changes", () => {
        const snapshot = parse(`
ALTER INDEX sxi ON dbo.Documents
WITH XMLNAMESPACES ('urn:doc' AS d)
FOR (REMOVE old_path, ADD title = '/d:doc/title' AS XQUERY 'xs:string' SINGLETON);`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /SelectiveXmlAlterClause/);
    });

    // Verifies catalog, stoplist, and search-property-list lifecycle actions.
    test("parses full-text auxiliary object lifecycles", () => {
        const snapshot = parse(`
CREATE FULLTEXT CATALOG docs WITH ACCENT_SENSITIVITY = ON AS DEFAULT;
ALTER FULLTEXT CATALOG docs REBUILD WITH ACCENT_SENSITIVITY = OFF;
CREATE FULLTEXT STOPLIST words FROM SYSTEM STOPLIST AUTHORIZATION dbo;
ALTER FULLTEXT STOPLIST words ADD 'release' LANGUAGE 1033;
ALTER FULLTEXT STOPLIST words DROP ALL LANGUAGE English;
CREATE SEARCH PROPERTY LIST props FROM master_props AUTHORIZATION dbo;
ALTER SEARCH PROPERTY LIST props ADD 'Author'
  WITH (PROPERTY_SET_GUID = '00000000-0000-0000-0000-000000000000', PROPERTY_INT_ID = 89);
DROP SEARCH PROPERTY LIST props;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /SearchPropertyListAction/);
    });

    // Verifies full-text index storage, option matrices, population, and statistical semantics.
    test("parses full-text index option and action matrices", () => {
        const snapshot = parse(`
CREATE FULLTEXT INDEX ON dbo.Documents(Body LANGUAGE English STATISTICAL_SEMANTICS)
KEY INDEX PK_Documents ON (FILEGROUP SearchData, docs)
WITH (CHANGE_TRACKING = AUTO, STOPLIST = SYSTEM, SEARCH PROPERTY LIST = props);
ALTER FULLTEXT INDEX ON dbo.Documents SET STOPLIST = OFF WITH NO POPULATION;
ALTER FULLTEXT INDEX ON dbo.Documents ADD (Title LANGUAGE 1033) WITH NO POPULATION;
ALTER FULLTEXT INDEX ON dbo.Documents START UPDATE POPULATION;
ALTER FULLTEXT INDEX ON dbo.Documents ALTER COLUMN Body ADD STATISTICAL_SEMANTICS;
ALTER FULLTEXT INDEX ON dbo.Documents PAUSE POPULATION;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/FullTextStatement\(/g) ?? []).length, 6);
    });

    // Verifies incomplete promoted paths and stoplist actions remain syntax errors.
    test("reports malformed XML and full-text actions", () => {
        assert.ok(parse("ALTER INDEX sxi ON dbo.t FOR (ADD path =);").diagnostics.length > 0);
        assert.ok(parse("ALTER FULLTEXT STOPLIST words ADD LANGUAGE 1033;").diagnostics.length > 0);
    });
});

function parse(sql) {
    return new LezerSyntaxService().parse(
        new ImmutableTextSnapshot("file:///fulltext-xml.sql", 1, sql),
    );
}
