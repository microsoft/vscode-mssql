/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from "node:path";
import esbuildUtils from "../../scripts/esbuild-utils.js";

const extensionDirectory = import.meta.dirname;
const { createNodeExtensionConfig, disallowUnresolvedModulesPlugin, run } = esbuildUtils;
const outputFile = path.join(extensionDirectory, "dist/extension.js");

await run(
    () =>
        createNodeExtensionConfig({
            entryPoints: {
                extension: path.join(extensionDirectory, "out/src/extension.js"),
            },
            external: ["azdata"],
            outdir: path.join(extensionDirectory, "dist"),
            minify: true,
            plugins: [
                disallowUnresolvedModulesPlugin(outputFile, [
                    "dataworkspace",
                    "sqldbproj",
                    "vscode-mssql",
                ]),
            ],
            sourcemap: true,
            tsconfig: path.join(extensionDirectory, "tsconfig.extension.json"),
        }),
    "SQL Database Projects extension",
);
