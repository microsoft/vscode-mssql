/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { Perf } from "../perf/perfTelemetry";
import {
    PreparedConnection,
    prepareConnection,
    ProfileSecretSource,
    ProfileTokenSource,
} from "../services/metadata/profileAuthAdapter";
import { SqlDataPlaneService } from "../services/sqlDataPlane/sqlDataPlaneService";
import { vscodeFallbackInteraction } from "../services/sqlDataPlane/vscodeFallbackInteraction";
import {
    ConnectionProfileSource,
    OeV2ProfileRecord,
    readProfileTree,
} from "../objectExplorer/v2/sessions/oeV2ProfileAdapter";
import { SqlDashboard } from "../sharedInterfaces/sqlDashboard";
import { DashboardQueryPool } from "./data/dashboardQueryPool";
import { parseDashboardPerfArgs } from "./dashboardPerfApi";
import { SqlDashboardSession } from "./dashboardSession";
import { LiveDashboardProvider } from "./liveDashboardProvider";
import { SqlDashboardLoc } from "./locConstants";
import { MockDashboardProvider } from "./mockDashboardProvider";
import { SqlDashboardWebviewController } from "./sqlDashboardController";

export interface SqlDashboardActivationDeps {
    readonly profiles: ConnectionProfileSource & ProfileSecretSource;
    readonly tokens: ProfileTokenSource;
}

export function sqlDashboardEnabled(): boolean {
    const configuration = vscode.workspace.getConfiguration();
    return (
        configuration.get<boolean>("mssql.sqlDashboard.enabled", true) &&
        configuration.get<boolean>("mssql.sqlDataPlane.enabled", false)
    );
}

function panelKey(
    mode: "live" | "mock",
    profileId: string | undefined,
    prepared: PreparedConnection | undefined,
    database: string,
    scenario?: SqlDashboard.MockScenario,
): string {
    return [
        mode,
        profileId ?? "fixture",
        prepared?.serverFingerprint ?? "fixture",
        database,
        scenario ?? "live",
    ].join("|");
}

export function activateSqlDashboard(
    context: vscode.ExtensionContext,
    deps: SqlDashboardActivationDeps,
): void {
    const panels = new Map<string, SqlDashboardWebviewController>();
    let activeController: SqlDashboardWebviewController | undefined;

    const openMock = async (
        scenario: SqlDashboard.MockScenario,
        route: SqlDashboard.Route,
    ): Promise<SqlDashboardWebviewController> => {
        const database = "WideWorldImporters";
        const key = panelKey("mock", undefined, undefined, database, scenario);
        const existing = panels.get(key);
        if (existing) {
            activeController = existing;
            existing.revealToForeground();
            await existing.navigate(route);
            return existing;
        }
        const provider = new MockDashboardProvider(scenario);
        const session = new SqlDashboardSession(provider, route);
        Perf.marker("mssql.dashboard.open.begin", "begin", {
            mode: "mock",
            route: route.kind,
        });
        const controller = new SqlDashboardWebviewController(context, {
            session,
            initialRoute: route,
        });
        panels.set(key, controller);
        activeController = controller;
        controller.onDisposed(() => {
            panels.delete(key);
            if (activeController === controller) {
                activeController = undefined;
            }
        });
        controller.revealToForeground();
        await controller.initialize(route);
        return controller;
    };

    const openLive = async (
        record: OeV2ProfileRecord,
        database: string,
        route: SqlDashboard.Route,
    ): Promise<SqlDashboardWebviewController> => {
        const prepared = prepareConnection(record.stored, deps.profiles, deps.tokens);
        const key = panelKey("live", record.profileId, prepared, database);
        const existing = panels.get(key);
        if (existing) {
            activeController = existing;
            existing.revealToForeground();
            await existing.navigate(route);
            return existing;
        }
        const dataPlane = SqlDataPlaneService.get();
        const pool = new DashboardQueryPool(
            async (laneId) => {
                const { session } = await dataPlane.openSessionWithFallback(
                    {
                        profile: prepared.profileRef,
                        database,
                        applicationName: `vscode-mssql-dashboard-${laneId}`,
                        auth: prepared.auth,
                        requiredCapabilities: [
                            { id: "exec.cancel", require: "supported" },
                            { id: "exec.dispose", require: "supported" },
                        ],
                    },
                    undefined,
                    vscodeFallbackInteraction(),
                );
                return session;
            },
            4,
            (event) => {
                switch (event.phase) {
                    case "begin":
                        Perf.marker("mssql.dashboard.collector.begin", "begin", event);
                        break;
                    case "firstPage":
                        Perf.marker("mssql.dashboard.collector.firstPage", "instant", event);
                        break;
                    case "end":
                        Perf.marker("mssql.dashboard.collector.end", "end", event);
                        break;
                }
            },
        );
        const provider = new LiveDashboardProvider(pool, {
            displayName: record.displayName,
            server: record.server,
            database,
            backend: "SQL Data Plane",
        });
        const dashboardSession = new SqlDashboardSession(provider, route);
        Perf.marker("mssql.dashboard.open.begin", "begin", {
            mode: "live",
            route: route.kind,
        });
        const controller = new SqlDashboardWebviewController(context, {
            session: dashboardSession,
            profileId: record.profileId,
            initialRoute: route,
        });
        panels.set(key, controller);
        activeController = controller;
        controller.onDisposed(() => {
            panels.delete(key);
            if (activeController === controller) {
                activeController = undefined;
            }
        });
        controller.revealToForeground();
        await controller.initialize(route);
        return controller;
    };

    const chooseProfile = async (): Promise<OeV2ProfileRecord | undefined> => {
        const tree = await readProfileTree(deps.profiles);
        if (tree.profiles.length === 0) {
            void vscode.window.showInformationMessage(SqlDashboardLoc.noSavedProfile);
            return undefined;
        }
        return vscode.window
            .showQuickPick(
                tree.profiles.map((profile) => ({
                    label: profile.displayName,
                    description: profile.server,
                    profile,
                })),
                { title: SqlDashboardLoc.selectConnection },
            )
            .then((picked) => picked?.profile);
    };

    const openFromCommand = async (node?: {
        connectionId?: string;
        database?: string;
    }): Promise<void> => {
        if (!sqlDashboardEnabled()) {
            void vscode.window.showInformationMessage(SqlDashboardLoc.featureDisabled);
            return;
        }
        const tree = await readProfileTree(deps.profiles);
        const record = node?.connectionId
            ? tree.profiles.find((profile) => profile.profileId === node.connectionId)
            : await chooseProfile();
        if (!record) {
            return;
        }
        const database = node?.database ?? record.database ?? "master";
        const route: SqlDashboard.Route = node?.database
            ? { kind: "databaseOverview", database }
            : { kind: "serverOverview" };
        await openLive(record, database, route);
    };

    context.subscriptions.push(
        vscode.commands.registerCommand("mssql.sqlDashboard.open", openFromCommand),
        vscode.commands.registerCommand("mssql.sqlDashboard.openDemo", () =>
            openMock("canonical", { kind: "serverOverview" }),
        ),
        {
            dispose: () => {
                for (const controller of panels.values()) {
                    controller.dispose();
                }
                panels.clear();
                activeController = undefined;
            },
        },
    );

    if (Perf.enabled) {
        context.subscriptions.push(
            vscode.commands.registerCommand("mssql.perf.dashboard.openRoute", async (args) => {
                const parsed = parseDashboardPerfArgs(args, "WideWorldImporters");
                const controller = await openMock(parsed.scenario, parsed.route);
                return controller.snapshot();
            }),
            vscode.commands.registerCommand("mssql.perf.dashboard.getState", () =>
                activeController?.snapshot(),
            ),
            vscode.commands.registerCommand(
                "mssql.perf.dashboard.getSectionState",
                (args?: { sectionId?: string }) => {
                    if (!args || typeof args.sectionId !== "string") {
                        throw new TypeError("sectionId is required");
                    }
                    return activeController
                        ?.snapshot()
                        .page?.sections.find((section) => section.id === args.sectionId);
                },
            ),
            vscode.commands.registerCommand("mssql.perf.dashboard.getRenderedTableState", () =>
                activeController?.renderedState(),
            ),
            vscode.commands.registerCommand(
                "mssql.perf.dashboard.setMockScenario",
                async (args) => {
                    const parsed = parseDashboardPerfArgs(args, "WideWorldImporters");
                    const controller = await openMock(parsed.scenario, parsed.route);
                    return controller.snapshot();
                },
            ),
            vscode.commands.registerCommand("mssql.perf.dashboard.interact", async (args) => {
                const parsed = parseDashboardPerfArgs(args, "WideWorldImporters");
                if (!activeController) {
                    throw new Error("SQL Dashboard is not open");
                }
                return activeController.navigate(parsed.route);
            }),
        );
    }
}
