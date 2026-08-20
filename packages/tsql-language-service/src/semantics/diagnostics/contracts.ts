/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxKind, SyntaxNode } from "../../syntax/index.js";
import type { TextRange } from "../../text/index.js";

/** Minimum surface a diagnostic family receives from the document validator. */
export interface DiagnosticFamilyContext {
    nodes(kind: SyntaxKind): readonly SyntaxNode[];
    source(range: TextRange): string;
    add(code: string, message: string, range: TextRange): void;
}
