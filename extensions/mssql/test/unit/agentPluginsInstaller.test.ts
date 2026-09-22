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
import * as vscode from "vscode";
import { createHttpHeaders } from "extension-toolkit/base";
import { VscodeHttpClient } from "extension-toolkit/vscode";
import {
    AgentPluginsInstaller,
    parseSkillsCatalog,
    RemoteWindowUnsupportedError,
} from "../../src/agentPlugins/agentPluginsInstaller";

const { expect } = chai;
chai.use(sinonChai);

const PLUGIN_LOCATIONS = "chat.pluginLocations";

suite("Agent Plugins Installer", () => {
    let sandbox: sinon.SinonSandbox;
    let storageDir: string;
    let installer: AgentPluginsInstaller;
    let globalStateValues: Record<string, unknown>;
    /** Stands in for the user scope of `chat.pluginLocations`. */
    let userLocations: Record<string, boolean> | undefined;
    let updateStub: sinon.SinonStub;

    /** Writes a manifest so the plugin root looks like a real extracted plugin. */
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

        installer = new AgentPluginsInstaller({
            globalStorageUri: vscode.Uri.file(storageDir),
            globalState: {
                get: (key: string, fallback?: unknown) =>
                    key in globalStateValues ? globalStateValues[key] : fallback,
                update: (key: string, value: unknown) => {
                    globalStateValues[key] = value;
                    return Promise.resolve();
                },
            },
        } as unknown as vscode.ExtensionContext);
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

    test("reports not installed when the user deleted the folder, and clears the stale path", async () => {
        // The registration outlives the files, which would otherwise leave VS Code pointed at a
        // plugin path that no longer resolves.
        userLocations = { [installer.pluginRoot.fsPath]: true };

        expect(await installer.isInstalled()).to.equal(false);
        expect(updateStub).to.have.been.calledOnce;
        // Nothing else was registered, so the setting is removed rather than left as `{}`.
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
        // A user who removed the skills is never quietly given them back.
        expect(await installer.checkForUpdates()).to.equal(false);
        expect(globalStateValues["overview/agentSkills.lastCheckMs"]).to.equal(undefined);
    });

    test("skips the update check within a day of the last one", async () => {
        await createPluginOnDisk();
        userLocations = { [installer.pluginRoot.fsPath]: true };
        const lastCheck = Date.now() - 60 * 60 * 1000;
        globalStateValues["overview/agentSkills.lastCheckMs"] = lastCheck;

        expect(await installer.checkForUpdates()).to.equal(false);
        // Untouched, so the next check still falls due a day after the original one.
        expect(globalStateValues["overview/agentSkills.lastCheckMs"]).to.equal(lastCheck);
    });

    suite("remote windows", () => {
        /** Makes the window look like a dev container, where the extension host is remote. */
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
        // VS Code resolves a bare relative key against the workspace folders instead.
        expect(path.isAbsolute(registered)).to.equal(true);
        expect(registered).to.equal(installer.pluginRoot.fsPath);
    });

    test("loads, parses, and caches the shipped skills catalog", async () => {
        const getStub = sandbox.stub(VscodeHttpClient.prototype, "get");
        getStub.resolves({
            ok: true,
            status: 200,
            statusText: "OK",
            headers: createHttpHeaders(),
            data: [
                "## What's in this collection",
                "",
                "| Skill | What it does |",
                "| --- | --- |",
                "| **connect-node** | Connect a **Node.js** application using `mssql`. |",
                "",
                "---",
                "",
                "| Skill | Install command |",
                "| --- | --- |",
                "| **connect-node** | `duplicate outside the catalog` |",
            ].join("\n"),
        });

        const first = await installer.getSkillsCatalog();
        const second = await installer.getSkillsCatalog();

        expect(first).to.deep.equal([
            {
                id: "azure-sql-database-container",
                title: "Azure SQL Database container",
                skills: [
                    {
                        id: "connect-node",
                        description: "Connect a Node.js application using mssql.",
                        repositoryUrl:
                            "https://github.com/microsoft/azure-sql-database-container/blob/main/skills/connect-node/SKILL.md",
                    },
                ],
            },
        ]);
        expect(second).to.equal(first);
        expect(getStub).to.have.been.calledOnce;
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

        expect(getStub).to.have.callCount(2);
    });
});
