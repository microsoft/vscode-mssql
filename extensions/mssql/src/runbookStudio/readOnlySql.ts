/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isModifyingSql, stripSqlNonCode } from "../sql/sqlSafetyClassifier";

/** Conservative single-statement read-only guard shared by plan launch and
 * runtime admission. Pure so contract tests do not require a VS Code host. */
export function isReadOnlySql(sql: string): boolean {
    const code = stripSqlNonCode(sql).trim();
    if (code.length === 0 || isModifyingSql(sql)) {
        return false;
    }
    // Single statement only: a semicolon may appear solely as the final char.
    const withoutTrailingSemicolon = code.replace(/;\s*$/, "");
    if (withoutTrailingSemicolon.includes(";")) {
        return false;
    }
    return /^(select|with)\b/i.test(withoutTrailingSemicolon);
}
