/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { cmdOpenGithubChat } from "../constants/constants";
import {
    PerformanceDashboardHost,
    PerformanceDashboardTarget,
    PerformanceDashboardWebviewController,
    dashboardKey,
} from "./performanceDashboardWebviewController";
import { PerformanceDashboardSource } from "./performanceDashboardTelemetry";
import { QueryStoreService } from "./queryStoreService";

export type PerformanceDashboardFactory = (
    context: vscode.ExtensionContext,
    host: PerformanceDashboardHost,
    target: PerformanceDashboardTarget,
    initialLocation: string | undefined,
) => PerformanceDashboardWebviewController;

/** The extension's editors, which the dashboards open plans and queries in. */
export interface PerformanceDashboardEditors {
    openPlan(planXml: string, name: string): void;
    comparePlans(
        first: { readonly name: string; readonly planXml: string },
        second: { readonly name: string; readonly planXml: string },
    ): Promise<void>;
    /** Opens T-SQL in a query editor that is connected to the target's database. */
    openQuery(sql: string, target: PerformanceDashboardTarget): Promise<void>;
}

/** Keeps one open dashboard for each connection and database. */
export class PerformanceDashboards implements PerformanceDashboardHost {
    private readonly _open = new Map<string, PerformanceDashboardWebviewController>();
    /** Connections whose Database Hub banner the user dismissed. Cleared by a restart. */
    private readonly _dismissedDatabaseHubBanners = new Set<string>();

    constructor(
        private readonly _context: vscode.ExtensionContext,
        readonly queryStoreService: QueryStoreService,
        private readonly _editors: PerformanceDashboardEditors,
        private readonly _create: PerformanceDashboardFactory = (context, host, target, location) =>
            new PerformanceDashboardWebviewController(context, host, target, location),
    ) {}

    public async openChat(prompt: string): Promise<void> {
        // Without isPartialQuery, the chat sends the prompt at once.
        await vscode.commands.executeCommand(cmdOpenGithubChat, {
            query: prompt,
            mode: "agent",
        });
    }

    /**
     * Shows the dashboard of the target. An open dashboard is revealed, and goes to `location`
     * when it is set. Otherwise it keeps its location.
     */
    public open(
        target: PerformanceDashboardTarget,
        location?: string,
        source: PerformanceDashboardSource = PerformanceDashboardSource.Unknown,
    ): PerformanceDashboardWebviewController {
        const existing = this.find(target);
        if (existing) {
            if (location !== undefined) {
                existing.navigate(location);
            }
            existing.revealToForeground();
            existing.reportOpened(source, true);
            return existing;
        }

        const dashboard = this._create(this._context, this, target, location);
        dashboard.reportOpened(source, false);
        this._open.set(dashboardKey(target), dashboard);
        dashboard.onDisposed(() => {
            for (const [key, open] of this._open) {
                if (open === dashboard) {
                    this._open.delete(key);
                }
            }
        });
        dashboard.revealToForeground();
        return dashboard;
    }

    public openPlanXml(planXml: string, name: string): void {
        this._editors.openPlan(planXml, name);
    }

    public compareExecutionPlans(
        first: { readonly name: string; readonly planXml: string },
        second: { readonly name: string; readonly planXml: string },
    ): Promise<void> {
        return this._editors.comparePlans(first, second);
    }

    public openSqlScript(sql: string, target: PerformanceDashboardTarget): Promise<void> {
        return this._editors.openQuery(sql, target);
    }

    public isDatabaseHubBannerDismissed(profileId: string): boolean {
        return this._dismissedDatabaseHubBanners.has(profileId);
    }

    public dismissDatabaseHubBanner(profileId: string): void {
        this._dismissedDatabaseHubBanners.add(profileId);
        for (const dashboard of this._open.values()) {
            if (!dashboard.isDisposed && dashboard.target.profileId === profileId) {
                dashboard.hideDatabaseHubBanner();
            }
        }
    }

    public switchDatabase(
        dashboard: PerformanceDashboardWebviewController,
        database: string,
    ): boolean {
        const target = { ...dashboard.target, databaseName: database };
        const other = this.find(target);
        if (other && other !== dashboard) {
            other.revealToForeground();
            return false;
        }
        const oldKey = dashboardKey(dashboard.target);
        if (this._open.get(oldKey) === dashboard) {
            this._open.delete(oldKey);
        }
        dashboard.setTarget(target);
        this._open.set(dashboardKey(target), dashboard);
        return true;
    }

    private find(
        target: PerformanceDashboardTarget,
    ): PerformanceDashboardWebviewController | undefined {
        const dashboard = this._open.get(dashboardKey(target));
        return dashboard && !dashboard.isDisposed ? dashboard : undefined;
    }
}
