/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from "node:path";
import esbuildUtils from "../../scripts/esbuild-utils.js";

const extensionDirectory = import.meta.dirname;
const { createNodeExtensionConfig, disallowUnresolvedModulesPlugin, run } = esbuildUtils;
const outputFile = path.join(extensionDirectory, "dist/main.js");
const extensionManifestPlugin = {
    name: "extension-manifest",
    setup(build) {
        build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/package(?:\.vscode)?\.json$/ }, (args) => ({
            path: path.join(extensionDirectory, path.basename(args.path)),
        }));
    },
};

await run(
    () =>
        createNodeExtensionConfig({
            entryPoints: {
                main: path.join(extensionDirectory, "src/main.ts"),
            },
            external: ["azdata"],
            outdir: path.join(extensionDirectory, "dist"),
            minify: true,
            plugins: [
                extensionManifestPlugin,
                disallowUnresolvedModulesPlugin(outputFile, ["dataworkspace", "vscode-mssql"]),
            ],
            sourcemap: true,
            tsconfig: path.join(extensionDirectory, "tsconfig.json"),
        }),
    "Data Workspace extension",
);
