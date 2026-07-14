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
                    const escapedModuleName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    const runtimeRequire = new RegExp(
                        `\\b(?:require|__require\\d*)\\s*\\(\\s*(["'])${escapedModuleName}\\1\\s*\\)`,
                    );
                    if (runtimeRequire.test(output)) {
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

function getMetafileOutputPath(processName) {
    const filename = processName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    return `./${filename}-metafile.json`;
}

async function build(config, isProd, processName) {
    let context;

    try {
        logger.info(`Building in ${isProd ? "production" : "development"} mode...`);
        context = await esbuild.context(config);
        const result = await context.rebuild();

        if (result.metafile) {
            const metafileOutputPath = getMetafileOutputPath(processName);
            await fs.writeFile(metafileOutputPath, JSON.stringify(result.metafile));
            logger.success(`Metafile saved: ${metafileOutputPath}`);
        }

        const success = result.errors.length === 0;
        if (success) {
            logger.success("Build completed!");
        }
        return success;
    } catch (error) {
        logger.error(`Build failed: ${error.message}`);
        return false;
    } finally {
        await context?.dispose();
    }
}

async function watch(config) {
    let context;

    try {
        context = await esbuild.context(config);
        await context.watch();
        logger.success("Watching for changes... (Ctrl+C to stop)");

        process.on("SIGINT", async () => {
            await context.dispose();
            logger.success("Watch stopped");
            process.exit(0);
        });
    } catch (error) {
        await context?.dispose();
        logger.error(`Watch failed: ${error.message}`);
        process.exitCode = 1;
    }
}

async function run(createConfig, processName, args = process.argv.slice(2)) {
    const isProd = args.includes("--prod") || args.includes("-p");
    const isWatch = args.includes("--watch") || args.includes("-w");
    const created = createConfig({ isProd, isWatch });
    const configs = Array.isArray(created) ? created : [created];

    for (const config of configs) {
        config.plugins = [...(config.plugins ?? []), esbuildProblemMatcherPlugin(processName)];
    }

    if (isWatch) {
        logger.header(`Building ${processName} (watch mode)`);
        await Promise.all(configs.map((config) => watch(config)));
        return;
    }

    logger.header(`Building ${processName}`);
    let success = true;
    for (const config of configs) {
        success = (await build(config, isProd, processName)) && success;
    }
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
