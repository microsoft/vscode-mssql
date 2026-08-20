/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Locale-independent UTF-16 ordering for stable keys, discriminators, and completion sort text. */
export function compareOrdinal(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
