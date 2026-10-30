/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { SqlReadError, classifySqlError, statusForError } = require("../dist/index.js");

const serverError = (errorNumber) => new SqlReadError("failed", "server", errorNumber);

suite("SQL error categories", () => {
    test("treats a deadlock victim as transient, so the read can be retried", () => {
        assert.equal(classifySqlError(serverError(1205)), "transient");
        assert.equal(statusForError(serverError(1205)), "temporarilyUnavailable");
    });

    test("puts permission, missing object, and other errors in their categories", () => {
        assert.equal(classifySqlError(serverError(229)), "permission");
        assert.equal(classifySqlError(serverError(208)), "unsupported");
        assert.equal(classifySqlError(serverError(102)), "other");
        assert.equal(classifySqlError(new Error("not a read error")), "other");
    });
});
