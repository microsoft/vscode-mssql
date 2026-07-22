/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { projectRunbookSchemaGraphDocument } from "../../src/runbookStudio/providers/schemaGraphProvider";
import { SchemaVisualizerCatalogModel } from "../../src/schemaVisualizer/model/schemaVisualizerModel";

suite("Runbook schema graph provider", () => {
    test("projects MetadataStore visualizer facts into a bounded neutral document", () => {
        const model = {
            databaseIdentity: { serverFingerprint: "must-not-escape", database: "WWI_2" },
            caseSensitive: false,
            tables: Array.from({ length: 105 }, (_, tableIndex) => ({
                identity: { objectId: tableIndex + 1 },
                graphId: `table:${tableIndex + 1}`,
                schema: "dbo",
                name: `Table${tableIndex + 1}`,
                columns: Array.from({ length: 42 }, (_, columnIndex) => ({
                    identity: { objectId: tableIndex + 1, columnId: columnIndex + 1 },
                    graphId: `column:${tableIndex + 1}:${columnIndex + 1}`,
                    ordinal: columnIndex + 1,
                    name: `Column${columnIndex + 1}`,
                    typeDisplay: "int",
                    nullable: false,
                    isIdentity: columnIndex === 0,
                    isComputed: false,
                    inPrimaryKey: { state: "known", value: columnIndex === 0 },
                    type: { state: "unknown", reason: "notHydrated" },
                    defaultConstraint: { state: "unknown", reason: "notHydrated" },
                    identitySpec: { state: "unknown", reason: "notHydrated" },
                    computed: { state: "unknown", reason: "notHydrated" },
                    description: { state: "unknown", reason: "notHydrated" },
                })),
                keyConstraints: [],
                description: { state: "unknown", reason: "notHydrated" },
            })),
            foreignKeys: [],
            capabilities: {},
            source: {
                generation: 1,
                capturedAtUtc: "2026-07-21T00:00:00.000Z",
                mode: "full",
                sectionReadiness: {},
            },
        } as unknown as SchemaVisualizerCatalogModel;

        const document = projectRunbookSchemaGraphDocument(
            {
                model,
                totalTables: 105,
                renderedTables: 105,
                fingerprint: "fingerprint",
                fingerprintComplete: true,
                searchFirst: false,
                freshness: { source: "live", freshness: "live", validation: "full" },
            },
            105,
        );

        expect(document.databaseLabel).to.equal("WWI_2");
        expect(document.tables).to.have.length(100);
        expect(document.tables[0].columns).to.have.length(40);
        expect(document.tables[0].columnsTruncated).to.equal(true);
        expect(document.omittedTableCount).to.equal(5);
        expect(document.truncated).to.equal(true);
        expect(document.provider).to.deep.equal({
            kind: "sts-v2-metadata-store",
            contractVersion: 2,
        });
        expect(JSON.stringify(document)).not.to.contain("must-not-escape");
    });
});
