/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';
import VscodeWrapper from './vscodeWrapper';
import { Uri } from 'vscode';

/**
 * Service for creating untitled documents for SQL query
 */
export default class UntitledSqlDocumentService {

    constructor(private vscodeWrapper: VscodeWrapper) {
    }

    /**
     * Creates new untitled document for SQL query and opens in new editor tab
     * with optional content
     */
    public newQuery(content?: string): Promise<Uri> {
        return new Promise<Uri>(async (resolve, reject) => {
            try {

                // Open an untitled document. So the  file doesn't have to exist in disk
                let doc = await this.vscodeWrapper.openMsSqlTextDocument(content);

                // Show the new untitled document in the editor's first tab and change the focus to it.
                await this.vscodeWrapper.showTextDocument(doc, 1, false);
                const editor = vscode.window.activeTextEditor;
                const position = editor.selection.active;
                let newPosition = position.with(position.line + 1, 0);
                let newSelection = new vscode.Selection(newPosition, newPosition);
                editor.selection = newSelection;
                resolve(doc.uri);
            } catch (error) {
                reject(error);
            }
        });
    }
}

