/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs");
const logger = require("../../../scripts/terminal-logger");
const { esbuildProblemMatcherPlugin, build, watch } = require("./esbuild-utils");

// Parse arguments
const args = process.argv.slice(2);
const isProd = args.includes("--prod") || args.includes("-p");
const isWatch = args.includes("--watch") || args.includes("-w");

// Plugin to inline CSS into the JS bundle as <style> elements.
// Notebook renderers run in an isolated iframe that only loads the JS entrypoint,
// so extracted CSS files would never be loaded.
const inlineCssPlugin = {
    name: "inline-css",
    setup(build) {
        build.onLoad({ filter: /\.css$/ }, async (args) => {
            const css = await fs.promises.readFile(args.path, "utf-8");
            return {
                contents: `
                    (function() {
                        var style = document.createElement('style');
                        style.textContent = ${JSON.stringify(css)};
                        document.head.appendChild(style);
                    })();
                `,
                loader: "js",
            };
        });
    },
};

// Build configuration
const config = {
    entryPoints: ["src/reactviews/pages/NotebookRenderer/notebookRendererEntry.tsx"],
    bundle: true,
    outfile: "dist/notebookRenderer.js",
    platform: "browser",
    loader: {
        ".tsx": "tsx",
        ".ts": "ts",
        ".svg": "file",
        ".js": "js",
        ".png": "file",
        ".gif": "file",
    },
    tsconfig: "./tsconfig.react.json",
    plugins: [inlineCssPlugin, esbuildProblemMatcherPlugin("notebook-renderer")],
    sourcemap: isProd ? false : "inline",
    metafile: !isProd,
    minify: isProd,
    format: "esm",
    splitting: false,
};

// Main execution
async function main() {
    if (isWatch) {
        logger.header("Building notebook renderer (watch mode)");
        await watch(config);
    } else {
        logger.header("Building notebook renderer");
        const success = await build(config, isProd);
        process.exit(success ? 0 : 1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}
