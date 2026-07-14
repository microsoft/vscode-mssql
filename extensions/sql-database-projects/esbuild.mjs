/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from "node:path";
import esbuildUtils from "../../scripts/esbuild-utils.js";

const extensionDirectory = import.meta.dirname;
const { createNodeExtensionConfig, disallowUnresolvedModulesPlugin, run } = esbuildUtils;
const outputFile = path.join(extensionDirectory, "dist/extension.js");

/**
 * Bundle the TypeScript entry point and its runtime dependencies into dist/extension.js so VSCE
 * can package the extension with --no-dependencies. The dataworkspace and vscode-mssql ambient
 * APIs must be imported with `import type`; runtime IDs and enum values live in local TypeScript
 * modules. azdata remains external because @microsoft/ads-extension-telemetry probes for it
 * optionally at runtime. The unresolved-module guard fails the build if an ambient API is
 * accidentally emitted as a runtime import.
 */
await run(
    () =>
        createNodeExtensionConfig({
            entryPoints: {
                extension: path.join(extensionDirectory, "src/extension.ts"),
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
