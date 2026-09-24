/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as tar from "tar";
import * as vscode from "vscode";
import { createHttpHeaders } from "extension-toolkit/base";
import { VscodeHttpClient } from "extension-toolkit/vscode";
import { AGENT_SKILL_PLUGINS } from "../../src/sharedInterfaces/overview";
import {
    AgentPluginsInstaller,
    AgentSkillsDownloads,
    parseSkillsCatalog,
    RemoteWindowUnsupportedError,
} from "../../src/agentPlugins/agentPluginsInstaller";

const { expect } = chai;
chai.use(sinonChai);

const PLUGIN_LOCATIONS = "chat.pluginLocations";
const LAST_CHECK_KEY = `overview/agentSkills.lastCheckMs/${AGENT_SKILL_PLUGINS[0]}`;

suite("Agent Plugins Installer", () => {
    let sandbox: sinon.SinonSandbox;
    let storageDir: string;
    let installer: AgentPluginsInstaller;
    let context: vscode.ExtensionContext;
    let globalStateValues: Record<string, unknown>;
    let userLocations: Record<string, boolean> | undefined;
    let updateStub: sinon.SinonStub;

    async function createPluginOnDisk(): Promise<void> {
        const manifestDir = path.join(installer.pluginRoot.fsPath, ".claude-plugin");
        await fs.mkdir(manifestDir, { recursive: true });
        await fs.writeFile(path.join(manifestDir, "plugin.json"), "{}");
    }

    setup(async () => {
        sandbox = sinon.createSandbox();
        globalStateValues = {};
        userLocations = undefined;
        storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "mssql-agent-plugins-"));

        updateStub = sinon.stub().callsFake((_section: string, value: unknown) => {
            userLocations = value as Record<string, boolean> | undefined;
            return Promise.resolve();
        });

        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            inspect: (section: string) =>
                section === PLUGIN_LOCATIONS ? { globalValue: userLocations } : undefined,
            update: updateStub,
        } as unknown as vscode.WorkspaceConfiguration);

        context = {
            globalStorageUri: vscode.Uri.file(storageDir),
            globalState: {
                get: (key: string, fallback?: unknown) =>
                    key in globalStateValues ? globalStateValues[key] : fallback,
                update: (key: string, value: unknown) => {
                    globalStateValues[key] = value;
                    return Promise.resolve();
                },
            },
        } as unknown as vscode.ExtensionContext;
        installer = new AgentPluginsInstaller(context);
    });

    teardown(async () => {
        sandbox.restore();
        await fs.rm(storageDir, { recursive: true, force: true });
    });

    test("reports not installed before anything is downloaded", async () => {
        expect(await installer.isInstalled()).to.equal(false);
    });

    test("reports installed once the files are present and the path is registered", async () => {
        await createPluginOnDisk();
        userLocations = { [installer.pluginRoot.fsPath]: true };

        expect(await installer.isInstalled()).to.equal(true);
    });

    test("tracks Microsoft SQL and migration plugin installations independently", async () => {
        const migration = new AgentPluginsInstaller(context, "microsoft-sql-migration");
        expect(migration.pluginName).to.equal("microsoft-sql-migration");
        expect(migration.pluginRoot.fsPath).to.not.equal(installer.pluginRoot.fsPath);

        const manifestDir = path.join(migration.pluginRoot.fsPath, ".claude-plugin");
        await fs.mkdir(manifestDir, { recursive: true });
        await fs.writeFile(path.join(manifestDir, "plugin.json"), "{}");
        await migration.install();

        expect(await migration.isInstalled()).to.equal(true);
        expect(await installer.isInstalled()).to.equal(false);
        expect(userLocations).to.deep.equal({ [migration.pluginRoot.fsPath]: true });
    });

    test("registers each plugin without disturbing other plugin locations", async () => {
        for (const pluginName of AGENT_SKILL_PLUGINS) {
            const current = new AgentPluginsInstaller(context, pluginName);
            await fs.mkdir(path.join(current.pluginRoot.fsPath, ".claude-plugin"), {
                recursive: true,
            });
            await fs.writeFile(
                path.join(current.pluginRoot.fsPath, ".claude-plugin", "plugin.json"),
                "{}",
            );
            userLocations = { "/another/plugin": true };

            await current.install();

            expect(userLocations).to.deep.equal({
                [current.pluginRoot.fsPath]: true,
                "/another/plugin": true,
            });
        }
    });

    test("serializes registrations from both plugins so neither setting is lost", async () => {
        const migration = new AgentPluginsInstaller(context, "microsoft-sql-migration");
        let releaseFirstWrite!: () => void;
        let firstWriteStarted!: () => void;
        const firstWrite = new Promise<void>((resolve) => (releaseFirstWrite = resolve));
        const firstWriteStartedPromise = new Promise<void>(
            (resolve) => (firstWriteStarted = resolve),
        );
        updateStub.callsFake(async (_section: string, value: unknown) => {
            if (updateStub.callCount === 1) {
                firstWriteStarted();
                await firstWrite;
            }
            userLocations = value as Record<string, boolean>;
        });

        const azureRegistration = installer["register"]();
        await firstWriteStartedPromise;
        const migrationRegistration = migration["register"]();
        try {
            await Promise.resolve();
            expect(updateStub).to.have.been.calledOnce;
        } finally {
            releaseFirstWrite();
        }
        await Promise.all([azureRegistration, migrationRegistration]);
        expect(userLocations).to.deep.equal({
            [installer.pluginRoot.fsPath]: true,
            [migration.pluginRoot.fsPath]: true,
        });
    });

    test("extracts the selected plugin from a marketplace archive", async () => {
        const migration = new AgentPluginsInstaller(context, "microsoft-sql-migration");
        const archiveSource = await fs.mkdtemp(path.join(os.tmpdir(), "mssql-marketplace-"));
        try {
            for (const name of ["microsoft-sql", "microsoft-sql-migration"]) {
                const manifestDir = path.join(
                    archiveSource,
                    "microsoft-sql-main",
                    "plugins",
                    name,
                    ".claude-plugin",
                );
                await fs.mkdir(manifestDir, { recursive: true });
                await fs.writeFile(path.join(manifestDir, "plugin.json"), JSON.stringify({ name }));
            }
            const archivePath = path.join(archiveSource, "marketplace.tar.gz");
            await tar.c({ gzip: true, file: archivePath, cwd: archiveSource }, [
                "microsoft-sql-main",
            ]);
            sandbox.stub(AgentSkillsDownloads.prototype, "fetchLatestSha").resolves(undefined);
            // Answered with a repository other than the fallback, so the assertion below shows
            // the archive URL following the short link rather than a constant.
            sandbox.stub(VscodeHttpClient.prototype, "get").resolves({
                ok: false,
                status: 301,
                statusText: "Moved Permanently",
                headers: createHttpHeaders({ location: "https://github.com/contoso/sql-skills" }),
                data: "",
            });
            let archiveUrl: string | undefined;
            sandbox
                .stub(VscodeHttpClient.prototype, "downloadToPath")
                .callsFake(async (url, target) => {
                    archiveUrl = String(url);
                    await fs.copyFile(archivePath, target);
                    return { status: 200 } as Awaited<
                        ReturnType<VscodeHttpClient["downloadToPath"]>
                    >;
                });

            expect(await migration.install()).to.equal(true);
            const manifest = JSON.parse(
                await fs.readFile(
                    path.join(migration.pluginRoot.fsPath, ".claude-plugin", "plugin.json"),
                    "utf8",
                ),
            );
            expect(manifest.name).to.equal("microsoft-sql-migration");
            expect(archiveUrl).to.equal(
                "https://codeload.github.com/contoso/sql-skills/tar.gz/refs/heads/main",
            );
            expect(await installer.isInstalled()).to.equal(false);
        } finally {
            await fs.rm(archiveSource, { recursive: true, force: true });
        }
    });

    test("reports not installed when the user deleted the folder, and clears the stale path", async () => {
        userLocations = { [installer.pluginRoot.fsPath]: true };

        expect(await installer.isInstalled()).to.equal(false);
        expect(updateStub).to.have.been.calledOnce;
        expect(userLocations).to.equal(undefined);
    });

    test("leaves other plugin paths alone when clearing its own", async () => {
        userLocations = { "/somewhere/else": true, [installer.pluginRoot.fsPath]: true };

        expect(await installer.isInstalled()).to.equal(false);
        expect(userLocations).to.deep.equal({ "/somewhere/else": true });
    });

    test("reports not installed when VS Code's plugin view removed the registration", async () => {
        // Removing a plugin there clears the setting entry but leaves the files behind.
        await createPluginOnDisk();

        expect(await installer.isInstalled()).to.equal(false);
    });

    test("re-registers an intact copy without downloading again", async () => {
        await createPluginOnDisk();

        expect(await installer.install()).to.equal(true);
        expect(userLocations).to.deep.equal({ [installer.pluginRoot.fsPath]: true });
        expect(await installer.isInstalled()).to.equal(true);
    });

    test("does not re-register a path that is already registered", async () => {
        await createPluginOnDisk();
        userLocations = { [installer.pluginRoot.fsPath]: true };

        await installer.install();

        expect(updateStub).to.not.have.been.called;
    });

    test("skips the update check when the skills are not installed", async () => {
        expect(await installer.checkForUpdates()).to.equal(false);
        expect(globalStateValues[LAST_CHECK_KEY]).to.equal(undefined);
    });

    test("skips the update check within a day of the last one", async () => {
        await createPluginOnDisk();
        userLocations = { [installer.pluginRoot.fsPath]: true };
        const lastCheck = Date.now() - 60 * 60 * 1000;
        globalStateValues[LAST_CHECK_KEY] = lastCheck;

        expect(await installer.checkForUpdates()).to.equal(false);
        expect(globalStateValues[LAST_CHECK_KEY]).to.equal(lastCheck);
    });

    suite("remote windows", () => {
        function stubRemoteWindow(): void {
            sandbox.stub(vscode.env, "remoteName").value("dev-container");
        }

        test("reports not installed even when the files and registration are both there", async () => {
            // Storage is inside the container, but the workbench reads the setting against the
            // local filesystem, so a plugin registered from here would never load.
            await createPluginOnDisk();
            userLocations = { [installer.pluginRoot.fsPath]: true };
            stubRemoteWindow();

            expect(await installer.isInstalled()).to.equal(false);
        });

        test("refuses to install rather than writing a path the workbench cannot resolve", async () => {
            stubRemoteWindow();

            let thrown: unknown;
            try {
                await installer.install();
            } catch (error) {
                thrown = error;
            }

            expect(thrown).to.be.instanceOf(RemoteWindowUnsupportedError);
            expect(updateStub).to.not.have.been.called;
        });

        test("does not clear a registration that belongs to the local window", async () => {
            // The same settings file is shared with local windows, so a remote window must not
            // treat "not resolvable from here" as "stale".
            userLocations = { [installer.pluginRoot.fsPath]: true };
            stubRemoteWindow();

            await installer.isInstalled();

            expect(updateStub).to.not.have.been.called;
        });

        test("skips the update check", async () => {
            await createPluginOnDisk();
            userLocations = { [installer.pluginRoot.fsPath]: true };
            stubRemoteWindow();

            expect(await installer.checkForUpdates(true)).to.equal(false);
        });
    });

    test("registers the plugin root as an absolute path", async () => {
        await createPluginOnDisk();
        await installer.install();

        const [registered] = Object.keys(userLocations ?? {});
        expect(path.isAbsolute(registered)).to.equal(true);
        expect(registered).to.equal(installer.pluginRoot.fsPath);
    });

    test("loads, parses, and caches the shipped skills catalog", async () => {
        const getStub = sandbox.stub(VscodeHttpClient.prototype, "get");
        getStub.callsFake(async (url: string) => ({
            ok: !url.startsWith("https://aka.ms/"),
            status: url.startsWith("https://aka.ms/") ? 301 : 200,
            statusText: "",
            headers: createHttpHeaders(
                url.startsWith("https://aka.ms/")
                    ? { location: "https://github.com/contoso/sql-skills" }
                    : {},
            ),
            data: [
                "## Skills (57)",
                "",
                "| Skill | What it does |",
                "| --- | --- |",
                url.includes("/microsoft-sql-migration/")
                    ? "| `recommend-migration-path` | Recommends a migration path. |"
                    : "| `connect-from-typescript-and-node` | Connect a **Node.js** application using `mssql`. |",
                "",
                "---",
                "",
                "| Skill | Install command |",
                "| --- | --- |",
                "| **connect-from-typescript-and-node** | `duplicate outside the catalog` |",
            ].join("\n"),
        }));

        const first = await installer.getSkillsCatalog();
        const second = await installer.getSkillsCatalog();

        expect(first).to.deep.equal([
            {
                id: "microsoft-sql-vscode",
                repositoryUrl:
                    "https://github.com/contoso/sql-skills/tree/main/plugins/microsoft-sql-vscode",
                skills: [
                    {
                        id: "connect-from-typescript-and-node",
                        description: "Connect a Node.js application using mssql.",
                        repositoryUrl:
                            "https://github.com/contoso/sql-skills/blob/main/plugins/microsoft-sql-vscode/skills/connect-from-typescript-and-node/SKILL.md",
                    },
                ],
            },
            {
                id: "microsoft-sql-migration",
                repositoryUrl:
                    "https://github.com/contoso/sql-skills/tree/main/plugins/microsoft-sql-migration",
                skills: [
                    {
                        id: "recommend-migration-path",
                        description: "Recommends a migration path.",
                        repositoryUrl:
                            "https://github.com/contoso/sql-skills/blob/main/plugins/microsoft-sql-migration/skills/recommend-migration-path/SKILL.md",
                    },
                ],
            },
        ]);
        expect(second).to.equal(first);
        // The resolve attempt, then one README per collection.
        expect(getStub).to.have.been.calledThrice;
    });

    test("restores the installed copy when the staged copy cannot be moved into place", async () => {
        await createPluginOnDisk();
        const marker = path.join(installer.pluginRoot.fsPath, "marker.txt");
        await fs.writeFile(marker, "working install");

        const staging = await fs.mkdtemp(path.join(os.tmpdir(), "mssql-agent-staging-"));
        await fs.writeFile(path.join(staging, "marker.txt"), "staged install");

        const realRename = fs.rename;
        const rename = sandbox.stub(fs, "rename");
        rename.callsFake(realRename);
        rename.onSecondCall().rejects(new Error("locked"));
        sandbox.stub(fs, "cp").rejects(new Error("locked"));

        let thrown: unknown;
        try {
            await installer["replaceDirectory"](staging, installer.pluginRoot.fsPath);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).to.be.instanceOf(Error);
        expect(await fs.readFile(marker, "utf8")).to.equal("working install");
        const siblings = await fs.readdir(path.dirname(installer.pluginRoot.fsPath));
        expect(siblings.filter((entry) => entry.includes(".old-"))).to.be.empty;
    });

    test("leaves nothing behind when a first install cannot be moved into place", async () => {
        const staging = await fs.mkdtemp(path.join(os.tmpdir(), "mssql-agent-staging-"));
        await fs.mkdir(path.join(staging, ".claude-plugin"), { recursive: true });
        await fs.writeFile(path.join(staging, ".claude-plugin", "plugin.json"), "{}");

        // Nothing is installed yet, so there is no backup to restore. A cross-filesystem copy
        // can still create part of the destination before failing, and a half-copied tree that
        // happens to carry a manifest would otherwise read as a working plugin.
        sandbox.stub(fs, "rename").rejects(new Error("cross-device"));
        sandbox.stub(fs, "cp").callsFake(async () => {
            await fs.mkdir(path.join(installer.pluginRoot.fsPath, ".claude-plugin"), {
                recursive: true,
            });
            await fs.writeFile(
                path.join(installer.pluginRoot.fsPath, ".claude-plugin", "plugin.json"),
                "{}",
            );
            throw new Error("out of space");
        });

        let thrown: unknown;
        try {
            await installer["replaceDirectory"](staging, installer.pluginRoot.fsPath);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).to.be.instanceOf(Error);
        expect(await installer["isPluginPresent"]()).to.equal(false);
    });

    test("reads only the first skills table, whatever separates the sections", () => {
        // The collection README follows its catalog with an install table whose rows repeat every
        // skill name, and an authoring table whose first column is prose. Neither is a skill, and
        // neither section is reliably preceded by a horizontal rule.
        const skills = parseSkillsCatalog(
            [
                "# Skills",
                "",
                "## What's in this collection",
                "",
                "| Skill | What it does |",
                "| --- | --- |",
                "| **connect-node** | Connect a **Node.js** application using `mssql`. |",
                "| **read-plan** | Read an execution plan. |",
                "",
                "## INSTALL",
                "",
                "| Skill | Install command |",
                "| --- | --- |",
                "| **connect-node** | `npx skills add owner/repo --skill connect-node` |",
                "",
                "## Authoring standard",
                "",
                "| Layer | When | What |",
                "| --- | --- | --- |",
                "| **1. Instructions** | when the skill triggers | The happy path. |",
            ].join("\n"),
            "microsoft-sql-vscode",
            "https://github.com/owner/repo",
        );

        expect(skills.map((skill) => skill.id)).to.deep.equal(["connect-node", "read-plan"]);
        expect(skills[0].description).to.equal("Connect a Node.js application using mssql.");
    });

    test("reads the code-quoted skill names the generated plugin README uses", () => {
        const skills = parseSkillsCatalog(
            [
                "## Skills (2)",
                "",
                "| Skill | Description |",
                "| --- | --- |",
                "| `recommend-migration-path` | Recommend a target and method. |",
                "| `validate-post-migration-data` | Reconcile source and target. |",
                "",
                "## Install",
            ].join("\n"),
            "microsoft-sql-migration",
            "https://github.com/owner/repo",
        );

        expect(skills.map((skill) => skill.id)).to.deep.equal([
            "recommend-migration-path",
            "validate-post-migration-data",
        ]);
    });

    test("does not cache a failed skills catalog request", async () => {
        const getStub = sandbox
            .stub(VscodeHttpClient.prototype, "get")
            .rejects(new Error("offline"));

        for (let attempt = 0; attempt < 2; attempt++) {
            let thrown: unknown;
            try {
                await installer.getSkillsCatalog();
            } catch (error) {
                thrown = error;
            }
            expect(thrown).to.be.instanceOf(Error);
        }

        // One failed resolve per attempt: the failure is not cached, so the retry asks again.
        expect(getStub).to.have.callCount(2);
    });

    test("rejects a short link that does not resolve to a GitHub repository", async () => {
        // aka.ms answers an unknown name with a redirect to its own search page rather than a 404,
        // so the target is checked before anything is fetched from it.
        const getStub = sandbox.stub(VscodeHttpClient.prototype, "get").resolves({
            ok: false,
            status: 302,
            statusText: "Found",
            headers: createHttpHeaders({
                location: "https://www.bing.com/?ref=aka&shorturl=mistyped-link",
            }),
            data: "",
        });

        let thrown: unknown;
        try {
            await installer.getSkillsCatalog();
        } catch (error) {
            thrown = error;
        }

        expect(thrown).to.be.instanceOf(Error);
        expect(getStub).to.have.been.calledOnce;
    });

    test("does not clear the registration while an update is swapping the folder", async () => {
        await createPluginOnDisk();
        userLocations = { [installer.pluginRoot.fsPath]: true };

        let releaseUpdate!: () => void;
        let markMovedAside!: () => void;
        const updateHeld = new Promise<void>((resolve) => (releaseUpdate = resolve));
        const movedAside = new Promise<void>((resolve) => (markMovedAside = resolve));
        const aside = `${installer.pluginRoot.fsPath}.aside`;
        const update = installer["runExclusive"](async () => {
            await fs.rename(installer.pluginRoot.fsPath, aside);
            markMovedAside();
            await updateHeld;
            await fs.rename(aside, installer.pluginRoot.fsPath);
            return true;
        });

        await movedAside;
        const installed = installer.isInstalled();
        await new Promise((resolve) => setTimeout(resolve, 10));
        releaseUpdate();
        await update;

        expect(await installed).to.equal(true);
        expect(updateStub).to.not.have.been.called;
        expect(userLocations).to.deep.equal({ [installer.pluginRoot.fsPath]: true });
    });

    test("shares one revision check and one archive across plugins updating together", async () => {
        const archiveSource = await fs.mkdtemp(path.join(os.tmpdir(), "mssql-shared-archive-"));
        try {
            for (const name of AGENT_SKILL_PLUGINS) {
                const manifestDir = path.join(
                    archiveSource,
                    "microsoft-sql-main",
                    "plugins",
                    name,
                    ".claude-plugin",
                );
                await fs.mkdir(manifestDir, { recursive: true });
                await fs.writeFile(path.join(manifestDir, "plugin.json"), JSON.stringify({ name }));
            }
            const archivePath = path.join(archiveSource, "marketplace.tar.gz");
            await tar.c({ gzip: true, file: archivePath, cwd: archiveSource }, [
                "microsoft-sql-main",
            ]);

            const sha = "a".repeat(40);
            const getStub = sandbox
                .stub(VscodeHttpClient.prototype, "get")
                .callsFake(async (url: string) => ({
                    ok: !url.startsWith("https://aka.ms/"),
                    status: url.startsWith("https://aka.ms/") ? 301 : 200,
                    statusText: "",
                    headers: createHttpHeaders(
                        url.startsWith("https://aka.ms/")
                            ? { location: "https://github.com/contoso/sql-skills" }
                            : {},
                    ),
                    data: url.startsWith("https://api.github.com/") ? sha : "",
                }));
            const downloadUrls: string[] = [];
            sandbox
                .stub(VscodeHttpClient.prototype, "downloadToPath")
                .callsFake(async (url, target) => {
                    downloadUrls.push(String(url));
                    await fs.copyFile(archivePath, target);
                    return { status: 200 } as Awaited<
                        ReturnType<VscodeHttpClient["downloadToPath"]>
                    >;
                });

            const downloads = new AgentSkillsDownloads(context);
            const installers = AGENT_SKILL_PLUGINS.map(
                (name) => new AgentPluginsInstaller(context, name, downloads),
            );
            await Promise.all(installers.map((current) => current.install()));

            for (const current of installers) {
                const manifest = JSON.parse(
                    await fs.readFile(
                        path.join(current.pluginRoot.fsPath, ".claude-plugin", "plugin.json"),
                        "utf8",
                    ),
                );
                expect(manifest.name).to.equal(current.pluginName);
                expect(
                    globalStateValues[`overview/agentSkills.sha/${current.pluginName}`],
                ).to.equal(sha);
            }
            expect(downloadUrls).to.deep.equal([
                `https://codeload.github.com/contoso/sql-skills/tar.gz/${sha}`,
            ]);
            const revisionCalls = getStub
                .getCalls()
                .filter((call) => String(call.args[0]).startsWith("https://api.github.com/"));
            expect(revisionCalls).to.have.lengthOf(1);
            const staging = path.join(storageDir, "agentSkills", ".staging");
            expect(await fs.readdir(staging).catch(() => [])).to.be.empty;
        } finally {
            await fs.rm(archiveSource, { recursive: true, force: true });
        }
    });
});
