/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlReadError } from "./sqlReader";

export type SqlErrorCategory =
    /** The principal does not have the necessary permission. */
    | "permission"
    /** The platform or version does not have the object, column, or statement. */
    | "unsupported"
    /** A timeout, throttling, failover, connection loss, or cancel. A retry can succeed. */
    | "transient"
    | "other";

const permissionErrors = new Set([229, 230, 262, 297, 300, 916, 15247]);
const unsupportedErrors = new Set([207, 208, 2812, 40517]);
const transientErrors = new Set([-2, 1222, 24801, 40197, 40501, 40613, 49918, 49919, 49920]);

/**
 * Puts a read failure in a category from its kind and SQL error number.
 */
export function classifySqlError(error: unknown): SqlErrorCategory {
    if (!(error instanceof SqlReadError)) {
        return "other";
    }
    if (error.kind !== "server") {
        return "transient";
    }
    const errorNumber = error.errorNumber;
    if (errorNumber === undefined) {
        return "other";
    }
    if (permissionErrors.has(errorNumber)) {
        return "permission";
    }
    if (unsupportedErrors.has(errorNumber)) {
        return "unsupported";
    }
    if (transientErrors.has(errorNumber)) {
        return "transient";
    }
    return "other";
}
