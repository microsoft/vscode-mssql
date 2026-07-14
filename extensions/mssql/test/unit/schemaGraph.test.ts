/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SV-R3 provider-neutral schema graph (visualizer addendum §10):
 * - Layout kernel: O(1) node resolution (no per-edge scans), hidden
 *   node/edge filtering, deterministic positions, dimension parity with
 *   the legacy Schema Designer (visual language preserved).
 * - Collapse split + aria label helpers (pure).
 * - §10.4 IMPORT ALLOWLIST GUARD: the shared schemaGraph module and the
 *   visualizer sources must never import legacy stateful Schema Designer
 *   modules (state provider, event bus, selector, diff/change providers,
 *   Copilot, DAB) — the exact A-12 entanglements.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { layoutSchemaGraph } from "../../src/webviews/common/schemaGraph/schemaGraphLayout";
import {
    schemaGraphTableHeight,
    schemaGraphTableWidth,
    SCHEMA_GRAPH_NODE_WIDTH,
} from "../../src/webviews/common/schemaGraph/schemaGraphDimensions";
import {
    schemaGraphColumnAriaLabel,
    schemaGraphTableAriaLabel,
    splitColumnsForCollapse,
    SchemaGraphColumnData,
} from "../../src/webviews/common/schemaGraph/schemaGraphTypes";
import {
    getTableHeight,
    getTableWidth,
    NODE_WIDTH,
} from "../../src/webviews/pages/SchemaDesigner/model/flowDimensions";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";

function column(id: string, overrides?: Partial<SchemaGraphColumnData>): SchemaGraphColumnData {
    return {
        id,
        name: id,
        typeDisplay: "int",
        nullable: false,
        isPrimaryKey: false,
        isForeignKey: false,
        ...overrides,
    };
}

suite("Schema graph shared components (SV-R3)", () => {
    test("layout: deterministic, visible-only, hidden edges/nodes excluded", () => {
        const nodes = [
            { id: "table:1", columnCount: 3 },
            { id: "table:2", columnCount: 5 },
            { id: "table:3", columnCount: 1, hidden: true },
        ];
        const edges = [
            { sourceId: "table:1", targetId: "table:2" },
            { sourceId: "table:1", targetId: "table:3" }, // hidden target
            { sourceId: "table:1", targetId: "table:9" }, // unknown target
            { sourceId: "table:2", targetId: "table:1", hidden: true },
        ];
        const first = layoutSchemaGraph(nodes, edges);
        const second = layoutSchemaGraph(nodes, edges);
        expect([...first.keys()].sort()).to.deep.equal(["table:1", "table:2"]);
        expect(first.get("table:3")).to.equal(undefined);
        // Deterministic: same inputs → identical positions.
        expect([...first.entries()]).to.deep.equal([...second.entries()]);
        for (const position of first.values()) {
            expect(Number.isFinite(position.x)).to.equal(true);
            expect(Number.isFinite(position.y)).to.equal(true);
        }
        // LR rank direction: the edge source ranks left of its target.
        expect(first.get("table:1")!.x).to.be.lessThan(first.get("table:2")!.x);
    });

    test("layout: large graph (1000 nodes / 2000 edges incl. self-refs) completes correctly", () => {
        const nodes = Array.from({ length: 1000 }, (_, i) => ({
            id: `table:${i}`,
            columnCount: 8,
        }));
        const edges = Array.from({ length: 2000 }, (_, k) => ({
            sourceId: `table:${k % 1000}`,
            targetId: `table:${(k * 7 + 1) % 1000}`,
        }));
        const positions = layoutSchemaGraph(nodes, edges);
        expect(positions.size).to.equal(1000);
    });

    test("dimensions: parity with the legacy Schema Designer sizing", () => {
        expect(SCHEMA_GRAPH_NODE_WIDTH).to.equal(NODE_WIDTH);
        expect(schemaGraphTableWidth()).to.equal(getTableWidth());
        const legacyTable = {
            columns: new Array(7).fill({}),
        } as unknown as SchemaDesigner.Table;
        expect(schemaGraphTableHeight(7)).to.equal(getTableHeight(legacyTable));
        expect(schemaGraphTableHeight(0)).to.equal(
            getTableHeight({ columns: [] } as unknown as SchemaDesigner.Table),
        );
    });

    test("collapse split: threshold behavior + full column set preserved", () => {
        const twelve = Array.from({ length: 12 }, (_, i) => column(`c${i}`));
        const collapsed = splitColumnsForCollapse(twelve, true);
        expect(collapsed.collapsible).to.equal(true);
        expect(collapsed.visible.length).to.equal(10);
        expect(collapsed.hidden.length).to.equal(2);
        const expanded = splitColumnsForCollapse(twelve, false);
        expect(expanded.visible.length).to.equal(12);
        expect(expanded.hidden.length).to.equal(0);
        const nine = Array.from({ length: 9 }, (_, i) => column(`c${i}`));
        const small = splitColumnsForCollapse(nine, true);
        expect(small.collapsible).to.equal(false);
        expect(small.visible.length).to.equal(9);
    });

    test("aria labels summarize honestly", () => {
        expect(
            schemaGraphTableAriaLabel({
                id: "table:1",
                schema: "dbo",
                name: "Orders",
                columns: [column("a"), column("b")],
            }),
        ).to.equal("dbo.Orders, 2 columns");
        expect(
            schemaGraphColumnAriaLabel(
                column("OrderId", { isPrimaryKey: true, nullable: false, typeDisplay: "bigint" }),
            ),
        ).to.equal("OrderId, bigint, primary key, not null");
    });

    test("§10.4 IMPORT GUARD: shared schemaGraph + visualizer never import legacy stateful modules", () => {
        const roots = [
            path.join(__dirname, "..", "..", "..", "src", "webviews", "common", "schemaGraph"),
            path.join(__dirname, "..", "..", "..", "src", "schemaVisualizer"),
        ].filter((p) => fs.existsSync(p));
        expect(roots.length).to.be.greaterThan(0);
        const forbidden = [
            "schemaDesignerStateProvider",
            "schemaDesignerEvents",
            "schemaDesignerSelector",
            "SchemaDesigner/diff/",
            "SchemaDesigner/definition/",
            "SchemaDesigner/editor/",
            "SchemaDesigner/dab/",
            "copilotReviewToolbar",
            "/dab/",
            "/copilot/",
        ];
        const violations: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                    continue;
                }
                if (!/\.(ts|tsx)$/.test(entry.name)) {
                    continue;
                }
                const source = fs.readFileSync(full, "utf8");
                for (const m of source.matchAll(/from\s+"([^"]+)"/g)) {
                    const specifier = m[1];
                    for (const banned of forbidden) {
                        if (specifier.includes(banned)) {
                            violations.push(`${entry.name}: ${specifier}`);
                        }
                    }
                }
            }
        };
        for (const root of roots) {
            walk(root);
        }
        expect(violations, violations.join("\n")).to.deep.equal([]);
    });
});
