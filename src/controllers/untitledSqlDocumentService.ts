/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "./vscodeWrapper";

/**
 * Service for creating untitled documents for SQL query
 */
export default class UntitledSqlDocumentService implements vscode.Disposable {
    public skipCopyConnectionUris: Set<string> = new Set();
    private _ongoingCreates: Map<string, Promise<vscode.TextEditor>> = new Map();
    private _documentCloseDisposable: vscode.Disposable | undefined;

    constructor(private vscodeWrapper: VscodeWrapper) {
        this.setupDocumentCloseListener();
    }

    /**
     * Set up listener for document close events to automatically untrack URIs
     */
    private setupDocumentCloseListener(): void {
        this._documentCloseDisposable = vscode.workspace.onDidCloseTextDocument((document) => {
            const uri = document.uri.toString();
            if (this.skipCopyConnectionUris.has(uri)) {
                this.skipCopyConnectionUris.delete(uri);
            }
        });
    }

    dispose() {
        if (this._documentCloseDisposable) {
            this._documentCloseDisposable.dispose();
        }
    }

    /**
     * Wait for all ongoing create operations to complete
     */
    public async waitForOngoingCreates(): Promise<vscode.TextEditor[]> {
        const pendingPromises = Array.from(this._ongoingCreates.values());
        return Promise.all(pendingPromises);
    }

    /**
     * Creates new untitled document for SQL query and opens in new editor tab
     * with optional content
     */
    public async newQuery(
        content?: string,
        shouldCopyLastActiveConnection: boolean = false,
    ): Promise<vscode.TextEditor> {
        // Create a unique key for this operation to handle potential duplicates
        const operationKey = `${Date.now()}-${Math.random()}`;
        try {
            const newQueryPromise = new Promise<vscode.TextEditor>(async (resolve) => {
                const editor = await this.createDocument(content, shouldCopyLastActiveConnection);
                resolve(editor);
            });
            this._ongoingCreates.set(operationKey, newQueryPromise);

            return await newQueryPromise;
        } finally {
            // Clean up the pending operation
            this._ongoingCreates.delete(operationKey);
        }
    }

    private async createDocument(
        content?: string,
        shouldCopyLastActiveConnection?: boolean,
    ): Promise<vscode.TextEditor> {
        const doc = await this.vscodeWrapper.openMsSqlTextDocument(content);

        const editor = await this.vscodeWrapper.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: false,
            preview: false,
        });

        if (!shouldCopyLastActiveConnection) {
            this.skipCopyConnectionUris.add(editor.document.uri.toString());
        }

        return editor;
    }

    public shouldSkipCopyConnection(uri: string): boolean {
        return this.skipCopyConnectionUris.has(uri);
    }
}
