/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import VscodeWrapper from './vscodeWrapper';

/**
 * Service for creating untitled documents for SQL query
 */
export default class UntitledSqlDocumentService {

    constructor(private vscodeWrapper: VscodeWrapper) {
    }

    /**
     * Creates new untitled document for SQL query and opens in new editor tab
     */
    public newQuery(): Promise<boolean> {

        return new Promise<boolean>((resolve, reject) => {
            try {

                // Open an untitled document. So the  file doesn't have to exist in disk
                this.vscodeWrapper.openMsSqlTextDocument().then(doc => {
                    // Show the new untitled document in the editor's first tab and change the focus to it.
                    this.vscodeWrapper.showTextDocument(doc, 1, false).then(textDoc => {
                        resolve(true);
                    });
                });
            } catch (error) {
                reject(error);
            }
        });
    }
}

