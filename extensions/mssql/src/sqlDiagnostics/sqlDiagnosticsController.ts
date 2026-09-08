/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { DiagnosticsSessionOpener, OpenedDiagnosticsSession } from "./sessionOpener";
import { DataPlaneRunner } from "./dataPlaneRunner";
import { SqlDiagnosticsWebviewController } from "./sqlDiagnosticsWebviewController";
import { getErrorMessage } from "../utils/utils";
import { SqlFeatures } from "../constants/locConstants";
import { DiagnosticsSection } from "../sharedInterfaces/sqlDiagnostics";
import { ITreeNodeInfo } from "vscode-mssql";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";

/** Owns independent feature panels; Query Store additionally belongs to one database. */
export class SqlDiagnosticsController implements vscode.Disposable {
    private readonly _panels = new Map<string, SqlDiagnosticsWebviewController>();
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _dataPlaneEnabled: () => boolean,
        private readonly _opener: DiagnosticsSessionOpener,
        private readonly _createPanel = (
            context: vscode.ExtensionContext,
            runner: DataPlaneRunner,
            label: string,
            section: DiagnosticsSection,
            chooseDatabase: () => Promise<void>,
        ) => new SqlDiagnosticsWebviewController(context, runner, label, section, chooseDatabase),
    ) {
        this._disposables.push(
            vscode.commands.registerCommand("mssql.sqlDiagnostics.open", (node?: ITreeNodeInfo) =>
                this.open("dmv", node),
            ),
            vscode.commands.registerCommand("mssql.sqlActivity.open", (node?: ITreeNodeInfo) =>
                this.open("dmv", node),
            ),
            vscode.commands.registerCommand("mssql.queryStore.open", (node?: ITreeNodeInfo) =>
                this.open("querystore", node),
            ),
            vscode.commands.registerCommand("mssql.sqlAgent.open", (node?: ITreeNodeInfo) =>
                this.open("agent", node),
            ),
        );
    }

    /**
     * Opens the panel for the active connection, reusing an existing panel for that connection
     * rather than stacking duplicates.
     */
    async open(
        section: DiagnosticsSection = "dmv",
        node?: ITreeNodeInfo,
        target?: OpenedDiagnosticsSession,
    ): Promise<void> {
        const title = {
            dmv: SqlFeatures.activity,
            querystore: SqlFeatures.queryStore,
            agent: SqlFeatures.agent,
        }[section];
        let release: (() => Promise<void>) | undefined = target
            ? async () => {
                  await target.session.close({ reason: "feature panel not opened" });
              }
            : undefined;
        try {
            if (!this._dataPlaneEnabled()) {
                const action = await vscode.window.showWarningMessage(
                    SqlFeatures.dataPlaneRequired,
                    SqlFeatures.openSettings,
                );
                if (action === SqlFeatures.openSettings) {
                    await vscode.commands.executeCommand(
                        "workbench.action.openSettings",
                        "mssql.sqlDataPlane.enabled",
                    );
                }
                return;
            }

            const opened =
                target ??
                (await this._opener.open(
                    node?.connectionProfile,
                    node && section !== "agent"
                        ? ObjectExplorerUtils.getDatabaseName(node)
                        : undefined,
                ));
            if (!opened) {
                return;
            }
            release = async () => {
                await opened.session.close({ reason: "feature panel not opened" });
            };
            const runner = new DataPlaneRunner(opened.session);
            const capabilities = await runner.capabilities();
            const key = JSON.stringify([
                section,
                opened.connectionKey,
                section === "querystore" ? capabilities.database : null,
            ]);

            const existing = this._panels.get(key);
            if (existing) {
                existing.revealToForeground();
                return;
            }

            const chooseDatabase = async () => {
                try {
                    const databases = await runner.query(
                        "SELECT name FROM sys.databases WHERE database_id NOT IN (1, 2) AND state = 0 AND HAS_DBACCESS(name) = 1 ORDER BY name",
                        { tag: "sqlFeature.databases" },
                    );
                    const names = databases.rows
                        .map((row) => row.name)
                        .filter((name): name is string => typeof name === "string");
                    if (names.length === 0) {
                        void vscode.window.showInformationMessage(SqlFeatures.noUserDatabases);
                        return;
                    }
                    const database = await vscode.window.showQuickPick(names, {
                        title: SqlFeatures.chooseDatabase,
                    });
                    if (!database) return;
                    const next = await opened.openDatabase(database);
                    if (next) await this.open("querystore", undefined, next);
                } catch (error) {
                    void vscode.window.showErrorMessage(
                        SqlFeatures.openFailed(SqlFeatures.queryStore, getErrorMessage(error)),
                    );
                }
            };
            const panel = this._createPanel(
                this._context,
                runner,
                opened.label,
                section,
                chooseDatabase,
            );
            this._panels.set(key, panel);
            panel.onDisposed(() => {
                this._panels.delete(key);
                void opened.session.close({ reason: "diagnostics panel closed" });
            });
            release = undefined;
        } catch (error) {
            vscode.window.showErrorMessage(SqlFeatures.openFailed(title, getErrorMessage(error)));
        } finally {
            await release?.();
        }
    }

    dispose(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables.length = 0;
        for (const panel of this._panels.values()) panel.dispose();
        this._panels.clear();
    }
}
