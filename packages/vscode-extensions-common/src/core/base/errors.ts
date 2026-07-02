/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function illegalState(message?: string): Error {
    return new Error(message ? `Illegal state: ${message}` : "Illegal state");
}
