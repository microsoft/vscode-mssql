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
const { createBrowserConfig, run } = require("../../../scripts/esbuild-utils");

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
void run(
    ({ isProd }) =>
        createBrowserConfig({
            entryPoints: ["src/webviews/pages/NotebookRenderer/notebookRendererEntry.tsx"],
            loader: {
                ".tsx": "tsx",
                ".ts": "ts",
                // Inline assets — renderer iframe can't resolve separate files.
                ".svg": "dataurl",
                ".js": "js",
                ".png": "dataurl",
                ".gif": "dataurl",
            },
            metafile: !isProd,
            minify: isProd,
            outfile: "dist/notebookRenderer.js",
            plugins: [inlineCssPlugin],
            sourcemap: isProd ? false : "inline",
            splitting: false,
            tsconfig: "./tsconfig.webviews.json",
        }),
    "notebook renderer",
);
