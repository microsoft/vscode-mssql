/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { instrumentWebviews } from "./instrument-webviews.mjs";

test("webview coverage runs with dynamic code generation disabled and retains source maps", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mssql-instrument-"));
    try {
        const filename = path.join(directory, "view.js");
        fs.writeFileSync(filename, "globalThis.answer = 42;\n//# sourceMappingURL=view.js.map");
        fs.writeFileSync(
            `${filename}.map`,
            JSON.stringify({
                version: 3,
                sources: ["view.tsx"],
                sourcesContent: ["globalThis.answer = 42;"],
                names: [],
                mappings: "AAAA",
                file: "view.js",
            }),
        );
        fs.writeFileSync(path.join(directory, "view.css"), "body {}");
        instrumentWebviews(directory);
        const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
        vm.runInContext(fs.readFileSync(filename, "utf8"), context);
        assert.equal(context.answer, 42);
        const coverage = context.__coverage__[filename];
        assert.ok(Object.values(coverage.s).some((count) => count > 0));
        assert.deepEqual(Array.from(coverage.inputSourceMap.sources), ["view.tsx"]);
        const inlineMap = fs
            .readFileSync(filename, "utf8")
            .match(/sourceMappingURL=data:[^,]+,([^\s]+)/)?.[1];
        assert.ok(inlineMap);
        assert.ok(JSON.parse(Buffer.from(inlineMap, "base64").toString()).mappings.startsWith(";"));
        assert.equal(fs.readFileSync(path.join(directory, "view.css"), "utf8"), "body {}");
        // Re-running the smoke setup must not double-count instrumentation.
        const once = fs.readFileSync(filename, "utf8");
        instrumentWebviews(directory);
        assert.equal(fs.readFileSync(filename, "utf8"), once);
        const next = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
        vm.runInContext(fs.readFileSync(filename, "utf8"), next);
        assert.deepEqual(Object.values(next.__coverage__[filename].s), Object.values(coverage.s));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("only current build outputs are instrumented, leaving obsolete chunks untouched", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mssql-instrument-stale-"));
    try {
        const active = path.join(directory, "active.js");
        const stale = path.join(directory, "stale.js");
        fs.writeFileSync(active, "globalThis.active = true;");
        fs.writeFileSync(stale, "obsolete invalid JavaScript that must never be parsed");
        instrumentWebviews(directory, [active]);
        assert.match(fs.readFileSync(active, "utf8"), /__coverage__/);
        assert.equal(
            fs.readFileSync(stale, "utf8"),
            "obsolete invalid JavaScript that must never be parsed",
        );
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
