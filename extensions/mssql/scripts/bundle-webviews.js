/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs").promises;
const path = require("path");
const { createBrowserConfig, run } = require("../../../scripts/esbuild-utils");

/** Delete only this bundler's generated outdir before a non-watch build.
 * The worker config runs second and intentionally adds to the fresh graph. */
function cleanWebviewOutdirPlugin() {
    let cleaned = false;
    return {
        name: "clean-webview-outdir",
        setup(build) {
            build.onStart(async () => {
                if (cleaned) {
                    return;
                }
                cleaned = true;
                await fs.rm("./dist/views", { recursive: true, force: true });
            });
        },
    };
}

/**
 * Emit the static ESM closure for each entry bundle. Query Studio uses this
 * manifest to preload a view's chunks in one fetch wave rather than waiting
 * for the import waterfall after the webview becomes visible.
 */
function preloadManifestPlugin() {
    return {
        name: "webview-preload-manifest",
        setup(build) {
            build.onEnd(async (result) => {
                if (result.errors.length > 0 || !result.metafile) {
                    return;
                }
                const outputs = result.metafile.outputs;
                const manifest = {};
                for (const [file, output] of Object.entries(outputs)) {
                    if (!output.entryPoint || !file.endsWith(".js")) {
                        continue;
                    }
                    const seen = new Set();
                    const visit = (current) => {
                        if (seen.has(current) || !outputs[current]) {
                            return;
                        }
                        seen.add(current);
                        for (const imported of outputs[current].imports ?? []) {
                            if (imported.kind === "import-statement") {
                                visit(imported.path);
                            }
                        }
                    };
                    visit(file);
                    seen.delete(file);
                    manifest[path.basename(file, ".js")] = [...seen].map((current) =>
                        path.basename(current),
                    );
                }
                await fs.writeFile("./dist/views/preload-manifest.json", JSON.stringify(manifest));
            });
        },
    };
}

/**
 * The Spatial world-outline layer (SPA-10 / D-0023) lazily fetches a bundled
 * Natural Earth land topology from the webview resource origin. The asset is
 * data, not code: it must never enter a JS chunk (bundle budget) and loads
 * only when the user selects the layer.
 */
function worldOutlineAssetPlugin() {
    return {
        name: "spatial-world-outline-asset",
        setup(build) {
            build.onEnd(async (result) => {
                if (result.errors.length > 0) {
                    return;
                }
                await fs.mkdir("./dist/views", { recursive: true });
                await fs.copyFile(
                    require.resolve("world-atlas/land-110m.json"),
                    "./dist/views/spatial-world-land-110m.json",
                );
            });
        },
    };
}

function createConfigs({ isProd, isWatch }) {
    const webviews = createBrowserConfig({
        entryPoints: {
            addFirewallRule: "src/webviews/pages/AddFirewallRule/index.tsx",
            backupDatabaseDialog:
                "src/webviews/pages/ObjectManagement/BackupDatabase/backupDatabaseIndex.tsx",
            restoreDatabaseDialog:
                "src/webviews/pages/ObjectManagement/RestoreDatabase/restoreDatabaseIndex.tsx",
            connectionDialog: "src/webviews/pages/ConnectionDialog/index.tsx",
            connectionGroup: "src/webviews/pages/ConnectionGroup/index.tsx",
            debugConsole: "src/webviews/pages/DebugConsole/index.tsx",
            DacpacDialog: "src/webviews/pages/DacpacDialog/index.tsx",
            deployment: "src/webviews/pages/Deployment/index.tsx",
            executionPlan: "src/webviews/pages/ExecutionPlan/index.tsx",
            flatFileImport: "src/webviews/pages/FlatFileImport/index.tsx",
            tableDesigner: "src/webviews/pages/TableDesigner/index.tsx",
            objectExplorerFilter: "src/webviews/pages/ObjectExplorerFilter/index.tsx",
            queryResult: "src/webviews/pages/QueryResult/index.tsx",
            queryStudio: "src/webviews/pages/QueryStudio/index.tsx",
            queryStudioReplay: "src/webviews/pages/QueryStudioReplay/index.tsx",
            runbookStudio: "src/webviews/pages/RunbookStudio/index.tsx",
            queryResultsSnapshot: "src/webviews/pages/QueryResultsSnapshot/index.tsx",
            inlineCompletionDebug: "src/webviews/pages/InlineCompletionDebug/index.tsx",
            editorWorker: "monaco-editor/esm/vs/editor/editor.worker.js",
            userSurvey: "src/webviews/pages/UserSurvey/index.tsx",
            schemaDesigner: "src/webviews/pages/SchemaDesigner/index.tsx",
            schemaVisualizer: "src/webviews/pages/SchemaVisualizer/index.tsx",
            schemaCompare: "src/webviews/pages/SchemaCompare/index.tsx",
            changePassword: "src/webviews/pages/ChangePassword/index.tsx",
            createDatabaseDialog: "src/webviews/pages/ObjectManagement/createDatabaseIndex.tsx",
            dropDatabaseDialog: "src/webviews/pages/ObjectManagement/dropDatabaseIndex.tsx",
            renameDatabaseDialog: "src/webviews/pages/ObjectManagement/renameDatabaseIndex.tsx",
            publishProject: "src/webviews/pages/PublishProject/index.tsx",
            codeAnalysis: "src/webviews/pages/CodeAnalysis/index.tsx",
            tableExplorer: "src/webviews/pages/TableExplorer/index.tsx",
            searchDatabase: "src/webviews/pages/SearchDatabase/index.tsx",
            changelog: "src/webviews/pages/Changelog/index.tsx",
            profiler: "src/webviews/pages/Profiler/index.tsx",
            azureDataStudioMigration: "src/webviews/pages/AzureDataStudioMigration/index.tsx",
            shortcutsConfiguration: "src/webviews/pages/ShortcutsConfiguration/index.tsx",
        },
        loader: {
            ".tsx": "tsx",
            ".ts": "ts",
            ".css": "css",
            ".svg": "file",
            ".js": "js",
            ".png": "file",
            ".ttf": "file",
            ".gif": "file",
        },
        metafile: true,
        minify: isProd,
        outdir: "dist/views",
        plugins: [
            // Hashed chunks change whenever a shared dependency changes. A
            // non-watch build starts from a clean graph so stale chunks never
            // leak into later VSIX packages. Watch mode keeps both concurrent
            // contexts intact and packaging always performs a non-watch build.
            ...(!isWatch ? [cleanWebviewOutdirPlugin()] : []),
            preloadManifestPlugin(),
            worldOutlineAssetPlugin(),
        ],
        // Linked maps in development avoid loading multi-megabyte inline maps
        // during normal webview startup; the maps remain available in devtools.
        sourcemap: isProd ? false : "linked",
        splitting: true,
        tsconfig: "./tsconfig.webviews.json",
    });

    // Blob-backed web workers cannot resolve relative ESM imports from blob:.
    // Keep the spatial decoder self-contained and out of Query Studio startup.
    const spatialWorker = {
        ...webviews,
        entryPoints: {
            spatialDecodeWorker: "src/webviews/pages/QueryStudio/spatial/spatialDecodeWorker.ts",
        },
        metafile: false,
        plugins: [],
        splitting: false,
    };

    return [webviews, spatialWorker];
}

void run(createConfigs, "webviews");
