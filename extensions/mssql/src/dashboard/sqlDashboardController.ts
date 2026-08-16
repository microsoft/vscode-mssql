/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { WebviewPanelController } from "../controllers/webviewPanelController";
import { diag } from "../diagnostics/diagnosticsCore";
import { Perf } from "../perf/perfTelemetry";
import { SqlDashboard } from "../sharedInterfaces/sqlDashboard";
import { SqlDashboardSession } from "./dashboardSession";
import { SqlDashboardLoc } from "./locConstants";

export interface SqlDashboardControllerDeps {
    session: SqlDashboardSession;
    profileId?: string;
    initialRoute: SqlDashboard.Route;
}

export interface DashboardRenderedState {
    requestId: number;
    route: SqlDashboard.Route["kind"];
    tableRows: number;
}

export class SqlDashboardWebviewController extends WebviewPanelController<
    SqlDashboard.WebviewState,
    Record<string, never>
> {
    private readonly session: SqlDashboardSession;
    private readonly profileId: string | undefined;
    private rendered: DashboardRenderedState | undefined;
    private openEnded = false;

    constructor(context: vscode.ExtensionContext, deps: SqlDashboardControllerDeps) {
        super(context, "sqlDashboard", "sqlDashboard", deps.session.state(), {
            viewType: "mssql.sqlDashboard",
            title: SqlDashboardLoc.title,
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: false,
            retainContextWhenHidden: false,
            showRestorePromptAfterClose: false,
            iconPath: {
                light: vscode.Uri.joinPath(context.extensionUri, "media", "database_light.svg"),
                dark: vscode.Uri.joinPath(context.extensionUri, "media", "database_dark.svg"),
            },
        });
        this.session = deps.session;
        this.profileId = deps.profileId;
        this.registerDisposable(
            this.session.onDidChange((state) => {
                this.updateState(state);
            }),
        );
        this.registerRpcHandlers();
        this.panel.onDidDispose(() => this.session.dispose());
    }

    protected override cspOptions(): { enabled: boolean } {
        return { enabled: true };
    }

    async initialize(initialRoute: SqlDashboard.Route): Promise<SqlDashboard.WebviewState> {
        return this.runRoute(initialRoute, "open");
    }

    async navigate(route: SqlDashboard.Route): Promise<SqlDashboard.WebviewState> {
        return this.runRoute(route, "navigate");
    }

    snapshot(): SqlDashboard.WebviewState {
        return this.session.state();
    }

    renderedState(): DashboardRenderedState | undefined {
        return this.rendered;
    }

    private registerRpcHandlers(): void {
        this.onRequest(SqlDashboard.NavigateRequest.type, ({ route }) =>
            this.runRoute(route, "navigate"),
        );
        this.onRequest(SqlDashboard.RefreshRequest.type, async () => {
            const route = this.session.state().route;
            Perf.marker("mssql.dashboard.refresh.begin", "begin", { route: route.kind });
            try {
                const result = await this.runRoute(route, "refresh");
                Perf.marker("mssql.dashboard.refresh.end", "end", {
                    route: route.kind,
                    outcome: result.status,
                });
                return result;
            } catch (error) {
                Perf.marker("mssql.dashboard.refresh.end", "end", {
                    route: route.kind,
                    outcome: "failed",
                });
                throw error;
            }
        });
        this.onRequest(SqlDashboard.OpenQueryStudioRequest.type, async ({ database }) => {
            if (!this.profileId) {
                return { opened: false };
            }
            await vscode.commands.executeCommand("mssql.queryStudio.newQueryFromContext", {
                profileId: this.profileId,
                database,
                source: "sqlDashboard",
            });
            return { opened: true };
        });
        this.onNotification(SqlDashboard.RenderedNotification.type, (rendered) => {
            if (rendered.requestId !== this.session.state().requestId) {
                return;
            }
            this.rendered = rendered;
            diag.emit({
                feature: "sqlDashboard",
                kind: "renderPhase",
                type: "dashboard.route.renderComplete",
                fields: {
                    route: { raw: rendered.route, cls: "diagnostic.metadata" },
                    tableRows: { raw: rendered.tableRows, cls: "diagnostic.metadata" },
                },
            });
        });
    }

    private async runRoute(
        route: SqlDashboard.Route,
        reason: "open" | "navigate" | "refresh",
    ): Promise<SqlDashboard.WebviewState> {
        const expectedRequestId = this.session.state().requestId + 1;
        Perf.marker("mssql.dashboard.route.begin", "begin", {
            route: route.kind,
            reason,
            requestId: expectedRequestId,
        });
        const span = diag.startSpan({
            feature: "sqlDashboard",
            kind: "span",
            type: "dashboard.route",
            fields: {
                route: { raw: route.kind, cls: "diagnostic.metadata" },
                reason: { raw: reason, cls: "diagnostic.metadata" },
            },
        });
        const result =
            reason === "refresh"
                ? await this.session.refresh()
                : await this.session.navigate(route);
        const currentRequest = result.requestId === expectedRequestId;
        const outcome = currentRequest ? result.status : "cancelled";
        const sectionCount = currentRequest ? (result.page?.sections.length ?? 0) : 0;
        const pageKind = currentRequest ? (result.page?.kind ?? "none") : "none";
        Perf.marker("mssql.dashboard.route.ready", "end", {
            route: route.kind,
            outcome,
            pageKind,
            ...(result.page?.kind === "unavailable"
                ? { unavailableReason: result.page.state.reason }
                : {}),
            requestId: expectedRequestId,
            sections: sectionCount,
        });
        if (outcome === "error") {
            span.end("error");
        } else if (outcome === "cancelled") {
            span.end("blocked");
        } else {
            span.end("ok");
        }
        if (!this.openEnded && reason === "open") {
            this.openEnded = true;
            Perf.marker("mssql.dashboard.open.end", "end", {
                mode: result.mode,
                route: route.kind,
                outcome,
            });
        }
        return result;
    }

    public override dispose(): void {
        this.session.dispose();
        super.dispose();
    }
}
