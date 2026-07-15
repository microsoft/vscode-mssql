/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Webview-side edit-mode constants (SV-R8c). */

export type { SchemaVisualizerEditOp } from "../../../schemaVisualizer/model/schemaVisualizerEdit";

/** FK referential actions offered by the actions dropdown (D11 strings). */
export const FkReferentialActionValues = [
    "NO_ACTION",
    "CASCADE",
    "SET_NULL",
    "SET_DEFAULT",
] as const;
