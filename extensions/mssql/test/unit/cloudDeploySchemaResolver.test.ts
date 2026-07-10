/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `resolveSchemaToDacpac` (Scope 2): the shared chokepoint that turns
 * any source of truth into a dacpac path.
 *   * `Dacpac` — returns the path directly, no spawn, dispose is a no-op.
 *   * `SqlProj` — `dotnet build` into an ISOLATED per-run directory (so two
 *     concurrent builds never share `bin`/`obj` and deadlock on MSBuild locks).
 *   * `Connection` — `sqlpackage /Action:Extract` (read-only) into a temp dacpac
 *     via the injected source-connection resolver; requires that resolver.
 *   * a non-zero build / extract exit throws `SchemaResolutionError`.
 */

import { expect } from "chai";
import * as fs from "fs";

import { SourceOfTruthKind } from "../../src/cloudDeploy/environments/types";
import {
    SchemaResolutionError,
    resolveSchemaToDacpac,
} from "../../src/cloudDeploy/validation/providers/schemaResolver";
import {
    FakeProcessProvider,
    ProcessProvider,
} from "../../src/cloudDeploy/validation/providers/processProvider";

function newSignal(): AbortSignal {
    return new AbortController().signal;
}

suite("CloudDeploy SchemaResolver", () => {
    suite("Dacpac source", () => {
        test("returns the path directly without spawning a build", async () => {
            const processes = new FakeProcessProvider();
            const resolved = await resolveSchemaToDacpac(
                { kind: SourceOfTruthKind.Dacpac, path: "/abs/MyProject.dacpac" },
                processes,
                {},
                newSignal(),
            );

            expect(resolved.dacpacPath).to.equal("/abs/MyProject.dacpac");
            expect(processes.invocations).to.have.lengthOf(0);
            await resolved.dispose(); // no-op, must not throw
        });
    });

    suite("SqlProj source", () => {
        test("builds the project with dotnet", async () => {
            const processes = new FakeProcessProvider();
            const resolved = await resolveSchemaToDacpac(
                { kind: SourceOfTruthKind.SqlProj, path: "/abs/MyProject.sqlproj" },
                processes,
                {},
                newSignal(),
            );

            expect(processes.invocations).to.have.lengthOf(1);
            expect(processes.invocations[0].command).to.equal("dotnet");
            expect(processes.invocations[0].args[0]).to.equal("build");
            expect(resolved.dacpacPath.endsWith("MyProject.dacpac")).to.equal(true);
            await resolved.dispose();
        });

        test("isolates the build output (bin + obj) into a unique per-run directory", async () => {
            const processes = new FakeProcessProvider();
            const resolved = await resolveSchemaToDacpac(
                { kind: SourceOfTruthKind.SqlProj, path: "/abs/MyProject.sqlproj" },
                processes,
                {},
                newSignal(),
            );

            const args = processes.invocations[0].args;
            expect(args).to.include("-o");
            expect(
                args.some((a) => a.startsWith("/p:BaseIntermediateOutputPath=")),
                "obj must be isolated too, not just bin",
            ).to.equal(true);
            await resolved.dispose();
        });

        test("two resolves of the same project use different output directories", async () => {
            const processes = new FakeProcessProvider();
            const first = await resolveSchemaToDacpac(
                { kind: SourceOfTruthKind.SqlProj, path: "/abs/MyProject.sqlproj" },
                processes,
                {},
                newSignal(),
            );
            const second = await resolveSchemaToDacpac(
                { kind: SourceOfTruthKind.SqlProj, path: "/abs/MyProject.sqlproj" },
                processes,
                {},
                newSignal(),
            );

            const dirOf = (invocationIndex: number): string => {
                const args = processes.invocations[invocationIndex].args;
                return args[args.indexOf("-o") + 1];
            };
            expect(dirOf(0)).to.not.equal(dirOf(1));
            await first.dispose();
            await second.dispose();
        });

        test("respects an explicit build output directory (no isolation, no obj override)", async () => {
            const processes = new FakeProcessProvider();
            const resolved = await resolveSchemaToDacpac(
                { kind: SourceOfTruthKind.SqlProj, path: "/abs/MyProject.sqlproj" },
                processes,
                { buildOutputDirectory: "/pinned/out" },
                newSignal(),
            );

            const args = processes.invocations[0].args;
            expect(args[args.indexOf("-o") + 1]).to.equal("/pinned/out");
            expect(args.some((a) => a.startsWith("/p:BaseIntermediateOutputPath="))).to.equal(
                false,
            );
            await resolved.dispose();
        });

        test("throws SchemaResolutionError when the build fails", async () => {
            const processes = new FakeProcessProvider();
            processes.respond("dotnet", "build", {
                mode: "exit",
                exitCode: 1,
                stderr: "MSB1009",
            });

            let caught: unknown;
            try {
                await resolveSchemaToDacpac(
                    { kind: SourceOfTruthKind.SqlProj, path: "/abs/MyProject.sqlproj" },
                    processes,
                    {},
                    newSignal(),
                );
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(SchemaResolutionError);
        });
    });

    suite("Connection (live database) source", () => {
        test("extracts the live schema with sqlpackage via the source resolver", async () => {
            const processes = new FakeProcessProvider();
            let resolvedProfileId: string | undefined;
            const resolved = await resolveSchemaToDacpac(
                { kind: SourceOfTruthKind.Connection, connectionProfileId: "prod-db" },
                processes,
                {
                    sourceConnectionStringResolver: async (id) => {
                        resolvedProfileId = id;
                        return "Server=prod;Database=app;User ID=sa;Password=pw;";
                    },
                },
                newSignal(),
            );

            expect(resolvedProfileId).to.equal("prod-db");
            expect(processes.invocations).to.have.lengthOf(1);
            expect(processes.invocations[0].command).to.equal("sqlpackage");
            expect(processes.invocations[0].args[0]).to.equal("/Action:Extract");
            expect(
                processes.invocations[0].args.some((a) => a.startsWith("/SourceConnectionString:")),
            ).to.equal(true);
            expect(resolved.dacpacPath.endsWith(".dacpac")).to.equal(true);
            await resolved.dispose();
        });

        test("throws when no source-connection resolver is wired", async () => {
            const processes = new FakeProcessProvider();
            let caught: unknown;
            try {
                await resolveSchemaToDacpac(
                    { kind: SourceOfTruthKind.Connection, connectionProfileId: "prod-db" },
                    processes,
                    {},
                    newSignal(),
                );
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(SchemaResolutionError);
        });

        test("throws SchemaResolutionError when the extract fails", async () => {
            const processes = new FakeProcessProvider();
            processes.respond("sqlpackage", "/Action:Extract", {
                mode: "exit",
                exitCode: 1,
                stderr: "login failed",
            });

            let caught: unknown;
            try {
                await resolveSchemaToDacpac(
                    { kind: SourceOfTruthKind.Connection, connectionProfileId: "prod-db" },
                    processes,
                    { sourceConnectionStringResolver: async () => "Server=prod;" },
                    newSignal(),
                );
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(SchemaResolutionError);
        });
    });

    suite("Shadow (decomposed) source", () => {
        test("decomposes the live database into a project tree with sqlpackage", async () => {
            const processes = new FakeProcessProvider();
            let resolvedProfileId: string | undefined;
            const resolved = await resolveSchemaToDacpac(
                {
                    kind: SourceOfTruthKind.Shadow,
                    source: { kind: SourceOfTruthKind.Connection, connectionProfileId: "prod-db" },
                },
                processes,
                {
                    sourceConnectionStringResolver: async (id) => {
                        resolvedProfileId = id;
                        return "Server=prod;Database=app;User ID=sa;Password=pw;";
                    },
                },
                newSignal(),
            );

            expect(resolvedProfileId).to.equal("prod-db");
            expect(processes.invocations[0].command).to.equal("sqlpackage");
            expect(processes.invocations[0].args[0]).to.equal("/Action:Extract");
            expect(processes.invocations[0].args).to.include("/p:ExtractTarget=SchemaObjectType");
            await resolved.dispose();
        });

        test("builds the synthesized shadow project into a dacpac with dotnet", async () => {
            const processes = new FakeProcessProvider();
            const resolved = await resolveSchemaToDacpac(
                {
                    kind: SourceOfTruthKind.Shadow,
                    source: { kind: SourceOfTruthKind.Connection, connectionProfileId: "prod-db" },
                },
                processes,
                { sourceConnectionStringResolver: async () => "Server=prod;" },
                newSignal(),
            );

            expect(processes.invocations).to.have.lengthOf(2);
            expect(processes.invocations[1].command).to.equal("dotnet");
            expect(processes.invocations[1].args[0]).to.equal("build");
            expect(resolved.dacpacPath.endsWith("ShadowDb.dacpac")).to.equal(true);
            await resolved.dispose();
        });

        test("with a projectPath, builds the committed sqlproj instead of decomposing", async () => {
            const processes = new FakeProcessProvider();
            const resolved = await resolveSchemaToDacpac(
                {
                    kind: SourceOfTruthKind.Shadow,
                    source: { kind: SourceOfTruthKind.Connection, connectionProfileId: "prod-db" },
                    projectPath: "db/shadow",
                },
                processes,
                { workspaceRoot: "/ws" },
                newSignal(),
            );

            // Builds the committed project (dotnet) — no sqlpackage decompose.
            expect(processes.invocations).to.have.lengthOf(1);
            expect(processes.invocations[0].command).to.equal("dotnet");
            expect(processes.invocations[0].args[0]).to.equal("build");
            expect(
                processes.invocations[0].args.some((a) => a.endsWith("shadow.sqlproj")),
            ).to.equal(true);
            await resolved.dispose();
        });

        test("does not pre-create the extract target directory (sqlpackage requires it absent)", async () => {
            let targetExistedAtExtract: boolean | undefined;
            const processes: ProcessProvider = {
                async spawn(command, args) {
                    const target = args.find((a) => a.startsWith("/TargetFile:"));
                    if (command === "sqlpackage" && target !== undefined) {
                        const dir = target.slice("/TargetFile:".length);
                        targetExistedAtExtract = fs.existsSync(dir);
                        // Simulate sqlpackage creating its target tree.
                        await fs.promises.mkdir(dir, { recursive: true });
                    }
                    return {
                        exitCode: 0,
                        stdout: "",
                        stderr: "",
                        aborted: false,
                        truncated: false,
                    };
                },
            };

            const resolved = await resolveSchemaToDacpac(
                {
                    kind: SourceOfTruthKind.Shadow,
                    source: { kind: SourceOfTruthKind.Connection, connectionProfileId: "prod-db" },
                },
                processes,
                { sourceConnectionStringResolver: async () => "Server=prod;" },
                newSignal(),
            );

            expect(targetExistedAtExtract).to.equal(false);
            await resolved.dispose();
        });

        test("throws when no source-connection resolver is wired", async () => {
            const processes = new FakeProcessProvider();
            let caught: unknown;
            try {
                await resolveSchemaToDacpac(
                    {
                        kind: SourceOfTruthKind.Shadow,
                        source: {
                            kind: SourceOfTruthKind.Connection,
                            connectionProfileId: "prod-db",
                        },
                    },
                    processes,
                    {},
                    newSignal(),
                );
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(SchemaResolutionError);
        });

        test("throws SchemaResolutionError when the decomposition fails", async () => {
            const processes = new FakeProcessProvider();
            processes.respond("sqlpackage", "/Action:Extract", {
                mode: "exit",
                exitCode: 1,
                stderr: "login failed",
            });

            let caught: unknown;
            try {
                await resolveSchemaToDacpac(
                    {
                        kind: SourceOfTruthKind.Shadow,
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

        test("rejects a dacpac inner source until the dacpac-decomposition phase", async () => {
            const processes = new FakeProcessProvider();
            let caught: unknown;
            try {
                await resolveSchemaToDacpac(
                    {
                        kind: SourceOfTruthKind.Shadow,
                        source: { kind: SourceOfTruthKind.Dacpac, path: "/abs/MyDb.dacpac" },
                    },
                    processes,
                    { sourceConnectionStringResolver: async () => "Server=prod;" },
                    newSignal(),
                );
            } catch (err) {
                caught = err;
            }
            expect(caught).to.be.instanceOf(SchemaResolutionError);
            expect(processes.invocations).to.have.lengthOf(0);
        });
    });
});
