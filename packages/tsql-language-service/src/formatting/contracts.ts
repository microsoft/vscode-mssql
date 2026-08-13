/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextEdit } from "../features/index.js";
import type { SyntaxSnapshot } from "../syntax/index.js";
import type { TextRange } from "../text/index.js";

export interface FormattingOptions {
    readonly tabSize: number;
    readonly insertSpaces: boolean;
    readonly keywordCase: "preserve" | "upper" | "lower";
    readonly commaStyle: "preserve" | "trailing" | "leading";
}

export interface FormattingService {
    formatDocument(snapshot: SyntaxSnapshot, options: FormattingOptions): readonly TextEdit[];
    formatRange(
        snapshot: SyntaxSnapshot,
        range: TextRange,
        options: FormattingOptions,
    ): readonly TextEdit[];
    formatOnType(
        snapshot: SyntaxSnapshot,
        offset: number,
        character: string,
        options: FormattingOptions,
    ): readonly TextEdit[];
}
