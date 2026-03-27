/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This is a separate build script from bundle-webviews.js because the notebook
// renderer has fundamentally incompatible esbuild requirements:
//
// 1. CSS inlining: Notebook renderers run in an isolated iframe that only loads the
//    JS entrypoint — extracted CSS files are never loaded. We use a custom plugin to
//    inline CSS as <style> elements, whereas webview panels use esbuild's native .css
//    loader with separate files loaded via <link> tags in HTML templates.
//
// 2. No code splitting: The renderer must be a single self-contained file
//    (splitting: false + outfile), whereas webviews use splitting: true + outdir
//    to share chunks. These options are mutually exclusive in esbuild.

const fs = require("fs");
const path = require("path");
const logger = require("../../../scripts/terminal-logger");
const { esbuildProblemMatcherPlugin, build, watch } = require("./esbuild-utils");

// Parse arguments
const args = process.argv.slice(2);
const isProd = args.includes("--prod") || args.includes("-p");
const isWatch = args.includes("--watch") || args.includes("-w");

// Plugin to inline CSS into the JS bundle as <style> elements.
// Notebook renderers run in an isolated iframe that only loads the JS entrypoint,
// so extracted CSS files would never be loaded. Asset url() references (e.g. SVG
// icons) are resolved to data URIs so they work inside the iframe.
const inlineCssPlugin = {
    name: "inline-css",
    setup(build) {
        build.onLoad({ filter: /\.css$/ }, async (args) => {
            let css = await fs.promises.readFile(args.path, "utf-8");
            const cssDir = path.dirname(args.path);

            // Resolve url() references to local assets as inline data URIs.
            const urlPattern = /url\(["']?([^"')]+\.(svg|png|gif))["']?\)/g;
            const replacements = [];
            let match;
            while ((match = urlPattern.exec(css)) !== null) {
                const assetPath = path.resolve(cssDir, match[1]);
                try {
                    const content = await fs.promises.readFile(assetPath);
                    const ext = match[2];
                    const mime = ext === "svg" ? "image/svg+xml" : `image/${ext}`;
                    const dataUrl = `data:${mime};base64,${content.toString("base64")}`;
                    replacements.push({ original: match[0], replacement: `url("${dataUrl}")` });
                } catch {
                    // Asset not found — leave the url() as-is
                }
            }
            for (const { original, replacement } of replacements) {
                css = css.split(original).join(replacement);
            }

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
    entryPoints: ["src/webviews/pages/NotebookRenderer/notebookRendererEntry.tsx"],
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
    tsconfig: "./tsconfig.webviews.json",
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
