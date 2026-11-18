/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { containsSqlCmdSyntax } from "../../src/sql/sqlcmdSyntaxDetector";

suite("SQLCMD syntax detector", () => {
    const sqlCmdScripts: [string, string][] = [
        [":setvar", ":setvar DatabaseName Test"],
        [":r", ":r ./script.sql"],
        [":on error", ":on error exit"],
        [":connect", ":connect localhost"],
        [":exit", ":exit"],
        [":quit", ":quit"],
        [":out", ":out stdout"],
        [":error", ":error stderr"],
        [":listvar", ":listvar"],
        [":list", ":list"],
        [":reset", ":reset"],
        [":ed", ":ed"],
        [":help", ":help"],
        [":perftrace", ":perftrace stdout"],
        [":serverlist", ":serverlist"],
        [":xml", ":xml on"],
        [":!!", ":!! dir"],
        ["indented command", "SELECT 1\n  \t:setvar x 1"],
        ["uppercase command", ":ON ERROR IGNORE"],
        ["variable reference", "SELECT $(ColumnName) FROM t"],
        ["variable in brackets", "USE [$(DatabaseName)]"],
        ["variable in double quotes", 'SELECT "$(ColumnName)" FROM t'],
        ["variable after a closed block comment", "/* note */ SELECT $(var_1-a)"],
    ];

    for (const [name, script] of sqlCmdScripts) {
        test(`detects ${name}`, () => {
            expect(containsSqlCmdSyntax(script)).to.be.true;
        });
    }

    const plainScripts: [string, string][] = [
        ["empty script", ""],
        ["plain T-SQL", "SELECT 1\nGO\nSELECT name FROM sys.databases"],
        ["mid-line colon", "SELECT 1 :setvar x 1"],
        ["colon in a string", "SELECT ':setvar x 1'"],
        ["line-start colon in a multi-line string", "SELECT '\n:setvar x 1\n'"],
        ["command in a line comment", "-- :setvar x 1"],
        ["command in a block comment", "/*\n:setvar x 1\n*/"],
        ["command in a nested block comment", "/* /* */\n:setvar x 1\n*/"],
        ["unknown command", ":setvariable x 1"],
        [":on without error", ":on"],
        ["double colon", "::fn_listextendedproperty"],
        ["variable in a string", "SELECT '$(var)'"],
        ["variable in a line comment", "SELECT 1 -- $(var)"],
        ["variable in a block comment", "SELECT 1 /* $(var) */"],
        ["variable in a multi-line block comment", "/*\n$(var)\n*/"],
        ["variable starting with a digit", "SELECT $(1var)"],
        ["unclosed variable", "SELECT $(var"],
        ["empty variable", "SELECT $()"],
    ];

    for (const [name, script] of plainScripts) {
        test(`does not detect ${name}`, () => {
            expect(containsSqlCmdSyntax(script)).to.be.false;
        });
    }
});
