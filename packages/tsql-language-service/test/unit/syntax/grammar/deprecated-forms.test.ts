/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Spellings SQL Server has deprecated but still accepts.
//
// These matter more than their age suggests. A parser that rejects them reports errors on scripts
// that run, and legacy T-SQL is exactly the kind a developer opens in an editor rather than writes
// fresh. The conformance corpus covers them in `MiscDeprecatedIn110Tests.sql`; these tests pin the
// individual forms so a regression names the construct it broke instead of a file with two dozen
// errors in it.

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { assertValid, parse } = createSyntaxHarness("deprecated-forms.sql");

suite("T-SQL deprecated but accepted grammar", () => {
    // The pre-110 RAISERROR takes its severity and message positionally, with no parentheses. It is
    // told from the modern call by what follows the keyword: a bracket, or a number or variable.
    test("parses the unparenthesized RAISERROR", () => {
        const snapshot = parse(`
RAISERROR 50001 'Something went wrong';
RAISERROR 50001 N'Something went wrong';
RAISERROR 50001 @message;
RAISERROR -10 @message;
RAISERROR @severity @message;
`);

        assertValid(snapshot);
        assert.equal(
            (snapshot.tree.toString().match(/LegacyRaiserrorSeverity\(/g) ?? []).length,
            5,
            "every legacy form should bind a severity",
        );
        assert.equal(
            (snapshot.tree.toString().match(/LegacyRaiserrorMessage\(/g) ?? []).length,
            5,
            "every legacy form should bind a message",
        );
    });

    // The modern form must keep parsing as a call rather than being captured by the legacy rule.
    test("keeps the parenthesized RAISERROR distinct", () => {
        const snapshot = parse(`
RAISERROR ('Something went wrong', 16, 1);
RAISERROR (N'Formatted %s', 16, 1, @name) WITH NOWAIT, LOG;
`);

        assertValid(snapshot);
        assert.doesNotMatch(
            snapshot.tree.toString(),
            /LegacyRaiserrorSeverity\(/,
            "the parenthesized call must not read as the legacy positional form",
        );
        assert.match(snapshot.tree.toString(), /RaiserrorOptions\(/);
    });

    // `WITH APPEND` follows the event list rather than preceding FOR, which is what made it fail:
    // the trigger's other WITH clause sits before the event list.
    test("parses a trigger WITH option after its event list", () => {
        const snapshot = parse(`
CREATE TRIGGER trig1 ON t1 FOR INSERT WITH APPEND
AS
BEGIN
    PRINT '1';
END;
`);

        assertValid(snapshot);
        assert.match(snapshot.tree.toString(), /TriggerAppendClause\(/);
    });

    // The clause before FOR is a different one and must still parse where it always did.
    test("keeps the trigger WITH clause that precedes the event list", () => {
        const snapshot = parse(`
CREATE TRIGGER trig2 ON t1 WITH ENCRYPTION FOR UPDATE
AS
BEGIN
    PRINT '2';
END;
`);

        assertValid(snapshot);
        assert.match(snapshot.tree.toString(), /TriggerWithClause\(/);
    });

    // Legacy table hints, including the comma-less run SQL Server used to accept.
    test("parses legacy table hint spellings", () => {
        const snapshot = parse(`
SELECT c1 FROM t1 WITH (ROWLOCK SERIALIZABLE TABLOCK);
SELECT c1 FROM t1 WITH (XLOCK NOWAIT);
SELECT c1 FROM t1 WITH (INDEX (0, 1, ind2), FASTFIRSTROW, HOLDLOCK);
DELETE table1 WITH (fastfirstrow, HOLDLOCK);
`);

        assertValid(snapshot);
    });
});
