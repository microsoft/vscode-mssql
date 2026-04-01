/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { areCompatibleEntraAccountIds } from "../../src/azure/vscodeEntraMfaUtils";

suite("vscodeEntraMfaUtils", () => {
    suite("areCompatibleEntraAccountIds", () => {
        test("returns true for exact match", () => {
            expect(areCompatibleEntraAccountIds("user@example.com", "user@example.com")).to.be.true;
        });

        test("returns true when currentAccountId starts with expectedAccountId (legacy prefix)", () => {
            // Legacy account IDs may have extra suffixes appended (e.g. "|tenantId")
            expect(areCompatibleEntraAccountIds("user@example.com|tenant-abc", "user@example.com"))
                .to.be.true;
        });

        test("returns true when expectedAccountId starts with currentAccountId (reverse legacy prefix)", () => {
            expect(areCompatibleEntraAccountIds("user@example.com", "user@example.com|tenant-abc"))
                .to.be.true;
        });

        test("returns false when ids share a common prefix but neither is a prefix of the other", () => {
            expect(areCompatibleEntraAccountIds("account-abc-1", "account-abc-2")).to.be.false;
        });

        test("returns true when one id is a strict prefix of the other (potential ambiguous prefix case)", () => {
            // IDs like "user@example.com" and "user@example.com2" where the former is a prefix of
            // the latter. The function uses startsWith so these are treated as compatible.
            // This documents the known behavior for cases where legacy IDs differ by a suffix.
            expect(areCompatibleEntraAccountIds("user@example.com", "user@example.com|tenant-123"))
                .to.be.true;
            expect(areCompatibleEntraAccountIds("user@example.com|tenant-123", "user@example.com"))
                .to.be.true;
        });

        test("returns false when currentAccountId is undefined", () => {
            expect(areCompatibleEntraAccountIds(undefined, "user@example.com")).to.be.false;
        });

        test("returns false when expectedAccountId is undefined", () => {
            expect(areCompatibleEntraAccountIds("user@example.com", undefined)).to.be.false;
        });

        test("returns false when both ids are undefined", () => {
            expect(areCompatibleEntraAccountIds(undefined, undefined)).to.be.false;
        });

        test("returns false for completely different ids", () => {
            expect(areCompatibleEntraAccountIds("user1@example.com", "user2@example.com")).to.be
                .false;
        });
    });
});
