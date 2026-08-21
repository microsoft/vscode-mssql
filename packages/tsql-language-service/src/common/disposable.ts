/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface Disposable {
    dispose(): void;
}

export const noOpDisposable: Disposable = Object.freeze({ dispose() {} });
