/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs").promises;
const path = require("path");
const { createRequire } = require("module");
const logger = require("./terminal-logger");

const extensionRequire = createRequire(path.join(process.cwd(), "package.json"));
const esbuild = extensionRequire("esbuild");

function createNodeExtensionConfig(config) {
    const { external = [], ...options } = config;

    return {
        bundle: true,
        external: ["vscode", ...external],
        format: "cjs",
        logOverride: {
            "import-is-undefined": "error",
        },
        mainFields: ["module", "main"],
        platform: "node",
        target: ["es2024"],
        treeShaking: true,
        ...options,
    };
}

function createBrowserConfig(config) {
    return {
        bundle: true,
        format: "esm",
        platform: "browser",
        target: ["es2024"],
        treeShaking: true,
        ...config,
    };
}

function disallowUnresolvedModulesPlugin(outputFile, moduleNames) {
    return {
        name: "disallow-unresolved-modules",
        setup(build) {
            build.onEnd(async (result) => {
                if (result.errors.length > 0) {
                    return;
                }

                const output = await fs.readFile(outputFile, "utf8");
                for (const moduleName of moduleNames) {
                    if (output.includes(`require("${moduleName}")`)) {
                        result.errors.push({
                            text: `Bundle contains unresolved runtime module '${moduleName}'`,
                        });
                    }
                }
            });
        },
    };
}

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
                const duration = Date.now() - timeStart;

                for (const { text, location } of result.errors) {
                    logger.error(text);
                    if (location) {
                        logger.error(`  at ${location.file}:${location.line}:${location.column}`);
                    }
                }

                for (const { text, location } of result.warnings) {
                    logger.warning(text);
                    if (location) {
                        logger.warning(`  at ${location.file}:${location.line}:${location.column}`);
                    }
                }

                if (result.errors.length === 0) {
                    logger.success(`Finished '${processName}' build after ${duration}ms`);
                } else {
                    logger.error(`Failed '${processName}' build after ${duration}ms`);
                }
            });
        },
    };
}

async function build(config, isProd) {
    try {
        logger.info(`Building in ${isProd ? "production" : "development"} mode...`);
        const context = await esbuild.context(config);
        const result = await context.rebuild();

        if (result.metafile) {
            await fs.writeFile("./webviews-metafile.json", JSON.stringify(result.metafile));
            logger.success("Metafile saved: webviews-metafile.json");
        }

        await context.dispose();
        const success = result.errors.length === 0;
        if (success) {
            logger.success("Build completed!");
        }
        return success;
    } catch (error) {
        logger.error(`Build failed: ${error.message}`);
        return false;
    }
}

async function watch(config) {
    try {
        const context = await esbuild.context(config);
        await context.watch();
        logger.success("Watching for changes... (Ctrl+C to stop)");

        process.on("SIGINT", async () => {
            await context.dispose();
            logger.success("Watch stopped");
            process.exit(0);
        });
    } catch (error) {
        logger.error(`Watch failed: ${error.message}`);
        process.exitCode = 1;
    }
}

async function run(createConfig, processName, args = process.argv.slice(2)) {
    const isProd = args.includes("--prod") || args.includes("-p");
    const isWatch = args.includes("--watch") || args.includes("-w");
    const config = createConfig({ isProd, isWatch });

    config.plugins = [...(config.plugins ?? []), esbuildProblemMatcherPlugin(processName)];

    if (isWatch) {
        logger.header(`Building ${processName} (watch mode)`);
        await watch(config);
        return;
    }

    logger.header(`Building ${processName}`);
    const success = await build(config, isProd);
    if (!success) {
        process.exitCode = 1;
    }
}

module.exports = {
    createBrowserConfig,
    createNodeExtensionConfig,
    disallowUnresolvedModulesPlugin,
    run,
};
