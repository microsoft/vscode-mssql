/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

suite("Spatial packaged resources", () => {
    const root = path.join(__dirname, "..", "..", "..");

    test("the blob worker is self-contained and the offline outline is packaged", () => {
        const worker = fs.readFileSync(
            path.join(root, "dist", "views", "spatialDecodeWorker.js"),
            "utf8",
        );
        const imports: string[] = [];
        const tree = ts.createSourceFile("worker.js", worker, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
            if (
                ts.isImportDeclaration(node) ||
                (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
                (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
            ) {
                imports.push(node.getText(tree));
            }
            ts.forEachChild(node, visit);
        };
        visit(tree);
        expect(imports, "blob workers cannot resolve module imports").to.deep.equal([]);
        const land = JSON.parse(
            fs.readFileSync(
                path.join(root, "dist", "views", "spatial-world-land-110m.json"),
                "utf8",
            ),
        );
        expect(land.type).to.equal("Topology");
        expect(land.objects.land).not.to.equal(undefined);
    });

    test("pinned results do not load OpenLayers until the spatial tab is used", () => {
        const meta = JSON.parse(fs.readFileSync(path.join(root, "webviews-metafile.json"), "utf8"));
        const seen = new Set<string>();
        const visit = (name: string) => {
            if (seen.has(name)) return;
            seen.add(name);
            const output = meta.outputs[name];
            expect(
                Object.keys(output.inputs).some((input) => /node_modules[\\/]ol[\\/]/.test(input)),
            ).to.equal(false);
            for (const entry of output.imports ?? [])
                if (entry.kind === "import-statement") visit(entry.path);
        };
        visit("dist/views/queryResultsSnapshot.js");
    });
});
