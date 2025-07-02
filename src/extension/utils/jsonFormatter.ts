/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as prettier from "prettier";

export class JsonFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
    async provideDocumentFormattingEdits(
        document: vscode.TextDocument,
    ): Promise<vscode.TextEdit[]> {
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length),
        );

        const formatted = await prettier.format(document.getText(), { parser: "json" });

        return [vscode.TextEdit.replace(fullRange, formatted)];
    }
}
