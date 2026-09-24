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
import {
    AGENT_SKILL_PLUGINS,
    AgentSkillGroup,
    AgentSkillPluginName,
    AgentSkillSummary,
} from "../sharedInterfaces/overview";

interface SkillsSource {
    owner: string;
    name: string;
}

/**
 * It redirects to the repository that ships them, and every other URL here -- the archive, the
 * revision, the catalog READMEs and the source links -- is derived from whatever it resolves to.
 * Repointing the link moves all of them together, so the copy that gets installed and the copy
 * the links describe cannot drift apart.
 */
const SKILLS_SOURCE_ALIAS = "https://aka.ms/vscode-mssql-skills-repo";

const FALLBACK_SKILLS_SOURCE: SkillsSource = { owner: "microsoft", name: "microsoft-sql" };

/**
 * One owner or repository name GitHub accepts, e.g. `microsoft` or `microsoft-sql`, so a parsed
 * target cannot smuggle a path.
 */
const REPOSITORY_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * The host and the shape are both checked because aka.ms answers an unknown name with its own
 * search page rather than a 404. Without this, a mistyped or retired link would resolve to
 * whatever happened to answer and be downloaded as though it were the skills.
 */
function parseRepositorySource(target: string): SkillsSource | undefined {
    let url: URL;
    try {
        url = new URL(target);
    } catch {
        return undefined;
    }
    if (url.protocol !== "https:" || url.hostname !== "github.com") {
        return undefined;
    }

    const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
    if (segments.length !== 2) {
        return undefined;
    }
    const [owner, repository] = segments;
    const name = repository.endsWith(".git") ? repository.slice(0, -4) : repository;
    if (!REPOSITORY_SEGMENT.test(owner) || !REPOSITORY_SEGMENT.test(name)) {
        return undefined;
    }
    return { owner, name };
}

const SKILLS_REF = "main";

function repositoryUrl(source: SkillsSource): string {
    return `https://github.com/${source.owner}/${source.name}`;
}

/**
 * Each key is a plugin root directory and the value enables it. Writing it registers the skills
 * without an install prompt, and VS Code re-reads it immediately, so no window reload is needed.
 */
const PLUGIN_LOCATIONS_SETTING = "chat.pluginLocations";

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const STATE_INSTALLED_SHA = "overview/agentSkills.sha";
const STATE_LAST_CHECK_MS = "overview/agentSkills.lastCheckMs";

/**
 * Both plugins check at activation, and this keeps that to one call against GitHub's
 * unauthenticated limit rather than one per plugin.
 */
const LATEST_SHA_REUSE_MS = 60 * 1000;

const SHA_REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const CATALOG_REQUEST_TIMEOUT_MS = 15_000;
const RESOLVE_REQUEST_TIMEOUT_MS = 15_000;

/**
 * VS Code accepts both its own (`.plugin`) and the Claude (`.claude-plugin`) layouts, so any one of
 * these is enough to treat an extracted copy as usable.
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
 * Distinguished from a download failure so the caller can explain what to do rather than offering a
 * retry.
 */
export class RemoteWindowUnsupportedError extends Error {
    constructor() {
        super("The agent skills cannot be installed from a remote window.");
        this.name = "RemoteWindowUnsupportedError";
    }
}

function stagingRoot(context: vscode.ExtensionContext): string {
    return vscode.Uri.joinPath(context.globalStorageUri, "agentSkills", ".staging").fsPath;
}

interface SharedArchive {
    path: Promise<string>;
    users: number;
}

/**
 * Every collection ships from one repository, so the short link, the latest revision and the
 * archive are the same answer for each plugin. Asking once per window rather than once per
 * plugin keeps activation to one revision call against GitHub's unauthenticated limit, and
 * downloads the archive once when both plugins update together.
 */
export class AgentSkillsDownloads {
    private readonly _logger: ILogger = baseLogger.withPrefix("AgentSkillsDownloads");
    private _source: Promise<SkillsSource> | undefined;
    private _latestSha: { promise: Promise<string | undefined>; expiresAt: number } | undefined;
    private readonly _archives = new Map<string, SharedArchive>();

    constructor(private readonly _context: vscode.ExtensionContext) {}

    /**
     * The redirect is read rather than followed, so the target is inspected before anything is
     * fetched from it. Resolved once per window: the archive, the revision check, the catalog
     * and the source links all read the same answer, which is what keeps them describing one
     * repository for as long as the window lives.
     *
     * A failure resolves to {@link FALLBACK_SKILLS_SOURCE} and is deliberately not cached, so a
     * window that started offline picks the real target up on a later attempt rather than being
     * pinned to the fallback until it is reloaded.
     */
    public resolveSource(): Promise<SkillsSource> {
        if (!this._source) {
            this._source = this.readAliasTarget().then((source) => {
                if (source === FALLBACK_SKILLS_SOURCE) {
                    this._source = undefined;
                }
                return source;
            });
        }
        return this._source;
    }

    private async readAliasTarget(): Promise<SkillsSource> {
        try {
            const response = await new VscodeHttpClient({ logger: this._logger }).get(
                SKILLS_SOURCE_ALIAS,
                { maxRedirects: 0, timeoutMs: RESOLVE_REQUEST_TIMEOUT_MS },
            );
            const target = response.headers.get("location");
            const source = target ? parseRepositorySource(target) : undefined;
            if (!source) {
                this._logger.warn(
                    `${SKILLS_SOURCE_ALIAS} did not resolve to a GitHub repository` +
                        `${target ? ` (${target})` : ""}; using ` +
                        `${FALLBACK_SKILLS_SOURCE.owner}/${FALLBACK_SKILLS_SOURCE.name}.`,
                );
                return FALLBACK_SKILLS_SOURCE;
            }
            return source;
        } catch (error) {
            this._logger.debug(
                `Could not resolve ${SKILLS_SOURCE_ALIAS}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return FALLBACK_SKILLS_SOURCE;
        }
    }

    /**
     * An answer is reused for {@link LATEST_SHA_REUSE_MS}, so plugins checking together share
     * one request. A failure is not reused, so the next check asks again.
     */
    public fetchLatestSha(): Promise<string | undefined> {
        const now = Date.now();
        if (!this._latestSha || now >= this._latestSha.expiresAt) {
            const entry = {
                promise: this.readLatestSha().then((sha) => {
                    if (!sha && this._latestSha === entry) {
                        this._latestSha = undefined;
                    }
                    return sha;
                }),
                expiresAt: now + LATEST_SHA_REUSE_MS,
            };
            this._latestSha = entry;
        }
        return this._latestSha.promise;
    }

    private async readLatestSha(): Promise<string | undefined> {
        const source = await this.resolveSource();
        const url = `https://api.github.com/repos/${source.owner}/${source.name}/commits/${SKILLS_REF}`;
        try {
            // This media type answers with the bare commit SHA rather than the full commit.
            const response = await new VscodeHttpClient().get<string>(url, {
                headers: { Accept: "application/vnd.github.sha" },
                timeoutMs: SHA_REQUEST_TIMEOUT_MS,
            });
            const sha = typeof response.data === "string" ? response.data.trim() : undefined;
            // A 40-character hex commit SHA, e.g. "3f2a9c...e71b".
            return sha && /^[0-9a-f]{40}$/i.test(sha) ? sha : undefined;
        } catch (error) {
            this._logger.debug(
                `Could not read the agent skills revision: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return undefined;
        }
    }

    /**
     * Pinning the download to the revision also means the copy extracted is the one the recorded
     * revision names, even if the branch moves in between.
     */
    public async withArchive<T>(
        sha: string | undefined,
        use: (archivePath: string) => Promise<T>,
    ): Promise<T> {
        const ref = sha ?? `refs/heads/${SKILLS_REF}`;
        let archive = this._archives.get(ref);
        if (!archive) {
            archive = { path: this.downloadArchive(ref), users: 0 };
            this._archives.set(ref, archive);
        }
        archive.users++;
        try {
            return await use(await archive.path);
        } finally {
            archive.users--;
            if (archive.users === 0) {
                this._archives.delete(ref);
                await archive.path
                    .then((archivePath) =>
                        fs.rm(path.dirname(archivePath), { recursive: true, force: true }),
                    )
                    .catch(() => undefined);
            }
        }
    }

    private async downloadArchive(ref: string): Promise<string> {
        const directory = path.join(stagingRoot(this._context), `download-${randomUUID()}`);
        const archivePath = path.join(directory, "skills.tar.gz");
        await fs.mkdir(directory, { recursive: true });
        try {
            const source = await this.resolveSource();
            const url = `https://codeload.github.com/${source.owner}/${source.name}/tar.gz/${ref}`;
            const result = await new VscodeHttpClient().downloadToPath(url, archivePath, {
                timeoutMs: DOWNLOAD_TIMEOUT_MS,
            });
            if (result.status < 200 || result.status >= 300) {
                throw new Error(`Downloading the agent skills failed with status ${result.status}`);
            }
            return archivePath;
        } catch (error) {
            await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
            throw error;
        }
    }
}

/**
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
    private _operation: Promise<unknown> = Promise.resolve();
    private _catalog: Promise<AgentSkillGroup[]> | undefined;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _pluginName: AgentSkillPluginName = AGENT_SKILL_PLUGINS[0],
        private readonly _downloads: AgentSkillsDownloads = new AgentSkillsDownloads(_context),
    ) {}

    /**
     * Plugin name as its manifest declares it, which is what the Extensions view matches a
     * `@agentPlugins` search term against.
     */
    public get pluginName(): string {
        return this._pluginName;
    }

    public get pluginRoot(): vscode.Uri {
        return vscode.Uri.joinPath(this._context.globalStorageUri, "agentSkills", this._pluginName);
    }

    private get installedShaKey(): string {
        return `${STATE_INSTALLED_SHA}/${this._pluginName}`;
    }

    private get lastCheckKey(): string {
        return `${STATE_LAST_CHECK_MS}/${this._pluginName}`;
    }

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
        if (!registered || present) {
            return present && registered;
        }

        // An update moves the folder aside while it swaps the new copy in, so a missing folder
        // is only trusted once any update in flight has finished.
        return this.runExclusive(async () => {
            if (await this.isPluginPresent()) {
                return this.isRegistered();
            }
            if (this.isRegistered()) {
                this._logger.info(
                    "Agent skills folder is gone; clearing the stale plugin location.",
                );
                await this.unregister();
            }
            return false;
        });
    }

    /**
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

            const sha = await this._downloads.fetchLatestSha();
            await this.downloadInto(this.pluginRoot, sha);
            await this.register();
            await this._context.globalState.update(this.installedShaKey, sha);
            await this._context.globalState.update(this.lastCheckKey, Date.now());
            this._logger.info(`Installed agent skills at ${sha ?? "an unknown revision"}.`);
            return true;
        });
    }

    /**
     * Only runs for an install that is still intact, so a user who removed the skills is never
     * silently given them back.
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
            const latest = await this._downloads.fetchLatestSha();
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
            await this.downloadInto(this.pluginRoot, latest);
            await this._context.globalState.update(this.installedShaKey, latest);
            await this.register();
            return true;
        });
    }

    /** Serializes install and update work so two callers cannot extract over each other. */
    private runExclusive<T>(work: () => Promise<T>): Promise<T> {
        const pending = this._operation.then(work, work);
        this._operation = pending.catch(() => undefined);
        return pending;
    }

    /**
     * Extraction happens in a sibling temporary directory so a failed or partial download never
     * replaces a working copy.
     */
    private async downloadInto(destination: vscode.Uri, sha: string | undefined): Promise<void> {
        const extractDir = path.join(stagingRoot(this._context), `extract-${randomUUID()}`);
        await fs.mkdir(extractDir, { recursive: true });
        try {
            // GitHub archives nest everything under `<repo>-<ref>/`, which `strip` removes.
            // `tar` refuses absolute and parent-relative entries by default, so an archive
            // cannot write outside this directory.
            await this._downloads.withArchive(sha, (archivePath) =>
                tar.x({ file: archivePath, cwd: extractDir, strip: 1 }),
            );

            const pluginDir = path.join(extractDir, "plugins", this._pluginName);
            if (!(await this.hasPluginManifest(pluginDir))) {
                throw new Error("The downloaded archive does not look like an agent plugin.");
            }
            await this.replaceDirectory(pluginDir, destination.fsPath);
        } finally {
            await fs.rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
        }
    }

    /**
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
     * A rename is preferred, but it fails across filesystems and can be refused on Windows while a
     * file in the old copy is still open, so a recursive copy backs it up.
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

    private async fetchSkillsCatalog(): Promise<AgentSkillGroup[]> {
        const client = new VscodeHttpClient({ logger: this._logger });
        // Resolved once for the whole catalog, so both collections and every link in them
        // describe the same repository even if the short link were repointed mid-flight.
        const source = await this._downloads.resolveSource();
        const repository = repositoryUrl(source);
        return Promise.all(
            AGENT_SKILL_PLUGINS.map(async (id) => {
                const readmeUrl = `https://raw.githubusercontent.com/${source.owner}/${source.name}/${SKILLS_REF}/plugins/${id}/README.md`;
                const response = await client.get<string>(readmeUrl, {
                    timeoutMs: CATALOG_REQUEST_TIMEOUT_MS,
                });
                if (!response.ok) {
                    throw new Error(
                        `Loading the ${id} skills catalog failed with status ${response.status}`,
                    );
                }
                const skills = parseSkillsCatalog(response.data, id, repository);
                if (skills.length === 0) {
                    throw new Error(`The ${id} skills catalog contained no shipped skills.`);
                }
                return {
                    id,
                    skills,
                    repositoryUrl: `${repository}/tree/${SKILLS_REF}/plugins/${id}`,
                };
            }),
        );
    }

    private async isPluginPresent(): Promise<boolean> {
        return this.hasPluginManifest(this.pluginRoot.fsPath);
    }

    private async hasPluginManifest(root: string): Promise<boolean> {
        for (const candidate of PLUGIN_MANIFEST_CANDIDATES) {
            try {
                await fs.access(path.join(root, candidate));
                return true;
            } catch {}
        }
        return false;
    }

    /**
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

/**
 * Heading the shipped skills are tabulated under, e.g. `## What's in this collection` or
 * `### Skills`.
 */
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
 * Only the first table under the skills heading is read. The same README goes on to tabulate
 * per-skill install commands and the authoring standard, and those rows look enough like skill
 * rows that matching the whole document lists every skill twice and adds three headings that
 * are not skills at all.
 */
export function parseSkillsCatalog(
    markdown: string,
    pluginName: AgentSkillPluginName = AGENT_SKILL_PLUGINS[0],
    repository = repositoryUrl(FALLBACK_SKILLS_SOURCE),
): AgentSkillSummary[] {
    // CRLF line endings, normalized to LF before splitting.
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const headingIndex = lines.findIndex((line) => SKILLS_TABLE_HEADING.test(line));
    if (headingIndex < 0) {
        return [];
    }

    const skills: AgentSkillSummary[] = [];
    const seen = new Set<string>();
    let inTable = false;

    for (const line of lines.slice(headingIndex + 1)) {
        if (line.startsWith("#")) {
            break;
        }
        if (!line.trimStart().startsWith("|")) {
            if (inTable) {
                break;
            }
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
                // Bold markers, e.g. "**Note**" -> "Note".
                .replace(/\*\*/g, "")
                // Inline code, e.g. "`sqlcmd`" -> "sqlcmd".
                .replace(/`([^`]+)`/g, "$1")
                // Links, e.g. "[docs](https://example.com)" -> "docs".
                .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
                .trim(),
            repositoryUrl: `${repository}/blob/${SKILLS_REF}/plugins/${pluginName}/skills/${name}/SKILL.md`,
        });
    }
    return skills;
}
