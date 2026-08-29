/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { DabCliService, parseValidationDiagnostics } from "../../../src/dab/dabCliService";
import { Dab } from "../../../src/sharedInterfaces/dab";
import { createStubLogger } from "../utils";

suite("DabCliService", () => {
    let sandbox: sinon.SinonSandbox;
    let values: Map<string, unknown>;
    let context: vscode.ExtensionContext;
    let service: DabCliService;

    setup(() => {
        sandbox = sinon.createSandbox();
        values = new Map();
        context = {
            globalStorageUri: vscode.Uri.file(path.join(process.cwd(), ".dab-cli-test")),
            globalState: {
                get: <T>(key: string, defaultValue?: T) =>
                    (values.has(key) ? values.get(key) : defaultValue) as T,
                update: async (key: string, value: unknown) => {
                    values.set(key, value);
                },
            },
        } as unknown as vscode.ExtensionContext;
        service = new DabCliService(context, createStubLogger(sandbox));
    });

    teardown(() => sandbox.restore());

    test("does not automatically retry a persisted installation failure", async () => {
        const failure: Dab.DabCliSetupState = {
            status: "installationFailed",
            version: Dab.DAB_CLI_VERSION,
            reason: "offline",
        };
        values.set("mssql.dab.cli.setupState", failure);
        const install = sandbox.stub(service as any, "install");

        expect(await service.ensureInstalled()).to.deep.equal(failure);
        expect(install).not.to.have.been.called;
    });

    test("retries only when explicitly requested", async () => {
        values.set("mssql.dab.cli.setupState", {
            status: "missingRuntime",
            version: Dab.DAB_CLI_VERSION,
            reason: "missing",
        } satisfies Dab.DabCliSetupState);
        const ready: Dab.DabCliSetupState = {
            status: "ready",
            version: Dab.DAB_CLI_VERSION,
        };
        const install = sandbox.stub(service as any, "install").resolves(ready);

        expect(await service.ensureInstalled(true)).to.deep.equal(ready);
        expect(install).to.have.been.calledOnce;
    });

    test("returns blocked validation without starting setup", async () => {
        const failure: Dab.DabCliSetupState = {
            status: "missingRuntime",
            version: Dab.DAB_CLI_VERSION,
            reason: "missing",
        };
        values.set("mssql.dab.cli.setupState", failure);

        expect(await service.validateConfig("{}", "secret")).to.deep.equal({
            status: "blocked",
            setup: failure,
        });
    });

    test("parses schema failures into separate typed diagnostics", () => {
        const diagnostics = parseValidationDiagnostics(
            "fail: > Total schema validation errors: 2 > First schema problem. at 29:28 > Second schema problem. at 115:35\n" +
                "warn: Deprecated setting. at 4:2",
        );

        expect(diagnostics).to.deep.equal([
            { severity: "error", message: "First schema problem.", line: 29, column: 28 },
            { severity: "error", message: "Second schema problem.", line: 115, column: 35 },
            { severity: "warning", message: "Deprecated setting.", line: 4, column: 2 },
        ]);
    });

    test("keeps continuation text with its diagnostic", () => {
        const diagnostics = parseValidationDiagnostics(
            "fail: Database connection failed.\nLogin failed for user.",
        );

        expect(diagnostics).to.deep.equal([
            {
                severity: "error",
                message: "Database connection failed.\nLogin failed for user.",
            },
        ]);
    });
});
