/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const esbuild = require("esbuild");
const fs = require("fs").promises;
const logger = require("../../../scripts/terminal-logger");

function esbuildProblemMatcherPlugin(processName) {
    return {
        name: "esbuild-problem-matcher",
        setup(build) {
            let timeStart;

            build.onStart(() => {
                timeStart = Date.now();
                logger.step(`Starting '${processName}' build`);
            });

            build.onEnd((result) => {
                const timeEnd = Date.now();
                const duration = timeEnd - timeStart;

                // Log errors with file locations
                result.errors.forEach(({ text, location }) => {
                    logger.error(`${text}`);
                    if (location) {
                        logger.error(`  at ${location.file}:${location.line}:${location.column}`);
                    }
                });

                // Log warnings
                result.warnings.forEach(({ text, location }) => {
                    logger.warning(`${text}`);
                    if (location) {
                        logger.warning(`  at ${location.file}:${location.line}:${location.column}`);
                    }
                });

                if (result.errors.length === 0) {
                    logger.success(`Finished '${processName}' build after ${duration}ms`);
                } else {
                    logger.error(`Failed '${processName}' build after ${duration}ms`);
                }
            });
        },
    };
}

/**
 * Build once
 */
async function build(config, isProd = false) {
    try {
        logger.info(`Building in ${isProd ? "production" : "development"} mode...`);
        const ctx = await esbuild.context(config);
        const result = await ctx.rebuild();

        // Handle errors
        if (result.errors.length > 0) {
            logger.error(`Build failed with ${result.errors.length} errors`);
            result.errors.forEach((err) => logger.error(err.text));
            await ctx.dispose();
            return false;
        }

        // Show warnings
        if (result.warnings.length > 0) {
            logger.warning(`${result.warnings.length} warnings`);
        }

        // Save metafile (named per bundle so the extension build never
        // clobbers the webviews graph the budget test reads)
        if (result.metafile) {
            const path = require("path");
            const isWebviews = String(config.outdir ?? "").includes("views");
            const metafileName = isWebviews
                ? "./webviews-metafile.json"
                : "./extension-metafile.json";
            await fs.writeFile(metafileName, JSON.stringify(result.metafile));
            logger.success("Metafile saved: " + metafileName);
            if (isWebviews) {
                // BOOT-2: per-entry static-closure manifest — the provider
                // injects <link rel="modulepreload"> for these so the ESM
                // import waterfall becomes one parallel fetch wave.
                const outputs = result.metafile.outputs;
                const manifest = {};
                for (const [file, out] of Object.entries(outputs)) {
                    if (!out.entryPoint || !file.endsWith(".js")) continue;
                    const seen = new Set();
                    const walk = (f) => {
                        if (seen.has(f) || !outputs[f]) return;
                        seen.add(f);
                        for (const imp of outputs[f].imports ?? []) {
                            if (imp.kind === "import-statement") walk(imp.path);
                        }
                    };
                    walk(file);
                    seen.delete(file);
                    manifest[path.basename(file, ".js")] = [...seen].map((f) => path.basename(f));
                }
                await fs.writeFile("./dist/views/preload-manifest.json", JSON.stringify(manifest));
                logger.success("Preload manifest saved: dist/views/preload-manifest.json");
            }
        }

        await ctx.dispose();
        logger.success("Build completed!");
        return true;
    } catch (error) {
        logger.error(`Build failed: ${error.message}`);
        return false;
    }
}

/**
 * Build in watch mode
 */
async function watch(config) {
    try {
        const ctx = await esbuild.context(config);

        await ctx.watch();
        logger.success("Watching for changes... (Ctrl+C to stop)");

        // Handle Ctrl+C
        process.on("SIGINT", async () => {
            await ctx.dispose();
            logger.success("Watch stopped");
            process.exit(0);
        });
    } catch (error) {
        logger.error(`Watch failed: ${error.message}`);
        process.exit(1);
    }
}

module.exports = {
    esbuildProblemMatcherPlugin,
    build,
    watch,
};
