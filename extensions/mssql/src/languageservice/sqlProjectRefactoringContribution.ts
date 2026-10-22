/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ISqlProjectLookup } from "./sqlProjectLookup";
import { SqlSymbolRenameProvider } from "./sqlSymbolRenameProvider";
import { SqlMoveToSchemaProvider } from "./sqlMoveToSchemaProvider";

/**
 * Registers the refactorings that work on SQL project files: Rename Symbol (F2) and the
 * "Move to Schema..." action under the Refactor... menu.
 */
export class SqlProjectRefactoringContribution implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[];

    constructor(@ISqlProjectLookup projectLookup: ISqlProjectLookup) {
        this._disposables = [
            // F2 / "Rename Symbol" uses our STS backend, which gives the native inline rename
            // textbox and VS Code's preview panel.
            vscode.languages.registerRenameProvider(
                { language: "sql" },
                new SqlSymbolRenameProvider(projectLookup),
            ),
            ...SqlMoveToSchemaProvider.register(projectLookup),
        ];
    }

    public dispose(): void {
        vscode.Disposable.from(...this._disposables).dispose();
    }
}
