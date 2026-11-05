/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Narrow startup transport classification; never exposes the provider's raw error text. */
export function isTransientSqlStartupError(reason: string | undefined): boolean {
    if (!reason || /login failed|password|certificate|authentication/i.test(reason)) {
        return false;
    }
    return /pre-login handshake|forcibly closed|transport-level|being established|actively refused|not currently available|semaphore timeout/i.test(
        reason,
    );
}
