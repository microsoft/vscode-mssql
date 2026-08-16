/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** The only sanctioned conversion of dashboard values into SQL text. */
export const sqlLiteral = Object.freeze({
    int(value: number): string {
        if (!Number.isSafeInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
            throw new RangeError("SQL int literal is out of range");
        }
        return String(value);
    },

    bigint(value: number | string): string {
        const text = String(value);
        if (!/^-?(0|[1-9]\d*)$/.test(text)) {
            throw new TypeError("Invalid SQL bigint literal");
        }
        const parsed = BigInt(text);
        if (parsed < -9_223_372_036_854_775_808n || parsed > 9_223_372_036_854_775_807n) {
            throw new RangeError("SQL bigint literal is out of range");
        }
        return text;
    },

    guid(value: string): string {
        if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                value,
            )
        ) {
            throw new TypeError("Invalid SQL uniqueidentifier literal");
        }
        return `CONVERT(uniqueidentifier, '${value}')`;
    },

    datetime2Utc(value: string | Date): string {
        const date = value instanceof Date ? value : new Date(value);
        if (!Number.isFinite(date.valueOf())) {
            throw new TypeError("Invalid UTC datetime literal");
        }
        const iso = date.toISOString();
        if (typeof value === "string" && !/Z$/i.test(value)) {
            throw new TypeError("Dashboard datetime literals must include a UTC designator");
        }
        return `CONVERT(datetime2(7), N'${iso}', 127)`;
    },

    nvarchar(value: string): string {
        if (value.includes("\0")) {
            throw new TypeError("SQL nvarchar literals cannot contain NUL");
        }
        return `N'${value.replace(/'/g, "''")}'`;
    },

    ident(value: string): string {
        if (value.length === 0 || value.includes("\0")) {
            throw new TypeError("Invalid SQL identifier");
        }
        return `[${value.replace(/]/g, "]]")}]`;
    },
});
