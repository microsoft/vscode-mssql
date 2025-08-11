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
    public trackedUris: Set<string> = new Set();
    private _pendingOperations: Map<string, Promise<vscode.TextEditor>> = new Map();
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
            if (this.trackedUris.has(uri)) {
                this.trackedUris.delete(uri);
            }
        });
    }

    dispose() {
        if (this._documentCloseDisposable) {
            this._documentCloseDisposable.dispose();
        }
    }

    /**
     * Wait for all pending operations to complete
     */
    public async waitForAllOperations(): Promise<vscode.TextEditor[]> {
        const pendingPromises = Array.from(this._pendingOperations.values());
        return Promise.all(pendingPromises);
    }

    /**
     * Creates new untitled document for SQL query and opens in new editor tab
     * with optional content
     */
    public async newQuery(content?: string, trackUri: boolean = true): Promise<vscode.TextEditor> {
        // Create a unique key for this operation to handle potential duplicates
        const operationKey = `${Date.now()}-${Math.random()}`;

        try {
            const operationPromise = this.createDocument(content, trackUri);
            this._pendingOperations.set(operationKey, operationPromise);

            const editor = await operationPromise;
            return editor;
        } finally {
            // Clean up the pending operation
            this._pendingOperations.delete(operationKey);
        }
    }

    private async createDocument(content?: string, trackUri?: boolean): Promise<vscode.TextEditor> {
        const doc = await this.vscodeWrapper.openMsSqlTextDocument(content);

        const editor = await this.vscodeWrapper.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: false,
            preview: false,
        });

        if (trackUri) {
            this.trackedUris.add(editor.document.uri.toString());
        }

        return editor;
    }

    public isUriTrackedByService(uri: string): boolean {
        return this.trackedUris.has(uri);
    }
}
