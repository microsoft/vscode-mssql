/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Run status-bar pill (mockup "Run: running…" / "Run: awaiting gate"):
 * one item summarizing the most attention-worthy active run across open
 * runbook documents. Awaiting approval outranks running; a terminal state
 * lingers briefly then hides. Clicking deep-links to that document's Run
 * page. Purely observational — reads model snapshots, never mutates.
 */

import * as vscode from "vscode";
import { RunbookStudio as LocRunbookStudio } from "../constants/locConstants";
import { RunbookStudioDocumentModel } from "./runbookStudioDocumentModel";

const TERMINAL_LINGER_MS = 15_000;

export class RunbookRunStatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly tracked = new Set<RunbookStudioDocumentModel>();
    private readonly subscriptions: vscode.Disposable[] = [];
    private lingerTimer: ReturnType<typeof setTimeout> | undefined;

    constructor() {
        this.item = vscode.window.createStatusBarItem(
            "mssql.runbookStudio.run",
            vscode.StatusBarAlignment.Right,
            90,
        );
        this.item.name = LocRunbookStudio.statusBarName;
    }

    /** Observe a document model (idempotent). */
    public track(model: RunbookStudioDocumentModel): void {
        if (this.tracked.has(model)) {
            return;
        }
        this.tracked.add(model);
        this.subscriptions.push(model.onDidChange(() => this.refresh()));
        this.refresh();
    }

    private refresh(): void {
        if (this.lingerTimer) {
            clearTimeout(this.lingerTimer);
            this.lingerTimer = undefined;
        }
        const candidates = [...this.tracked].filter(
            (model) => model.panelCount > 0 && model.activeRun !== undefined,
        );
        const awaiting = candidates.find((m) => m.activeRun!.state === "awaitingApproval");
        const running = candidates.find((m) =>
            ["accepted", "running", "cancelling"].includes(m.activeRun!.state),
        );
        const terminal = candidates.find(
            (m) =>
                m.activeRun!.endedEpochMs !== undefined &&
                Date.now() - m.activeRun!.endedEpochMs < TERMINAL_LINGER_MS,
        );
        const target = awaiting ?? running ?? terminal;
        if (!target) {
            this.item.hide();
            return;
        }
        const run = target.activeRun!;
        this.item.command = {
            command: "mssql.runbookStudio.openRun",
            title: LocRunbookStudio.statusBarName,
            arguments: [{ documentUri: target.uriKey, route: "run" }],
        };
        if (awaiting) {
            this.item.text = `$(shield) ${LocRunbookStudio.statusBarAwaitingApproval}`;
            this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        } else if (running) {
            this.item.text = `$(sync~spin) ${LocRunbookStudio.statusBarRunning}`;
            this.item.backgroundColor = undefined;
        } else {
            const passed = run.state === "succeeded";
            this.item.text = passed
                ? `$(check) ${LocRunbookStudio.statusBarPassed}`
                : `$(error) ${LocRunbookStudio.statusBarFailed}`;
            this.item.backgroundColor = passed
                ? undefined
                : new vscode.ThemeColor("statusBarItem.errorBackground");
            // Linger, then clear (a fresh refresh re-evaluates everything).
            this.lingerTimer = setTimeout(() => this.refresh(), TERMINAL_LINGER_MS);
        }
        this.item.show();
    }

    public dispose(): void {
        if (this.lingerTimer) {
            clearTimeout(this.lingerTimer);
        }
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.item.dispose();
    }
}
