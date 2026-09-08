/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { parseCapture } from "sql-feature/diagnostics/profiler";

import { DiagnosticsSessionOpener } from "./sessionOpener";
import { DataPlaneRunner } from "./dataPlaneRunner";
import { SqlProfilerWebviewController } from "./sqlProfilerWebviewController";
import { getErrorMessage } from "../utils/utils";

/** Default retained-event window, overridable with mssql.profiler.eventBufferSize. */
const DEFAULT_BUFFER_SIZE = 10000;

/**
 * Owns profiler panels and the commands that open them.
 *
 * Live panels are keyed by connection so a second invocation reveals the running capture
 * instead of starting a competing one. File panels are always new, since two files are two
 * different things to look at.
 */
export class SqlProfilerController implements vscode.Disposable {
    private readonly _livePanels = new Map<string, SqlProfilerWebviewController>();
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _dataPlaneEnabled: () => boolean,
        private readonly _opener: DiagnosticsSessionOpener,
    ) {
        this._disposables.push(
            vscode.commands.registerCommand("mssql.sqlProfiler.open", () => this.openLive()),
            vscode.commands.registerCommand("mssql.sqlProfiler.openFile", (uri?: vscode.Uri) =>
                this.openFile(uri),
            ),
        );
    }

    /** Opens a capture panel against a live connection. */
    async openLive(): Promise<void> {
        try {
            if (!this._dataPlaneEnabled()) {
                vscode.window.showWarningMessage(
                    "The profiler needs the SQL data plane. Turn on 'mssql.sqlDataPlane.enabled' and reconnect.",
                );
                return;
            }

            const opened = await this._opener.open();
            if (!opened) {
                vscode.window.showInformationMessage(
                    "Connect to a server first, then open the profiler.",
                );
                return;
            }

            const existing = this._livePanels.get(opened.serverKey);
            if (existing) {
                existing.revealToForeground();
                await opened.session.close({ reason: "profiler panel already open" });
                return;
            }

            const runner = new DataPlaneRunner(opened.session);
            // Capabilities decide which session scope and catalog views exist, so they are read
            // before the panel offers any capture controls.
            const capabilities = await runner.capabilities();

            const panel = new SqlProfilerWebviewController(this._context, {
                runner,
                capabilities,
                connectionLabel: opened.label,
                serverKey: opened.serverKey,
                bufferSize: bufferSize(),
            });
            this._livePanels.set(opened.serverKey, panel);
            panel.onDisposed(() => {
                this._livePanels.delete(opened.serverKey);
                void opened.session.close({ reason: "profiler panel closed" });
            });
        } catch (error) {
            vscode.window.showErrorMessage(
                `Could not open the profiler: ${getErrorMessage(error)}`,
            );
        }
    }

    /**
     * Opens an .xel file or a saved capture for review. No connection is involved, so this works
     * against a file someone sent you.
     */
    async openFile(uri?: vscode.Uri): Promise<void> {
        try {
            const target = uri ?? (await promptForFile());
            if (!target) {
                return;
            }

            const name = target.path.split("/").pop() ?? target.fsPath;
            const panel = new SqlProfilerWebviewController(this._context, {
                connectionLabel: name,
                serverKey: `file:${target.fsPath}`,
                bufferSize: bufferSize(),
            });

            if (target.fsPath.toLowerCase().endsWith(".xel")) {
                await panel.loadXelFile(target.fsPath, name);
            } else {
                const bytes = await vscode.workspace.fs.readFile(target);
                await panel.loadCapture(parseCapture(Buffer.from(bytes).toString("utf8")), name);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Could not open the file: ${getErrorMessage(error)}`);
        }
    }

    dispose(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables.length = 0;
        this._livePanels.clear();
    }
}

async function promptForFile(): Promise<vscode.Uri | undefined> {
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: "Open in profiler",
        filters: {
            "Profiler captures": ["xel", "json"],
            "Extended Events files": ["xel"],
            "Saved captures": ["json"],
        },
    });
    return picked?.[0];
}

/** A window below a few hundred events makes the top-queries view meaningless. */
function bufferSize(): number {
    const configured = vscode.workspace
        .getConfiguration("mssql.profiler")
        .get<number>("eventBufferSize");
    return Number.isFinite(configured) && (configured as number) >= 100
        ? Math.floor(configured as number)
        : DEFAULT_BUFFER_SIZE;
}
