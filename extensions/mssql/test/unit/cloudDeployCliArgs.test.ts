/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import { CliUsageError, parseCliArgs } from "../../src/cloudDeploy/cli/args";

const REQUIRED = ["--env", "dev", "--config", "c.json", "--out", "o.zip"] as const;

suite("CloudDeploy CLI args", () => {
    suite("parseCliArgs", () => {
        test("parses the three required flags", () => {
            const args = parseCliArgs([...REQUIRED]);
            expect(args.envId).to.equal("dev");
            expect(args.configPath).to.equal("c.json");
            expect(args.outPath).to.equal("o.zip");
        });

        test("accepts a leading run-gates command token", () => {
            const args = parseCliArgs(["run-gates", ...REQUIRED]);
            expect(args.envId).to.equal("dev");
        });

        test("captures the optional pass-through flags", () => {
            const args = parseCliArgs([
                ...REQUIRED,
                "--workspace",
                "/w",
                "--source-commit",
                "abc123",
                "--source-ref",
                "42",
                "--baseline",
                "main.cdrun.zip",
                "--report-out",
                "report.md",
            ]);
            expect(args.workspaceRoot).to.equal("/w");
            expect(args.sourceCommit).to.equal("abc123");
            expect(args.sourceRef).to.equal("42");
            expect(args.baselinePath).to.equal("main.cdrun.zip");
            expect(args.reportOut).to.equal("report.md");
        });

        test("leaves optional flags undefined when omitted", () => {
            const args = parseCliArgs([...REQUIRED]);
            expect(args.workspaceRoot).to.be.undefined;
            expect(args.sourceCommit).to.be.undefined;
            expect(args.sourceRef).to.be.undefined;
            expect(args.baselinePath).to.be.undefined;
            expect(args.reportOut).to.be.undefined;
        });

        test("throws CliUsageError when --env is missing", () => {
            expect(() => parseCliArgs(["--config", "c.json", "--out", "o.zip"])).to.throw(
                CliUsageError,
                /--env/,
            );
        });

        test("throws CliUsageError when --config is missing", () => {
            expect(() => parseCliArgs(["--env", "dev", "--out", "o.zip"])).to.throw(
                CliUsageError,
                /--config/,
            );
        });

        test("throws CliUsageError when --out is missing", () => {
            expect(() => parseCliArgs(["--env", "dev", "--config", "c.json"])).to.throw(
                CliUsageError,
                /--out/,
            );
        });

        test("throws CliUsageError on an unknown flag", () => {
            expect(() => parseCliArgs([...REQUIRED, "--bogus", "x"])).to.throw(CliUsageError);
        });

        test("throws CliUsageError on an unexpected positional", () => {
            expect(() => parseCliArgs(["frobnicate", ...REQUIRED])).to.throw(
                CliUsageError,
                /Unexpected/,
            );
        });

        test("treats --help as a CliUsageError flagged isHelp", () => {
            let caught: unknown;
            try {
                parseCliArgs(["--help"]);
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(CliUsageError);
            expect((caught as CliUsageError).isHelp).to.equal(true);
        });
    });
});
