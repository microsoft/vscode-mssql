/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function escapeStringLiteral(value: string): string {
    return value.replace(/'/g, "''");
}

export enum SqlPasswordValidationError {
    Length = "length",
    Complexity = "complexity",
}

export function getSqlPasswordValidationError(
    password: string,
): SqlPasswordValidationError | undefined {
    if (password.length < 8 || password.length > 128) {
        return SqlPasswordValidationError.Length;
    }

    const categoryCount = [
        /[A-Z]/.test(password),
        /[a-z]/.test(password),
        /\d/.test(password),
        /[^A-Za-z0-9]/.test(password),
    ].filter(Boolean).length;

    return categoryCount < 3 ? SqlPasswordValidationError.Complexity : undefined;
}
