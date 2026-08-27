/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Session Diag lifecycle: reads settings, manages the store sink, registers
 * user-facing commands, and exposes capture state. Everything here is
 * privacy-first: capture is OFF by default, local-only, never uploaded, and
 * secrets are never persisted regardless of settings.
 */

import * as path from "path";
import * as vscode from "vscode";
import { CaptureMode, ProvenanceSummary } from "../sharedInterfaces/debugConsole";
import { diag } from "./diagnosticsCore";
import { richStats } from "./richCollection";
import { SessionDiagSink } from "./sinks";
import { SessionStore } from "./sessionStore";

const SETTING_ENABLED = "mssql.sessionDiag.enabled";
const SETTING_MODE = "mssql.sessionDiag.captureMode";
const SETTING_MAX_SESSIONS = "mssql.sessionDiag.maxSessions";
const SETTING_MAX_AGE_DAYS = "mssql.sessionDiag.maxAgeDays";
const SETTING_RICH = "mssql.debugConsole.richCollection";
const ENV_RICH = "MSSQL_COLLECT_ALL_THE_DATA";

export class DiagnosticsManager implements vscode.Disposable {
    private storeSink: SessionDiagSink | undefined;
    private statusItem: vscode.StatusBarItem | undefined;
    public readonly store: SessionStore;
    public readonly provenance: ProvenanceSummary;

    constructor(private readonly context: vscode.ExtensionContext) {
        // Store location is configurable so always-on capture can land traces
        // wherever the user wants (takes effect on restart).
        const configuredStorePath = vscode.workspace
            .getConfiguration()
            .get<unknown>("mssql.sessionDiag.storePath", "");
        const configuredRoot =
            typeof configuredStorePath === "string" ? configuredStorePath.trim() : "";
        this.store = new SessionStore(
            configuredRoot || path.join(context.globalStorageUri.fsPath, "session-diag"),
        );
        const packageJson = (vscode.extensions.getExtension("ms-mssql.mssql")?.packageJSON ??
            {}) as { version?: string };
        this.provenance = {
            ...(packageJson.version !== undefined ? { extensionVersion: packageJson.version } : {}),
            vscodeVersion: vscode.version,
        };
        this.applySettings();
        this.applyRichSetting();
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((change) => {
                if (
                    change.affectsConfiguration(SETTING_ENABLED) ||
                    change.affectsConfiguration(SETTING_MODE)
                ) {
                    this.applySettings();
                }
                if (change.affectsConfiguration(SETTING_RICH)) {
                    this.applyRichSetting();
                }
            }),
        );
        this.registerCommands();
        const removeCaptureModeListener = diag.onCaptureModeChanged((mode) => {
            this.storeSink?.updateCapturePolicy(mode, diag.capturePolicy.policyId);
            this.updateStatusItem();
        });
        context.subscriptions.push({ dispose: removeCaptureModeListener });
    }

    // --- settings --------------------------------------------------------------

    /** Rich collection gates: setting or env var (self-test adds its own). */
    private applyRichSetting(): void {
        const fromSetting = vscode.workspace.getConfiguration().get<boolean>(SETTING_RICH, false);
        const fromEnv = process.env[ENV_RICH] === "1";
        if (fromSetting) {
            richStats.enable("setting");
        } else {
            richStats.disable("setting");
        }
        if (fromEnv) {
            richStats.enable("env");
        }
    }

    private applySettings(): void {
        const config = vscode.workspace.getConfiguration();
        const enabled = config.get<boolean>(SETTING_ENABLED, false);
        const mode = config.get<CaptureMode>(SETTING_MODE, "redacted");
        if (enabled && mode !== "off") {
            // Full capture is never enabled from settings alone; it requires
            // the explicit, time-bounded elevation command.
            const effective: CaptureMode = mode === "full" ? "redacted" : mode;
            this.enableCapture(effective);
        } else {
            this.disableCapture();
        }
    }

    /**
     * Apply a capture mode immediately (used by the Debug Console chip), then
     * persist to settings in the background so it survives restarts.
     */
    public applyCaptureMode(
        mode: CaptureMode,
        options?: { reason?: string; durationMinutes?: number },
    ): void {
        if (mode === "off") {
            this.disableCapture();
            void vscode.workspace
                .getConfiguration()
                .update(SETTING_ENABLED, false, vscode.ConfigurationTarget.Global);
            return;
        }
        if (mode === "full") {
            // Elevation implies capture: make sure the store sink is live, then
            // raise the policy (time-bounded, auto-reverts to redacted).
            this.enableCapture("redacted");
            diag.setCaptureMode("full", {
                reason: options?.reason ?? "elevated",
                durationMs: (options?.durationMinutes ?? 15) * 60_000,
            });
            this.updateStatusItem();
            return;
        }
        this.enableCapture(mode);
        void vscode.workspace
            .getConfiguration()
            .update(SETTING_ENABLED, true, vscode.ConfigurationTarget.Global);
        void vscode.workspace
            .getConfiguration()
            .update(SETTING_MODE, mode, vscode.ConfigurationTarget.Global);
    }

    private enableCapture(mode: CaptureMode): void {
        diag.setCaptureMode(mode);
        if (!this.storeSink) {
            try {
                this.storeSink = new SessionDiagSink(
                    this.store.storeRoot,
                    diag.sessionId,
                    mode,
                    diag.capturePolicy.policyId,
                    this.provenance,
                );
                diag.addSink(this.storeSink);
                diag.emit({
                    feature: "sessionDiag",
                    type: "sessionDiag.enabled",
                    fields: { captureMode: { raw: mode, cls: "diagnostic.metadata" } },
                });
                const config = vscode.workspace.getConfiguration();
                this.store.enforceRetention(
                    config.get<number>(SETTING_MAX_SESSIONS, 10),
                    config.get<number>(SETTING_MAX_AGE_DAYS, 14),
                    config.get<number>("mssql.sessionDiag.maxTotalMB", 512) * 1024 * 1024,
                );
            } catch {
                // Store unavailable: capture stays off; product unaffected.
                this.storeSink = undefined;
            }
        }
        this.updateStatusItem();
    }

    private disableCapture(): void {
        if (this.storeSink) {
            diag.emit({ feature: "sessionDiag", type: "sessionDiag.disabled" });
            diag.removeSink(this.storeSink.id);
            this.storeSink = undefined;
        }
        diag.setCaptureMode("off");
        this.updateStatusItem();
    }

    // --- commands ---------------------------------------------------------------

    private registerCommands(): void {
        const register = (command: string, handler: (...args: unknown[]) => unknown) =>
            this.context.subscriptions.push(vscode.commands.registerCommand(command, handler));

        register("mssql.sessionDiag.enable", async () => {
            await vscode.workspace
                .getConfiguration()
                .update(SETTING_ENABLED, true, vscode.ConfigurationTarget.Global);
        });
        register("mssql.sessionDiag.disable", async () => {
            await vscode.workspace
                .getConfiguration()
                .update(SETTING_ENABLED, false, vscode.ConfigurationTarget.Global);
        });
        register("mssql.sessionDiag.clear", async () => {
            const sessions = this.store.listLocalSessions();
            const choice = await vscode.window.showWarningMessage(
                `Delete ${sessions.length} locally stored diagnostic session(s)? The current session keeps recording if capture is on.`,
                { modal: true },
                "Delete all",
            );
            if (choice === "Delete all") {
                const { removed } = this.store.clearAll(diag.sessionId);
                void vscode.window.showInformationMessage(
                    `Removed ${removed} diagnostic session(s).`,
                );
            }
        });
        register("mssql.sessionDiag.openStorageFolder", async () => {
            await vscode.env.openExternal(vscode.Uri.file(this.store.storeRoot));
        });
        register("mssql.sessionDiag.elevateCapture", async () => {
            const reason = await vscode.window.showInputBox({
                prompt: "Reason for elevated (full) capture — recorded in the session log",
                placeHolder: "e.g. reproducing bug #1234",
            });
            if (!reason) {
                return;
            }
            const duration = await vscode.window.showQuickPick(
                ["5 minutes", "15 minutes", "30 minutes"],
                { title: "Elevated capture duration (auto-reverts)" },
            );
            if (!duration) {
                return;
            }
            const minutes = Number(duration.split(" ")[0]);
            this.applyCaptureMode("full", { reason, durationMinutes: minutes });
            diag.emit({
                feature: "sessionDiag",
                type: "sessionDiag.elevated",
                status: "warning",
                fields: {
                    reason: { raw: reason, cls: "user.text" },
                    durationMinutes: { raw: minutes, cls: "diagnostic.metadata" },
                },
            });
            this.updateStatusItem();
        });
    }

    public updateStatusItem(): void {
        const consoleEnabled = vscode.workspace
            .getConfiguration()
            .get<boolean>("mssql.debugConsole.enabled", false);
        if (!consoleEnabled) {
            this.statusItem?.hide();
            return;
        }
        if (!this.statusItem) {
            this.statusItem = vscode.window.createStatusBarItem(
                "mssql.sessionDiag",
                vscode.StatusBarAlignment.Right,
                90,
            );
            this.statusItem.name = "MSSQL Session Diagnostics";
            this.statusItem.command = "mssql.openDebugConsole";
            this.context.subscriptions.push(this.statusItem);
        }
        const mode = diag.captureMode;
        if (mode === "off") {
            this.statusItem.text = "$(circle-slash) MSSQL Diag";
            this.statusItem.tooltip =
                "MSSQL session diagnostics: capture off. Click to open the Debug Console.";
            this.statusItem.backgroundColor = undefined;
        } else if (mode === "full") {
            this.statusItem.text = "$(record) MSSQL Diag: FULL";
            this.statusItem.tooltip =
                "Elevated (full) capture is active and time-bounded. Click to open the Debug Console.";
            this.statusItem.backgroundColor = new vscode.ThemeColor(
                "statusBarItem.warningBackground",
            );
        } else {
            this.statusItem.text = `$(shield) MSSQL Diag: ${mode}`;
            this.statusItem.tooltip = `MSSQL session diagnostics capturing (${mode}, local only). Click to open the Debug Console.`;
            this.statusItem.backgroundColor = undefined;
        }
        this.statusItem.show();
    }

    public get activeStoreDirectory(): string | undefined {
        return this.storeSink?.directory;
    }

    /** Whether the always-on session store sink is currently writing. */
    public get storeActive(): boolean {
        return this.storeSink !== undefined;
    }

    public dispose(): void {
        if (this.storeSink) {
            diag.removeSink(this.storeSink.id);
            this.storeSink = undefined;
        }
        richStats.disable("setting");
        richStats.disable("env");
    }
}
