/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("column-key-recovery.sql");

const messages = (sql: string): readonly string[] =>
    parse(sql).diagnostics.map(({ message }) => message);

const addValueOptions =
    "COLUMN_MASTER_KEY = cmk, ALGORITHM = 'algorithm_name'," +
    " ENCRYPTED_VALUE = 0xBADF00DBADF00D";

const masterKeyOptions =
    "KEY_STORE_PROVIDER_NAME = 'MSSQL_CERTIFICATE_STORE', KEY_PATH = 'Current User/Personal/f22'";

suite("column key recovery diagnostics", () => {
    test("accepts the supported column key statements", () => {
        assertValid(`ALTER COLUMN ENCRYPTION KEY myCEK ADD VALUE (${addValueOptions})`);
        assertValid(
            "ALTER COLUMN ENCRYPTION KEY myCEK ADD VALUE" +
                " (COLUMN MASTER KEY DEFINITION = cmk, ALGORITHM = 'a', ENCRYPTED_VALUE = 0xAB)",
        );
        assertValid("ALTER COLUMN ENCRYPTION KEY myCEK DROP VALUE (COLUMN_MASTER_KEY = cmk)");
        assertValid(`CREATE COLUMN MASTER KEY MyCMK WITH (${masterKeyOptions})`);
        assertValid(`CREATE COLUMN MASTER KEY DEFINITION MyCMK WITH (${masterKeyOptions})`);
        assertValid("DROP COLUMN ENCRYPTION KEY myCEK");
        assertValid("DROP COLUMN MASTER KEY MyCMK");
        assertValid("DROP COLUMN MASTER KEY DEFINITION MyCMK");
    });

    test("reports a quoted key name and the statement recovery it starts", () => {
        assert.deepEqual(
            messages(`ALTER COLUMN ENCRYPTION KEY 'myCEK' ADD VALUE (${addValueOptions})`),
            [
                "Incorrect syntax near ''myCEK''.  Expecting ID, or QUOTED_ID.",
                "Incorrect syntax near 'VALUE'.  Expecting ADD_COUNTER, ADD_SENSITIVITY, or ADD_SIGNATURE.",
                "Incorrect syntax near 'COLUMN_MASTER_KEY'.  Expecting '(', or SELECT.",
            ],
        );
        assert.deepEqual(messages("DROP COLUMN ENCRYPTION KEY 'myCEK'"), [
            "Incorrect syntax near ''myCEK''.  Expecting ID, or QUOTED_ID.",
        ]);
        assert.deepEqual(messages("DROP COLUMN MASTER KEY 'MyCMK'"), [
            "Incorrect syntax near ''MyCMK''.  Expecting ID, or QUOTED_ID.",
        ]);
    });

    test("reports a quoted master key name inside a value list", () => {
        assert.deepEqual(
            messages(
                "ALTER COLUMN ENCRYPTION KEY myCEK ADD VALUE (COLUMN_MASTER_KEY = 'cmk'," +
                    " ALGORITHM = 'a' ENCRYPTED_VALUE = 0xAB)",
            ),
            ["Incorrect syntax near ''cmk''.  Expecting ID, or QUOTED_ID."],
        );
        assert.deepEqual(
            messages("ALTER COLUMN ENCRYPTION KEY myCEK DROP VALUE (COLUMN_MASTER_KEY = 'cmk')"),
            ["Incorrect syntax near ''cmk''.  Expecting ID, or QUOTED_ID."],
        );
    });

    test("reports a missing separator and an unterminated value list", () => {
        assert.deepEqual(
            messages(
                "ALTER COLUMN ENCRYPTION KEY myCEK ADD VALUE (COLUMN_MASTER_KEY = cmk," +
                    " ALGORITHM = 'a' ENCRYPTED_VALUE = 0xAB)",
            ),
            ["Incorrect syntax near 'ENCRYPTED_VALUE'.  Expecting ')', or ','."],
        );
        assert.deepEqual(
            messages(`ALTER COLUMN ENCRYPTION KEY myCEK ADD VALUE (${addValueOptions}`),
            ["Incorrect syntax near 'End Of File'.  Expecting ')', or ','."],
        );
        assert.deepEqual(
            messages("ALTER COLUMN ENCRYPTION KEY myCEK DROP VALUE (COLUMN_MASTER_KEY = cmk"),
            ["Incorrect syntax near 'End Of File'.  Expecting ')'."],
        );
    });

    test("rejects the qualified master key option in a DROP VALUE list", () => {
        assert.deepEqual(
            messages(
                "ALTER COLUMN ENCRYPTION KEY myCEK DROP VALUE" +
                    " (COLUMN MASTER KEY DEFINITION = cmk)",
            ),
            ["Incorrect syntax near 'COLUMN'.  Expecting CEMK_COL_MASTER_KEY."],
        );
    });

    test("reports master key option contract violations", () => {
        assert.deepEqual(
            messages(
                "CREATE COLUMN MASTER KEY MyCMK WITH (KEY_STORE_PROVIDER_NAME =" +
                    " MSSQL_CERTIFICATE_STORE, KEY_PATH = 'p')",
            ),
            ["Incorrect syntax near 'MSSQL_CERTIFICATE_STORE'.  Expecting STRING, or TEXT_LEX."],
        );
        assert.deepEqual(
            messages(
                "CREATE COLUMN MASTER KEY MyCMK WITH (KEY_STORE_PROVIDER_NAME = 'store'" +
                    " KEY_PATH = 'p')",
            ),
            ["Incorrect syntax near 'KEY_PATH'.  Expecting ','."],
        );
        assert.deepEqual(messages(`CREATE COLUMN MASTER KEY MyCMK WITH (${masterKeyOptions}`), [
            "Incorrect syntax near 'End Of File'.  Expecting ')', or ','.",
        ]);
    });

    test("bounds recovery to the statement that owns it", () => {
        const sql =
            "DROP COLUMN MASTER KEY 'MyCMK';\n" +
            "GO\n" +
            "SELECT 1;\n" +
            "GO\n" +
            "DROP COLUMN ENCRYPTION KEY 'myCEK';\n";
        assert.deepEqual(messages(sql), [
            "Incorrect syntax near ''MyCMK''.  Expecting ID, or QUOTED_ID.",
            "Incorrect syntax near ''myCEK''.  Expecting ID, or QUOTED_ID.",
        ]);
    });

    test("leaves comments and strings that mention the option words alone", () => {
        assertValid(
            "-- ALTER COLUMN ENCRYPTION KEY 'x' ADD VALUE (COLUMN_MASTER_KEY = 'y')\n" +
                "SELECT 'ALTER COLUMN MASTER KEY ''z''' AS c",
        );
    });
});
