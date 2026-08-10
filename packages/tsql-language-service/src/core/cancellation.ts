/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DisposableLike {
    dispose(): void;
}

/** Structural cancellation boundary implemented by VS Code and other LSP hosts. */
export interface CancellationTokenLike {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: () => void): DisposableLike;
}
