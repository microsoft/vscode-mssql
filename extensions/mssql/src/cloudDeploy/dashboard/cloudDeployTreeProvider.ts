/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — activity-bar tree provider (D3-Part-2 commit 2).
 *
 * Renders two sections under the "SQL Server" activity bar:
 *
 *   * Environments — every declared env, each leaf showing the env name
 *     plus the status icon of its latest run (or "no runs yet").
 *   * Recent Runs  — the 10 most recent runs across all envs, newest first,
 *     each leaf showing the env name + status + a relative-time hint.
 *
 * The provider is a pure projection over `EnvironmentStore` and `RunStore`;
 * it owns no state of its own. It refreshes when either source fires its
 * change event. Leaves are stateless — `getChildren` rebuilds them every
 * call so the next paint always reflects current store contents.
 *
 * Invoking a leaf fires the appropriate command (defined in package.json):
 *
 *   * Environment leaf → `mssql.cloudDeploy.validateEnvironment` (existing
 *     D2 surface — runs validation on that env). The hub webview is
 *     out-of-scope for this commit.
 *   * Run leaf → `mssql.cloudDeploy.revealRunArtifact` (reveals the
 *     `.cdrun.zip` in the OS file explorer). Opening the artifact in a
 *     formatted view requires the hub webview, which lands in a later
 *     commit.
 *
 * Right-click context menus add "Refresh runs" on the view title.
 */

import * as vscode from "vscode";

import { CloudDeployDashboard } from "../../constants/locConstants";
import { EnvironmentStore } from "../environments/environmentStore";
import { Environment, SourceOfTruth, SourceOfTruthKind } from "../environments/types";
import { RunListEntry, RunStore } from "../runs/runStore";
import { RunStatus } from "../runs/types";

// =============================================================================
// Constants
// =============================================================================

/** Cap on the "Recent Runs" section. Keeps the tree readable on busy workspaces. */
const RECENT_RUNS_LIMIT = 10;

/** Cap on the runs shown nested under a single environment in the tree. */
const RUNS_PER_ENVIRONMENT = 5;

/** Unique view id contributed via `package.json` `contributes.views`. */
export const CLOUD_DEPLOY_VIEW_ID = "mssqlCloudDeploy";

// =============================================================================
// Tree node types
// =============================================================================

type TreeNode = SectionNode | EnvironmentNode | SourceNode | RunNode | EmptyNode;

interface SectionNode {
    readonly kind: "section";
    readonly id: "environments" | "runs";
    readonly label: string;
}

export interface EnvironmentNode {
    readonly kind: "environment";
    readonly env: Environment;
    readonly latestStatus: RunStatus | undefined;
    readonly isDefault: boolean;
}

/** Detail leaf shown under an expanded environment: its source of truth. */
interface SourceNode {
    readonly kind: "source";
    readonly env: Environment;
}

interface RunNode {
    readonly kind: "run";
    readonly entry: RunListEntry;
    /** When true, the run sits under its environment, so the env name is
     *  redundant and the leaf labels itself by run id instead. */
    readonly nested?: boolean;
}

interface EmptyNode {
    readonly kind: "empty";
    readonly parentSection: "environments" | "runs";
}

/**
 * Type guard for the environment leaf node. The "Validate environment" context
 * menu passes this node as the command argument, so command handlers use it to
 * skip the environment picker and validate the clicked environment directly.
 */
export function isEnvironmentNode(node: unknown): node is EnvironmentNode {
    return (
        typeof node === "object" &&
        node !== null &&
        (node as EnvironmentNode).kind === "environment"
    );
}

// =============================================================================
// Provider
// =============================================================================

export class CloudDeployTreeProvider
    implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable
{
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
    public readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined> =
        this._onDidChangeTreeData.event;

    private readonly _disposables: vscode.Disposable[] = [];

    public constructor(
        private readonly _environments: EnvironmentStore | undefined,
        private readonly _runStore: RunStore | undefined,
    ) {
        if (this._environments !== undefined) {
            this._disposables.push(
                this._environments.onDidChangeEnvironments(() => this.refresh()),
            );
            // Re-render when the default environment changes so the starred env
            // re-sorts to the top (or loses its marker) immediately, without
            // waiting for an unrelated env-list or run-store change.
            this._disposables.push(
                this._environments.onDidChangeDefaultEnvironment(() => this.refresh()),
            );
        }
        if (this._runStore !== undefined) {
            this._disposables.push(this._runStore.onDidChange(() => this.refresh()));
        }
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    public getTreeItem(element: TreeNode): vscode.TreeItem {
        switch (element.kind) {
            case "section":
                return makeSectionItem(element);
            case "environment":
                return makeEnvironmentItem(element);
            case "source":
                return makeSourceItem(element);
            case "run":
                return makeRunItem(element);
            case "empty":
                return makeEmptyItem(element);
        }
    }

    public getChildren(element?: TreeNode): TreeNode[] {
        if (element === undefined) {
            return [
                {
                    kind: "section",
                    id: "environments",
                    label: CloudDeployDashboard.environmentsSection,
                },
                { kind: "section", id: "runs", label: CloudDeployDashboard.recentRunsSection },
            ];
        }
        if (element.kind === "section") {
            return element.id === "environments"
                ? this._environmentChildren()
                : this._runChildren();
        }
        if (element.kind === "environment") {
            return this._environmentDetailChildren(element.env);
        }
        return [];
    }

    /**
     * Children of an expanded environment: a source-of-truth detail leaf, then
     * the environment's most recent runs nested directly beneath it.
     */
    private _environmentDetailChildren(env: Environment): TreeNode[] {
        const children: TreeNode[] = [{ kind: "source", env }];
        const runs = this._runStore?.list(env.id) ?? [];
        for (const entry of runs.slice(0, RUNS_PER_ENVIRONMENT)) {
            children.push({ kind: "run", entry, nested: true });
        }
        return children;
    }

    private _environmentChildren(): TreeNode[] {
        // EnvironmentStore.list() throws before init() resolves. The tree is
        // registered synchronously while init is in-flight, so swallow that
        // pre-init error and render the empty placeholder. mainController
        // calls refresh() once init resolves.
        let envs: readonly Environment[] = [];
        let defaultEnvId: string | undefined;
        try {
            envs = this._environments?.list() ?? [];
            defaultEnvId = this._environments?.getDefaultEnvironmentId();
        } catch {
            envs = [];
        }
        if (envs.length === 0) {
            return [{ kind: "empty", parentSection: "environments" }];
        }
        // Pin the default environment to the top so the user's primary target
        // is always the first leaf, preserving declaration order for the rest.
        const ordered =
            defaultEnvId === undefined
                ? envs
                : [...envs].sort((a, b) => {
                      if (a.id === defaultEnvId) {
                          return b.id === defaultEnvId ? 0 : -1;
                      }
                      return b.id === defaultEnvId ? 1 : 0;
                  });
        return ordered.map<EnvironmentNode>((env) => ({
            kind: "environment",
            env,
            latestStatus: this._latestStatusFor(env.id),
            isDefault: env.id === defaultEnvId,
        }));
    }

    private _runChildren(): TreeNode[] {
        const all = this._runStore?.list() ?? [];
        if (all.length === 0) {
            return [{ kind: "empty", parentSection: "runs" }];
        }
        return all.slice(0, RECENT_RUNS_LIMIT).map<RunNode>((entry) => ({ kind: "run", entry }));
    }

    private _latestStatusFor(envId: string): RunStatus | undefined {
        const entries = this._runStore?.list(envId) ?? [];
        return entries[0]?.status;
    }

    public dispose(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables.length = 0;
        this._onDidChangeTreeData.dispose();
    }
}

// =============================================================================
// TreeItem factories
// =============================================================================

function makeSectionItem(node: SectionNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    item.contextValue = `cloudDeploy.section.${node.id}`;
    item.iconPath = new vscode.ThemeIcon(node.id === "environments" ? "server" : "history");
    return item;
}

function makeEnvironmentItem(node: EnvironmentNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.env.name, vscode.TreeItemCollapsibleState.Collapsed);
    const baseDescription = node.isDefault
        ? CloudDeployDashboard.defaultEnvironmentDescription(statusText(node.latestStatus))
        : statusText(node.latestStatus);
    item.description = baseDescription;
    item.tooltip = CloudDeployDashboard.environmentTooltip(node.env.id);
    item.contextValue = "cloudDeploy.environment";
    item.iconPath = iconForStatus(node.latestStatus);
    item.command = {
        command: "mssql.cloudDeploy.openEnvironment",
        title: CloudDeployDashboard.openEnvironmentCommand,
        arguments: [node.env.id],
    };
    return item;
}

/**
 * The source-of-truth detail leaf shown directly under an expanded
 * environment, e.g. "Source: SQL project" with the path/profile as its
 * description.
 */
function makeSourceItem(node: SourceNode): vscode.TreeItem {
    const sot = node.env.sourceOfTruth;
    const item = new vscode.TreeItem(
        CloudDeployDashboard.sourceLabel(sourceKindText(sot.kind)),
        vscode.TreeItemCollapsibleState.None,
    );
    item.description = sourceDetailText(sot);
    item.contextValue = "cloudDeploy.source";
    item.iconPath = new vscode.ThemeIcon(sourceKindIcon(sot.kind));
    return item;
}

function makeRunItem(node: RunNode): vscode.TreeItem {
    const { entry } = node;
    // Nested under its environment, the run labels itself by short id (the env
    // name would be redundant). In the flat Recent Runs section it leads with
    // the environment name so cross-env runs are distinguishable.
    const label = node.nested ? entry.runId.slice(0, 8) : entry.envDisplayName;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = formatRunDescription(entry);
    item.tooltip = CloudDeployDashboard.runTooltip(entry.runId, entry.artifactPath);
    item.contextValue = "cloudDeploy.run";
    item.iconPath = iconForStatus(entry.status);
    item.command = {
        command: "mssql.cloudDeploy.openRun",
        title: CloudDeployDashboard.openRunCommand,
        arguments: [entry.runId],
    };
    return item;
}

/**
 * Resolves the run-artifact path from a `revealRunArtifact` command argument.
 * The command is invoked from the tree context menu (VS Code passes the
 * `RunNode` element) and, for back-compat, can be called with a bare
 * artifact-path string. Returns `undefined` when no usable path is present.
 */
export function resolveRunArtifactPath(arg: unknown): string | undefined {
    if (typeof arg === "string") {
        return arg.length > 0 ? arg : undefined;
    }
    if (isRunNode(arg)) {
        const { artifactPath } = arg.entry;
        return artifactPath.length > 0 ? artifactPath : undefined;
    }
    return undefined;
}

function isRunNode(arg: unknown): arg is RunNode {
    return typeof arg === "object" && arg !== null && (arg as { kind?: unknown }).kind === "run";
}

function makeEmptyItem(node: EmptyNode): vscode.TreeItem {
    const label =
        node.parentSection === "environments"
            ? CloudDeployDashboard.noEnvironmentsPlaceholder
            : CloudDeployDashboard.noRunsPlaceholder;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.contextValue = `cloudDeploy.empty.${node.parentSection}`;
    return item;
}

// =============================================================================
// Status → icon mapping
// =============================================================================

/**
 * Maps a `RunStatus` (or "no runs yet" / undefined) to a VS Code theme icon.
 * Centralized so the env section and the run section render the same badge
 * for the same status — a UX consistency requirement called out in the
 * mockups.
 */
function iconForStatus(status: RunStatus | undefined): vscode.ThemeIcon {
    if (status === undefined) {
        return new vscode.ThemeIcon("circle-outline");
    }
    switch (status) {
        case RunStatus.Passed:
            return new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"));
        case RunStatus.Warning:
            return new vscode.ThemeIcon("warning", new vscode.ThemeColor("testing.iconQueued"));
        case RunStatus.Failed:
            return new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed"));
        case RunStatus.Errored:
            return new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconErrored"));
        case RunStatus.Cancelled:
            return new vscode.ThemeIcon("circle-slash");
        case RunStatus.Skipped:
            return new vscode.ThemeIcon("dash");
    }
}

function formatRunDescription(entry: RunListEntry): string {
    const elapsedMs = Math.max(0, entry.endedAtMs - entry.startedAtMs);
    const seconds = Math.round(elapsedMs / 1000);
    return CloudDeployDashboard.runDescription(entry.status, seconds);
}

// =============================================================================
// Human-readable text helpers
// =============================================================================

/** Friendly latest-run text for an environment row, e.g. "Passed" / "No runs yet". */
function statusText(status: RunStatus | undefined): string {
    return status === undefined
        ? CloudDeployDashboard.noRunsYet
        : CloudDeployDashboard.statusName(status);
}

/** Friendly name for a source-of-truth kind, e.g. "SQL project" / "Live database". */
function sourceKindText(kind: SourceOfTruthKind): string {
    switch (kind) {
        case SourceOfTruthKind.SqlProj:
            return CloudDeployDashboard.sourceKindSqlProj;
        case SourceOfTruthKind.Dacpac:
            return CloudDeployDashboard.sourceKindDacpac;
        case SourceOfTruthKind.Container:
            return CloudDeployDashboard.sourceKindContainer;
    }
}

/** The path or connection profile behind a source of truth, shown as detail text. */
function sourceDetailText(sot: SourceOfTruth): string {
    return sot.kind === SourceOfTruthKind.Container ? sot.connectionProfileId : sot.path;
}

/** Theme icon id for a source-of-truth kind. */
function sourceKindIcon(kind: SourceOfTruthKind): string {
    switch (kind) {
        case SourceOfTruthKind.SqlProj:
            return "project";
        case SourceOfTruthKind.Dacpac:
            return "package";
        case SourceOfTruthKind.Container:
            return "database";
    }
}
