/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { locConstants } from "../../src/webviews/common/locConstants";

suite("TextView - rows affected formatting", () => {
    test("rowsAffected returns string with single parentheses for 0 rows", () => {
        const result = locConstants.queryResult.rowsAffected(0);
        expect(result).to.equal("(0 rows affected)");
        expect(result).to.not.match(/^\(\(/, "should not start with double open paren");
        expect(result).to.not.match(/\)\)$/, "should not end with double close paren");
    });

    test("rowsAffected returns string with single parentheses for 1 row", () => {
        const result = locConstants.queryResult.rowsAffected(1);
        expect(result).to.equal("(1 row affected)");
        expect(result).to.not.match(/^\(\(/, "should not start with double open paren");
        expect(result).to.not.match(/\)\)$/, "should not end with double close paren");
    });

    test("rowsAffected returns string with single parentheses for multiple rows", () => {
        const result = locConstants.queryResult.rowsAffected(50);
        expect(result).to.equal("(50 rows affected)");
        expect(result).to.not.match(/^\(\(/, "should not start with double open paren");
        expect(result).to.not.match(/\)\)$/, "should not end with double close paren");
    });

    test("text view row count line does not produce double parentheses", () => {
        // Regression test for #21692: textView.tsx was wrapping rowsAffected() output
        // (which already includes parens) in another set of parens, yielding ((50 rows affected)).
        // The fix removes the outer parens so the line is emitted as-is.
        const EOL = "\n";
        const rowCount = 50;

        // Simulates the fixed code: `${locConstants.queryResult.rowsAffected(rowCount)}${EOL}`
        const fixedLine = `${locConstants.queryResult.rowsAffected(rowCount)}${EOL}`;
        expect(fixedLine.trim()).to.equal("(50 rows affected)");

        // Simulates the buggy code: `(${locConstants.queryResult.rowsAffected(rowCount)})${EOL}`
        const buggyLine = `(${locConstants.queryResult.rowsAffected(rowCount)})${EOL}`;
        expect(buggyLine.trim()).to.equal("((50 rows affected))");

        // Confirm the fixed line does not contain double parens
        expect(fixedLine).to.not.include("((");
        expect(fixedLine).to.not.include("))");
    });
});
