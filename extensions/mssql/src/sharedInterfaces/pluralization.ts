/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function pluralize(value: string): string {
    if (/s$/i.test(value)) {
        return value;
    }
    if (/[^aeiou]y$/i.test(value)) {
        return `${value.slice(0, -1)}ies`;
    }
    if (/(s|x|z|ch|sh)$/i.test(value)) {
        return `${value}es`;
    }
    return `${value}s`;
}
