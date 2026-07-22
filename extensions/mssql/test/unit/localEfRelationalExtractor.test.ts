/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
    extractLocalEfRelationalModel,
    LocalEfRelationalExtractionError,
    readEfProjectMetadata,
} from "../../src/runbookStudio/runtime/localEfRelationalExtractor";
import { compareLocalEfRelationalModels } from "../../src/runbookStudio/runtime/localEfRelationalModel";

suite("Runbook Studio EF project metadata", () => {
    test("accepts one explicit SQL Server EF project toolchain", () => {
        const metadata = readEfProjectMetadata(
            Buffer.from(`
                <Project Sdk="Microsoft.NET.Sdk">
                  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
                  <ItemGroup>
                    <PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="8.0.19" />
                    <PackageReference Include="Microsoft.EntityFrameworkCore.Design">
                      <Version>8.0.19</Version>
                    </PackageReference>
                  </ItemGroup>
                </Project>`),
            "src/MyApp.Data/MyApp.Data.csproj",
        );

        expect(metadata).to.deep.equal({
            targetFramework: "net8.0",
            assemblyName: "MyApp.Data",
            providerVersion: "8.0.19",
            designVersion: "8.0.19",
        });
    });

    test("refuses centrally resolved package versions and ambiguous target frameworks", () => {
        expect(() =>
            readEfProjectMetadata(
                Buffer.from(`
                    <Project Sdk="Microsoft.NET.Sdk">
                      <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
                      <ItemGroup>
                        <PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer"
                                          Version="$(EfVersion)" />
                      </ItemGroup>
                    </Project>`),
                "App.csproj",
            ),
        ).to.throw(LocalEfRelationalExtractionError, "exact literal version");
        expect(() =>
            readEfProjectMetadata(
                Buffer.from(`
                    <Project Sdk="Microsoft.NET.Sdk">
                      <PropertyGroup><TargetFrameworks>net8.0;net9.0</TargetFrameworks></PropertyGroup>
                    </Project>`),
                "App.csproj",
            ),
        ).to.throw(LocalEfRelationalExtractionError, "one explicit TargetFramework");
    });
});

const LIVE_ENABLED = process.env.RBS2_EF_LIVE === "1";
const FIXTURE_ROOT =
    process.env.RBS2_EF_FIXTURE_ROOT ??
    path.resolve(__dirname, "../../../../../..", "test_assets", "hobbes-ef-model", "myapp");
const PROJECT_PATH = "src/MyApp.Data/MyApp.Data.csproj";
const EXPORTER_PROGRAM = path.resolve(
    __dirname,
    "../../..",
    "resources",
    "runbook-ef-exporter",
    "Program.cs",
);

suite("Runbook Studio EF exact-revision extraction live smoke (gated)", function () {
    this.timeout(10 * 60 * 1000);
    let sandbox: sinon.SinonSandbox;
    let temporaryParent: string;

    suiteSetup(function () {
        if (
            !LIVE_ENABLED ||
            !fs.existsSync(path.join(FIXTURE_ROOT, ".git")) ||
            !fs.existsSync(EXPORTER_PROGRAM)
        ) {
            this.skip();
        }
    });

    setup(() => {
        sandbox = sinon.createSandbox();
        temporaryParent = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-ef-extraction-"));
        sandbox.stub(vscode.workspace, "isTrusted").value(true);
        sandbox.stub(vscode.workspace, "workspaceFolders").value([
            {
                uri: vscode.Uri.file(FIXTURE_ROOT),
                name: "hobbes-ef-model",
                index: 0,
            } as vscode.WorkspaceFolder,
        ]);
    });

    teardown(() => {
        sandbox.restore();
        if (path.basename(temporaryParent).startsWith("rbs-ef-extraction-")) {
            fs.rmSync(temporaryParent, { recursive: true, force: true });
        }
    });

    test("extracts deterministic base and head models without changing the checkout", async () => {
        const beforeHead = git("rev-parse", "HEAD");
        const beforeStatus = git("status", "--porcelain");
        const request = {
            repositoryPath: FIXTURE_ROOT,
            projectPath: PROJECT_PATH,
            dbContext: "AppDbContext",
            temporaryParentPath: temporaryParent,
            exporterProgramPath: EXPORTER_PROGRAM,
            trustedWorkspaceRoots: [FIXTURE_ROOT],
        };

        const main = await extractLocalEfRelationalModel(
            { ...request, revision: "main" },
            () => false,
        );
        const repeatedMain = await extractLocalEfRelationalModel(
            { ...request, revision: "main" },
            () => false,
        );
        const development = await extractLocalEfRelationalModel(
            { ...request, revision: "development" },
            () => false,
        );
        const diff = compareLocalEfRelationalModels(main.model, development.model);

        expect(main.model.modelSha256).to.equal(repeatedMain.model.modelSha256);
        expect(development.model.modelSha256).not.to.equal(main.model.modelSha256);
        expect(diff.comparable).to.equal(true);
        expect(diff.changes).to.deep.include.members([
            {
                kind: "addTable",
                objectType: "table",
                path: "[dbo].[AuditLogs]",
                risk: "safe",
                changedProperties: [],
            },
            {
                kind: "addColumn",
                objectType: "column",
                path: "[Application].[Customers].[Email]",
                risk: "safe",
                changedProperties: [],
            },
        ]);
        expect(diff.changes.map((change) => change.kind)).to.include.members([
            "addIndex",
            "dropColumn",
            "addColumn",
        ]);
        expect(diff.renameCandidates).to.deep.include({
            objectType: "column",
            fromPath: "[Sales].[Orders].[Description]",
            toPath: "[Sales].[Orders].[Summary]",
            similarity: 1,
        });
        expect(git("rev-parse", "HEAD")).to.equal(beforeHead);
        expect(git("status", "--porcelain")).to.equal(beforeStatus);
        expect(fs.readdirSync(temporaryParent)).to.deep.equal([]);
    });
});

function git(...args: string[]): string {
    const result = spawnSync("git", args, {
        cwd: FIXTURE_ROOT,
        encoding: "utf8",
        windowsHide: true,
    });
    if (result.status !== 0) {
        throw new Error("The EF fixture Git operation failed.");
    }
    return result.stdout.trim();
}
