/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `syncSchemaProject` (Scope 2): decomposes a shadow source's inner
 * input (a live connection, or a dacpac via the injected decomposer seam) into a
 * committed `.sqlproj` tree at the source's `projectPath`.
 *   * `Connection` — resolves to a connection string and extracts the tree.
 *   * `Dacpac` — publishes to a throwaway DB via the `DacpacDecomposer`, then
 *     extracts that; the throwaway is always disposed.
 *   * missing `projectPath` / resolver / decomposer throw `SchemaResolutionError`.
 *   * `findEnclosingSqlProject` — flags a shadow `projectPath` nested inside
 *     another SQL project's folder (glob collision), stopping at the workspace root.
 */

import { expect } from "chai";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";

import { SourceOfTruthKind } from "../../src/cloudDeploy/environments/types";
import { SchemaResolutionError } from "../../src/cloudDeploy/validation/providers/schemaResolver";
import {
    DacpacDecomposer,
    findEnclosingSqlProject,
    syncSchemaProject,
} from "../../src/cloudDeploy/validation/providers/schemaSync";
import { FakeProcessProvider } from "../../src/cloudDeploy/validation/providers/processProvider";

function newSignal(): AbortSignal {
    return new AbortController().signal;
}

async function withTempWorkspace(run: (workspaceRoot: string) => Promise<void>): Promise<void> {
    const workspaceRoot = path.join(os.tmpdir(), `cd-sync-test-${randomUUID()}`);
    await fs.mkdir(workspaceRoot, { recursive: true });
    try {
        await run(workspaceRoot);
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
    }
}

suite("CloudDeploy SchemaSync", () => {
    suite("Connection source", () => {
        test("extracts the live schema into the project directory with sqlpackage", async () => {
            await withTempWorkspace(async (workspaceRoot) => {
                const processes = new FakeProcessProvider();
                let resolvedProfileId: string | undefined;
                const result = await syncSchemaProject(
                    {
                        source: {
                            kind: SourceOfTruthKind.Connection,
                            connectionProfileId: "prod-db",
                        },
                        projectPath: "db/shadow",
                    },
                    processes,
                    {
                        workspaceRoot,
                        sourceConnectionStringResolver: async (id) => {
                            resolvedProfileId = id;
                            return "Server=prod;Database=app;User ID=sa;Password=pw;";
                        },
                    },
                    newSignal(),
                );

                expect(resolvedProfileId).to.equal("prod-db");
                const extract = processes.invocations[0];
                expect(extract.command).to.equal("sqlpackage");
                expect(extract.args[0]).to.equal("/Action:Extract");
                expect(extract.args).to.include("/p:ExtractTarget=SchemaObjectType");
                expect(
                    result.projectFile.endsWith(path.join("db", "shadow", "shadow.sqlproj")),
                ).to.equal(true);
            });
        });

        test("writes the synthesized project file into the workspace", async () => {
            await withTempWorkspace(async (workspaceRoot) => {
                const processes = new FakeProcessProvider();
                const result = await syncSchemaProject(
                    {
                        source: {
                            kind: SourceOfTruthKind.Connection,
                            connectionProfileId: "prod-db",
                        },
                        projectPath: "db/shadow",
                    },
                    processes,
                    { workspaceRoot, sourceConnectionStringResolver: async () => "Server=prod;" },
                    newSignal(),
                );

                const written = await fs
                    .readFile(result.projectFile, "utf8")
                    .catch(() => undefined);
                expect(written).to.be.a("string");
                expect(written).to.contain("Microsoft.Build.Sql");
            });
        });

        test("throws without a projectPath", async () => {
            const processes = new FakeProcessProvider();
            let caught: unknown;
            try {
                await syncSchemaProject(
                    {
                        source: {
                            kind: SourceOfTruthKind.Connection,
                            connectionProfileId: "prod-db",
                        },
                    },
                    processes,
                    { sourceConnectionStringResolver: async () => "Server=prod;" },
                    newSignal(),
                );
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(SchemaResolutionError);
        });

        test("throws when no source-connection resolver is wired", async () => {
            await withTempWorkspace(async (workspaceRoot) => {
                const processes = new FakeProcessProvider();
                let caught: unknown;
                try {
                    await syncSchemaProject(
                        {
                            source: {
                                kind: SourceOfTruthKind.Connection,
                                connectionProfileId: "prod-db",
                            },
                            projectPath: "db/shadow",
                        },
                        processes,
                        { workspaceRoot },
                        newSignal(),
                    );
                } catch (err) {
                    caught = err;
                }
                expect(caught).to.be.instanceOf(SchemaResolutionError);
            });
        });
    });

    suite("Dacpac source", () => {
        test("publishes via the decomposer, extracts it, and disposes the throwaway", async () => {
            await withTempWorkspace(async (workspaceRoot) => {
                const processes = new FakeProcessProvider();
                let disposed = false;
                const decomposer: DacpacDecomposer = async () => ({
                    connectionString: "Server=throwaway;Database=shadow;",
                    dispose: async () => {
                        disposed = true;
                    },
                });

                const result = await syncSchemaProject(
                    {
                        source: { kind: SourceOfTruthKind.Dacpac, path: "artifacts/My.dacpac" },
                        projectPath: "db/shadow",
                    },
                    processes,
                    { workspaceRoot, dacpacDecomposer: decomposer },
                    newSignal(),
                );

                const extract = processes.invocations[0];
                expect(extract.command).to.equal("sqlpackage");
                expect(
                    extract.args.some(
                        (a) => a === "/SourceConnectionString:Server=throwaway;Database=shadow;",
                    ),
                ).to.equal(true);
                expect(disposed).to.equal(true);
                expect(result.projectFile.endsWith("shadow.sqlproj")).to.equal(true);
            });
        });

        test("throws when no dacpac decomposer is wired", async () => {
            await withTempWorkspace(async (workspaceRoot) => {
                const processes = new FakeProcessProvider();
                let caught: unknown;
                try {
                    await syncSchemaProject(
                        {
                            source: {
                                kind: SourceOfTruthKind.Dacpac,
                                path: "artifacts/My.dacpac",
                            },
                            projectPath: "db/shadow",
                        },
                        processes,
                        { workspaceRoot },
                        newSignal(),
                    );
                } catch (err) {
                    caught = err;
                }
                expect(caught).to.be.instanceOf(SchemaResolutionError);
            });
        });
    });

    suite("findEnclosingSqlProject", () => {
        test("reports the enclosing project when the shadow tree is nested inside another project's folder", async () => {
            await withTempWorkspace(async (workspaceRoot) => {
                await fs.mkdir(path.join(workspaceRoot, "db", "shadow"), { recursive: true });
                const parentProject = path.join(workspaceRoot, "db", "SlackDb.sqlproj");
                await fs.writeFile(parentProject, "<Project />");

                const enclosing = await findEnclosingSqlProject(
                    path.join(workspaceRoot, "db", "shadow"),
                    workspaceRoot,
                );

                expect(enclosing).to.equal(parentProject);
            });
        });

        test("returns undefined when the shadow tree is a sibling of the other project, not nested", async () => {
            await withTempWorkspace(async (workspaceRoot) => {
                await fs.mkdir(path.join(workspaceRoot, "db"), { recursive: true });
                await fs.mkdir(path.join(workspaceRoot, "shadow"), { recursive: true });
                await fs.writeFile(
                    path.join(workspaceRoot, "db", "SlackDb.sqlproj"),
                    "<Project />",
                );

                const enclosing = await findEnclosingSqlProject(
                    path.join(workspaceRoot, "shadow"),
                    workspaceRoot,
                );

                expect(enclosing).to.equal(undefined);
            });
        });

        test("returns undefined when no other SQL project exists above the shadow tree", async () => {
            await withTempWorkspace(async (workspaceRoot) => {
                await fs.mkdir(path.join(workspaceRoot, "db", "shadow"), { recursive: true });

                const enclosing = await findEnclosingSqlProject(
                    path.join(workspaceRoot, "db", "shadow"),
                    workspaceRoot,
                );

                expect(enclosing).to.equal(undefined);
            });
        });

        test("ignores the shadow project's own .sqlproj in its directory", async () => {
            await withTempWorkspace(async (workspaceRoot) => {
                const projectDir = path.join(workspaceRoot, "shadow");
                await fs.mkdir(projectDir, { recursive: true });
                await fs.writeFile(path.join(projectDir, "shadow.sqlproj"), "<Project />");

                const enclosing = await findEnclosingSqlProject(projectDir, workspaceRoot);

                expect(enclosing).to.equal(undefined);
            });
        });

        test("does not inspect folders above the workspace root", async () => {
            await withTempWorkspace(async (workspaceRoot) => {
                await fs.writeFile(path.join(workspaceRoot, "Outer.sqlproj"), "<Project />");
                const innerRoot = path.join(workspaceRoot, "inner");
                await fs.mkdir(path.join(innerRoot, "shadow"), { recursive: true });

                const enclosing = await findEnclosingSqlProject(
                    path.join(innerRoot, "shadow"),
                    innerRoot,
                );

                expect(enclosing).to.equal(undefined);
            });
        });
    });
});
