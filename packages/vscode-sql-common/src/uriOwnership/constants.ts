/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The key in package.json contributes section that SQL extensions use to declare
 * their common features for coordination.
 *
 * Example in package.json:
 * ```json
 * {
 *   "displayName": "SQL Server (mssql)",
 *   "contributes": {
 *     "vscode-sql-common-features": {
 *       "uriOwnershipApi": true
 *     }
 *   }
 * }
 * ```
 */
export const PACKAGE_JSON_COMMON_FEATURES_KEY = "vscode-sql-common-features";

/**
 * VS Code command to set context keys.
 */
export const SET_CONTEXT_COMMAND = "setContext";
