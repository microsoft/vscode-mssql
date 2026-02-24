/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Centralized enum definitions for the mssql extension.
 *
 * IMPORTANT: These enums are duplicated here because the `const enum` definitions in
 * vscode-mssql.d.ts are not available at runtime (they get inlined during TypeScript
 * compilation). This file provides runtime-accessible enum values that match the
 * definitions in the .d.ts files.
 *
 * When adding or modifying enums here, ensure they stay in sync with:
 * - typings/vscode-mssql.d.ts
 *
 * DO NOT use `const enum` in this file. `const enum` declarations are inlined by the
 * TypeScript compiler and have no runtime representation, which breaks esbuild /
 * isolatedModules compilation used for React webview bundles. Always use plain `enum`.
 *
 * TODO: Move all similar enums from other files to this centralized location.
 */

/**
 * Specifies the scenario for which to retrieve default deployment options.
 */
export enum DeploymentScenario {
    /**
     * Deployment/Publish scenario - uses DacFx native defaults
     */
    Deployment = 0,
    /**
     * Schema Compare scenario - uses modified defaults optimized for schema comparison
     */
    SchemaCompare = 1,
}

/**
 * Code analysis rule severity levels.
 */
export enum CodeAnalysisRuleSeverity {
    Error = "Error",
    Warning = "Warning",
    Disabled = "Disabled",
}
