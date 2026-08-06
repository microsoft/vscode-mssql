/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Writes a warning when a public MSSQL extension API member is accessed.
 */
export function warnPublicApiRetirement(memberName: string): void {
    console.warn(
        `[MSSQL] The public extension API member "${memberName}" will be deprecated soon and won't be available in a future release.`,
    );
}

/**
 * Wraps the public extension API so properties and methods emit a retirement warning when accessed.
 */
export function withPublicApiRetirementWarnings<T extends object>(
    api: T,
    warn: (memberName: string) => void = warnPublicApiRetirement,
): T {
    return new Proxy(api, {
        get(target, property, receiver) {
            if (
                typeof property === "string" &&
                Object.prototype.hasOwnProperty.call(target, property)
            ) {
                warn(property);
            }
            return Reflect.get(target, property, receiver);
        },
    });
}
