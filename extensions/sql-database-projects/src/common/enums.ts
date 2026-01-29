/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Centralized enum definitions for the sql-database-projects extension.
 *
 * IMPORTANT: These enums are duplicated here because the `const enum` definitions in
 * vscode-mssql.d.ts are not available at runtime (they get inlined during TypeScript
 * compilation). This file provides runtime-accessible enum values that match the
 * definitions in the .d.ts files.
 *
 * When adding or modifying enums here, ensure they stay in sync with:
 * - typings/vscode-mssql.d.ts
 *
 * TODO: Move all similar enums from other files to this centralized location.
 */

export const enum DeploymentScenario {
	Deployment = 0,
	SchemaCompare = 1,
}
