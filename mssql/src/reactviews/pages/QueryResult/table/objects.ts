/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @returns whether the provided parameter is of type `object` but **not**
 *	`null`, an `array`, a `regexp`, nor a `date`.
 */
export function isObject(obj: unknown): obj is Object {
    // The method can't do a type cast since there are type (like strings) which
    // are subclasses of any put not positvely matched by the function. Hence type
    // narrowing results in wrong results.
    return (
        typeof obj === "object" &&
        obj !== null &&
        !Array.isArray(obj) &&
        !(obj instanceof RegExp) &&
        !(obj instanceof Date)
    );
}

/**
 * Copies all properties of source into destination. The optional parameter "overwrite" allows to control
 * if existing properties on the destination should be overwritten or not. Defaults to true (overwrite).
 */
export function mixin(destination: any, source: any, overwrite: boolean = true): any {
    if (!isObject(destination)) {
        return source;
    }

    if (isObject(source)) {
        Object.keys(source).forEach((key) => {
            if (key in destination) {
                if (overwrite) {
                    if (isObject(destination[key]) && isObject(source[key])) {
                        mixin(destination[key], source[key], overwrite);
                    } else {
                        destination[key] = source[key];
                    }
                }
            } else {
                destination[key] = source[key];
            }
        });
    }
    return destination;
}
