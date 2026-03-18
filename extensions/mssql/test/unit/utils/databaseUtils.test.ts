/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { isSystemDatabase } from "../../../src/utils/databaseUtils";
import { systemDatabases } from "../../../src/constants/constants";

chai.use(sinonChai);

suite("databaseUtils", () => {
    suite("systemDatabases", () => {
        test("should contain the four well-known system databases", () => {
            expect(systemDatabases).to.include.members(["master", "tempdb", "model", "msdb"]);
            expect(systemDatabases).to.have.lengthOf(4);
        });
    });

    suite("isSystemDatabase", () => {
        test("should return true for undefined", () => {
            expect(isSystemDatabase(undefined)).to.be.true;
        });

        test("should return true for empty string", () => {
            expect(isSystemDatabase("")).to.be.true;
        });

        test("should return true for each system database", () => {
            for (const db of systemDatabases) {
                expect(isSystemDatabase(db)).to.be.true;
            }
        });

        test("should be case-insensitive", () => {
            expect(isSystemDatabase("MASTER")).to.be.true;
            expect(isSystemDatabase("Master")).to.be.true;
            expect(isSystemDatabase("TempDb")).to.be.true;
        });

        test("should return false for user databases", () => {
            expect(isSystemDatabase("MyAppDb")).to.be.false;
            expect(isSystemDatabase("AdventureWorks")).to.be.false;
        });
    });
});
