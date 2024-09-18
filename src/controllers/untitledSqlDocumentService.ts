/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";

/**
 * Service for creating untitled documents for SQL query
 */
export default class UntitledSqlDocumentService {
    constructor(private vscodeWrapper: VscodeWrapper) {}

    /**
     * Creates new untitled document for SQL query and opens in new editor tab
     * with optional content
     */
    public async newQuery(content?: string): Promise<vscode.TextEditor> {
        // Open an untitled document. So the  file doesn't have to exist in disk
        let doc = await this.vscodeWrapper.openMsSqlTextDocument(content);
        // Show the new untitled document in the editor's first tab and change the focus to it.
        const editor = await this.vscodeWrapper.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: false,
            preview: false,
        });
        return editor;
    }
}
