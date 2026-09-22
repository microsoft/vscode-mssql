/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import * as tar from "tar";
import * as vscode from "vscode";
import { VscodeHttpClient } from "extension-toolkit/vscode";
import { ILogger } from "../sharedInterfaces/logger";
import { logger as baseLogger } from "../models/logger";
import { AgentSkillGroup, AgentSkillSummary } from "../sharedInterfaces/overview";

/** GitHub repository that ships the Azure SQL agent skills, as `owner/repo`. */
const SKILLS_REPO_OWNER = "aasimkhan30";
const SKILLS_REPO_NAME = "azure-sql-skills";
const SKILLS_PLUGIN_NAME = "azure-sql";
/** Branch the skills are published from. */
const SKILLS_REF = "main";

const SKILLS_REPOSITORY_URL =
    `https://github.com/${SKILLS_REPO_OWNER}/${SKILLS_REPO_NAME}` as const;
const SKILL_COLLECTIONS = [
    { id: "azure-sql", title: "Azure SQL Database" },
    { id: "sql-migration", title: "SQL Server to Azure migration" },
] as const;

/**
 * Setting VS Code discovers agent plugins from. Each key is a plugin root directory and the
 * value enables it. Writing it registers the skills without an install prompt, and VS Code
 * re-reads it immediately, so no window reload is needed.
 */
const PLUGIN_LOCATIONS_SETTING = "chat.pluginLocations";

/** How long an installed copy is trusted before the upstream revision is checked again. */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Revision currently on disk, and when upstream was last asked about it. */
const STATE_INSTALLED_SHA = "overview/agentSkills.sha";
const STATE_LAST_CHECK_MS = "overview/agentSkills.lastCheckMs";

/** Network budget. The archive is ~1 MB, so these are generous. */
const SHA_REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const CATALOG_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Files that mark a directory as an agent plugin root. VS Code accepts both its own
 * (`.plugin`) and the Claude (`.claude-plugin`) layouts, so any one of these is enough to
 * treat an extracted copy as usable.
 */
const PLUGIN_MANIFEST_CANDIDATES = [
    path.join(".plugin", "plugin.json"),
    path.join(".plugin", "marketplace.json"),
    path.join(".claude-plugin", "plugin.json"),
    path.join(".claude-plugin", "marketplace.json"),
    "plugin.json",
    "marketplace.json",
];

/**
 * Thrown when an install is attempted from a window whose extension host is remote. Distinguished
 * from a download failure so the caller can explain what to do rather than offering a retry.
 */
export class RemoteWindowUnsupportedError extends Error {
    constructor() {
        super("The agent skills cannot be installed from a remote window.");
        this.name = "RemoteWindowUnsupportedError";
    }
}

/**
 * Downloads the Azure SQL agent skills and registers them with VS Code.
 *
 * The skills are fetched as a source archive into the extension's global storage rather than
 * bundled into the VSIX, so they track the repository instead of the release cadence. They are
 * registered by writing {@link PLUGIN_LOCATIONS_SETTING}, which is a documented setting the user
 * can see and revert -- VS Code's own plugin view removes the entry the same way.
 *
 * Nothing here is authoritative about "installed": the folder can be deleted and the setting can
 * be cleared independently, so {@link isInstalled} checks both and repairs the mismatch.
 */
export class AgentPluginsInstaller {
    /** Both plugin instances write the same user setting, so their edits share one queue. */
    private static _settingsOperation: Promise<void> = Promise.resolve();
    private readonly _logger: ILogger = baseLogger.withPrefix("AgentPluginsInstaller");
    private _operation: Promise<boolean> | undefined;
    private _catalog: Promise<AgentSkillGroup[]> | undefined;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _pluginName: "azure-sql" | "sql-migration" = "azure-sql",
    ) {}

    /**
     * Plugin name as its manifest declares it, which is what the Extensions view matches a
     * `@agentPlugins` search term against.
     */
    public get pluginName(): string {
        return this._pluginName;
    }

    /** Directory the skills are extracted to, and the value registered as a plugin root. */
    public get pluginRoot(): vscode.Uri {
        return vscode.Uri.joinPath(this._context.globalStorageUri, "agentSkills", this._pluginName);
    }

    private get installedShaKey(): string {
        return this._pluginName === SKILLS_PLUGIN_NAME
            ? STATE_INSTALLED_SHA
            : `${STATE_INSTALLED_SHA}/${this._pluginName}`;
    }

    private get lastCheckKey(): string {
        return this._pluginName === SKILLS_PLUGIN_NAME
            ? STATE_LAST_CHECK_MS
            : `${STATE_LAST_CHECK_MS}/${this._pluginName}`;
    }

    /** Current shipped skills listed by the repository. */
    public getSkillsCatalog(): Promise<AgentSkillGroup[]> {
        if (!this._catalog) {
            this._catalog = this.fetchSkillsCatalog().catch((error) => {
                // A failed request is not cached, so Retry in the webview performs real work.
                this._catalog = undefined;
                throw error;
            });
        }
        return this._catalog;
    }

    /**
     * Whether this window can install the skills at all.
     *
     * This extension runs in the workspace, so in a remote window -- a dev container, SSH or WSL
     * -- its storage is on the remote machine while `chat.pluginLocations` is read by the local
     * workbench against the local filesystem. Installing there would download into the container
     * and then record a path the workbench cannot resolve, leaving a plugin that never loads and
     * a dead entry synced into the user's settings.
     */
    public get isSupported(): boolean {
        return !vscode.env.remoteName;
    }

    /**
     * Whether the skills are both present on disk and registered with VS Code.
     *
     * Either half can disappear on its own: the user can delete the folder, and VS Code's plugin
     * view removes the setting entry. A registration pointing at a missing folder is cleared here
     * so it cannot linger as a broken plugin path.
     */
    public async isInstalled(): Promise<boolean> {
        if (!this.isSupported) {
            return false;
        }
        const present = await this.isPluginPresent();
        const registered = this.isRegistered();

        if (registered && !present) {
            this._logger.info("Agent skills folder is gone; clearing the stale plugin location.");
            await this.unregister();
            return false;
        }
        return present && registered;
    }

    /**
     * Installs the skills, reusing a copy that is already on disk.
     *
     * Re-registering an intact copy is the common case when the user removed the plugin through
     * VS Code's UI, which clears the setting but leaves the files, so that path skips the network
     * entirely.
     */
    public async install(): Promise<boolean> {
        if (!this.isSupported) {
            throw new RemoteWindowUnsupportedError();
        }
        return this.runExclusive(async () => {
            if (await this.isPluginPresent()) {
                this._logger.info("Agent skills already on disk; re-registering.");
                await this.register();
                return true;
            }

            const sha = await this.downloadInto(this.pluginRoot);
            await this.register();
            await this._context.globalState.update(this.installedShaKey, sha);
            await this._context.globalState.update(this.lastCheckKey, Date.now());
            this._logger.info(`Installed agent skills at ${sha ?? "an unknown revision"}.`);
            return true;
        });
    }

    /**
     * Refreshes the installed copy when upstream has moved, at most once every
     * {@link UPDATE_CHECK_INTERVAL_MS}.
     *
     * Only runs for an install that is still intact, so a user who removed the skills is never
     * silently given them back. Returns whether files were replaced.
     */
    public async checkForUpdates(force = false): Promise<boolean> {
        if (!(await this.isInstalled())) {
            return false;
        }

        const lastCheck = this._context.globalState.get<number>(this.lastCheckKey) ?? 0;
        // A clock moved backwards would otherwise wedge this until the original due time.
        const elapsed = Date.now() - lastCheck;
        if (!force && elapsed >= 0 && elapsed < UPDATE_CHECK_INTERVAL_MS) {
            return false;
        }

        return this.runExclusive(async () => {
            const latest = await this.fetchLatestSha();
            // Record the attempt either way, so an unreachable network retries tomorrow rather
            // than on every activation.
            await this._context.globalState.update(this.lastCheckKey, Date.now());
            if (!latest) {
                return false;
            }

            const current = this._context.globalState.get<string>(this.installedShaKey);
            if (current === latest) {
                return false;
            }

            this._logger.info(`Agent skills moved from ${current ?? "unknown"} to ${latest}.`);
            await this.downloadInto(this.pluginRoot);
            await this._context.globalState.update(this.installedShaKey, latest);
            // Re-assert the registration in case the path changed shape underneath us.
            await this.register();
            return true;
        });
    }

    /** Serializes install and update work so two callers cannot extract over each other. */
    private async runExclusive(work: () => Promise<boolean>): Promise<boolean> {
        const pending = (this._operation ?? Promise.resolve(false)).then(work, work);
        this._operation = pending.catch(() => false);
        return pending;
    }

    /**
     * Downloads the source archive and swaps it into `destination`.
     *
     * Extraction happens in a sibling temporary directory so a failed or partial download never
     * replaces a working copy. Returns the resolved revision, when the API could supply one.
     */
    private async downloadInto(destination: vscode.Uri): Promise<string | undefined> {
        const sha = await this.fetchLatestSha();
        const stagingRoot = vscode.Uri.joinPath(
            this._context.globalStorageUri,
            "agentSkills",
            ".staging",
        );
        const stagingDir = path.join(stagingRoot.fsPath, `download-${randomUUID()}`);
        const archivePath = path.join(stagingDir, "skills.tar.gz");
        const extractDir = path.join(stagingDir, "extracted");

        await fs.mkdir(extractDir, { recursive: true });
        try {
            const url =
                `https://codeload.github.com/${SKILLS_REPO_OWNER}/${SKILLS_REPO_NAME}` +
                `/tar.gz/refs/heads/${SKILLS_REF}`;
            const result = await new VscodeHttpClient().downloadToPath(url, archivePath, {
                timeoutMs: DOWNLOAD_TIMEOUT_MS,
            });
            if (result.status < 200 || result.status >= 300) {
                throw new Error(`Downloading the agent skills failed with status ${result.status}`);
            }

            // GitHub archives nest everything under `<repo>-<ref>/`, which `strip` removes.
            // `tar` refuses absolute and parent-relative entries by default, so an archive
            // cannot write outside this directory.
            await tar.x({ file: archivePath, cwd: extractDir, strip: 1 });

            const pluginDir = path.join(extractDir, "plugins", this._pluginName);
            if (!(await this.hasPluginManifest(pluginDir))) {
                throw new Error("The downloaded archive does not look like an agent plugin.");
            }

            await this.replaceDirectory(pluginDir, destination.fsPath);
            return sha;
        } finally {
            await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
        }
    }

    /**
     * Moves `source` onto `destination`.
     *
     * The copy already there is moved aside rather than deleted, and put back if the staged copy
     * cannot be installed. Deleting first would mean a failure on both the rename and the copy
     * leaves the user with no skills at all and a registration that the next {@link isInstalled}
     * call clears, turning a failed update into a lost installation.
     */
    private async replaceDirectory(source: string, destination: string): Promise<void> {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        const backup = `${destination}.old-${randomUUID()}`;
        const hasBackup = await this.moveAside(destination, backup);

        try {
            await this.moveInto(source, destination);
        } catch (error) {
            // A copy that failed part way leaves debris, and it is cleared whether or not there
            // is a backup: with one it would block the restore rename, and without one -- a
            // first install -- a half-copied tree that happens to include a manifest reads as a
            // working plugin to `isPluginPresent`, which would then register a broken install.
            await fs.rm(destination, { recursive: true, force: true }).catch(() => undefined);
            if (hasBackup) {
                await fs.rename(backup, destination).catch(() => undefined);
            }
            throw error;
        }

        if (hasBackup) {
            await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
        }
    }

    /** Renames an existing directory out of the way. False when there was nothing to move. */
    private async moveAside(directory: string, backup: string): Promise<boolean> {
        try {
            await fs.rename(directory, backup);
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
                return false;
            }
            // Anything else -- a lock, a permission change -- means the copy on disk cannot be
            // moved safely, so it is left exactly as it is.
            throw error;
        }
    }

    /**
     * Puts the staged copy in place. A rename is preferred, but it fails across filesystems and
     * can be refused on Windows while a file in the old copy is still open, so a recursive copy
     * backs it up.
     */
    private async moveInto(source: string, destination: string): Promise<void> {
        try {
            await fs.rename(source, destination);
        } catch (error) {
            this._logger.debug(
                `Renaming the agent skills into place failed (${
                    error instanceof Error ? error.message : String(error)
                }); copying instead.`,
            );
            await fs.cp(source, destination, { recursive: true });
        }
    }

    /** Latest commit on the published branch, or undefined when it cannot be determined. */
    private async fetchLatestSha(): Promise<string | undefined> {
        const url = `https://api.github.com/repos/${SKILLS_REPO_OWNER}/${SKILLS_REPO_NAME}/commits/${SKILLS_REF}`;
        try {
            // This media type answers with the bare commit SHA rather than the full commit.
            const response = await new VscodeHttpClient().get<string>(url, {
                headers: { Accept: "application/vnd.github.sha" },
                timeoutMs: SHA_REQUEST_TIMEOUT_MS,
            });
            const sha = typeof response.data === "string" ? response.data.trim() : undefined;
            return sha && /^[0-9a-f]{40}$/i.test(sha) ? sha : undefined;
        } catch (error) {
            // Offline, proxied or rate limited. The caller keeps whatever is already installed.
            this._logger.debug(
                `Could not read the agent skills revision: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return undefined;
        }
    }

    private async fetchSkillsCatalog(): Promise<AgentSkillGroup[]> {
        const client = new VscodeHttpClient({ logger: this._logger });
        return Promise.all(
            SKILL_COLLECTIONS.map(async ({ id, title }) => {
                const readmeUrl = `https://raw.githubusercontent.com/${SKILLS_REPO_OWNER}/${SKILLS_REPO_NAME}/${SKILLS_REF}/plugins/${id}/README.md`;
                const response = await client.get<string>(readmeUrl, {
                    timeoutMs: CATALOG_REQUEST_TIMEOUT_MS,
                });
                if (!response.ok) {
                    throw new Error(
                        `Loading the ${title} skills catalog failed with status ${response.status}`,
                    );
                }
                const skills = parseSkillsCatalog(response.data, id);
                if (skills.length === 0) {
                    throw new Error(`The ${title} skills catalog contained no shipped skills.`);
                }
                return { id, title, skills };
            }),
        );
    }

    /** Whether an extracted copy exists at the plugin root. */
    private async isPluginPresent(): Promise<boolean> {
        return this.hasPluginManifest(this.pluginRoot.fsPath);
    }

    private async hasPluginManifest(root: string): Promise<boolean> {
        for (const candidate of PLUGIN_MANIFEST_CANDIDATES) {
            try {
                await fs.access(path.join(root, candidate));
                return true;
            } catch {
                // Try the next layout.
            }
        }
        return false;
    }

    /**
     * Whether the plugin root is registered in the user's settings.
     *
     * Only the user scope is consulted, since that is the only scope written here; a workspace
     * entry belongs to whoever added it.
     */
    private isRegistered(): boolean {
        const locations = this.readUserPluginLocations();
        return locations[this.pluginRoot.fsPath] === true;
    }

    private async register(): Promise<void> {
        await AgentPluginsInstaller.mutateSettings(async () => {
            const key = this.pluginRoot.fsPath;
            const locations = this.readUserPluginLocations();
            if (locations[key] === true) {
                return;
            }
            await vscode.workspace
                .getConfiguration()
                .update(
                    PLUGIN_LOCATIONS_SETTING,
                    { ...locations, [key]: true },
                    vscode.ConfigurationTarget.Global,
                );
        });
    }

    private async unregister(): Promise<void> {
        await AgentPluginsInstaller.mutateSettings(async () => {
            const key = this.pluginRoot.fsPath;
            const locations = this.readUserPluginLocations();
            if (!(key in locations)) {
                return;
            }
            const remaining = { ...locations };
            delete remaining[key];
            await vscode.workspace
                .getConfiguration()
                .update(
                    PLUGIN_LOCATIONS_SETTING,
                    Object.keys(remaining).length > 0 ? remaining : undefined,
                    vscode.ConfigurationTarget.Global,
                );
        });
    }

    private static async mutateSettings(work: () => Promise<void>): Promise<void> {
        const pending = this._settingsOperation.then(work, work);
        this._settingsOperation = pending.catch(() => undefined);
        await pending;
    }

    /**
     * The user-scope value of the setting.
     *
     * `get` would return the value merged across every scope, and writing that back to the user
     * scope would copy workspace entries into the user's settings.
     */
    private readUserPluginLocations(): Record<string, boolean> {
        const inspected = vscode.workspace
            .getConfiguration()
            .inspect<Record<string, boolean>>(PLUGIN_LOCATIONS_SETTING);
        return { ...(inspected?.globalValue ?? {}) };
    }
}

/** Heading the shipped skills are tabulated under. */
const SKILLS_TABLE_HEADING = /^#{2,3}\s+(?:What.s in this collection|Skills\b)/i;

/**
 * A skill's name as the first cell of a table row.
 *
 * The collection README emphasises it (`**name**`) and the generated plugin READMEs code-quote
 * it (`` `name` ``), so both are accepted. Anything else -- a `---` separator row, or a prose
 * label such as `1. Instructions` -- is not a skill and is skipped.
 */
const SKILL_NAME_CELL = /^(?:\*\*|`)([a-z0-9][a-z0-9._-]*)(?:\*\*|`)$/i;

/**
 * Reads the shipped skills out of a collection README.
 *
 * Only the first table under the skills heading is read. The same README goes on to tabulate
 * per-skill install commands and the authoring standard, and those rows look enough like skill
 * rows that matching the whole document lists every skill twice and adds three headings that
 * are not skills at all.
 */
export function parseSkillsCatalog(
    markdown: string,
    pluginName = SKILLS_PLUGIN_NAME,
): AgentSkillSummary[] {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const headingIndex = lines.findIndex((line) => SKILLS_TABLE_HEADING.test(line));
    if (headingIndex < 0) {
        return [];
    }

    const skills: AgentSkillSummary[] = [];
    const seen = new Set<string>();
    let inTable = false;

    for (const line of lines.slice(headingIndex + 1)) {
        // The next section starts, so the table -- if there was one -- is over.
        if (line.startsWith("#")) {
            break;
        }
        if (!line.trimStart().startsWith("|")) {
            if (inTable) {
                break;
            }
            // Prose between the heading and the table.
            continue;
        }
        inTable = true;

        // A row is `| name | description |`, so the split has an empty cell at each end.
        const cells = line
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim());
        const name = SKILL_NAME_CELL.exec(cells[0] ?? "")?.[1];
        if (!name || cells.length < 2 || seen.has(name)) {
            continue;
        }
        seen.add(name);
        skills.push({
            id: name,
            description: cells[1]
                .replace(/\*\*/g, "")
                .replace(/`([^`]+)`/g, "$1")
                .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
                .trim(),
            repositoryUrl: `${SKILLS_REPOSITORY_URL}/blob/${SKILLS_REF}/plugins/${pluginName}/skills/${name}/SKILL.md`,
        });
    }
    return skills;
}
