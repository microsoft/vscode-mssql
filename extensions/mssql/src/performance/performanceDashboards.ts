/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    PerformanceDashboardHost,
    PerformanceDashboardTarget,
    PerformanceDashboardWebviewController,
    performanceDashboardTargetForDatabase,
} from "./performanceDashboardWebviewController";
import { PerformanceService } from "./performanceService";

export type PerformanceDashboardFactory = (
    context: vscode.ExtensionContext,
    host: PerformanceDashboardHost,
    target: PerformanceDashboardTarget,
    initialLocation: string | undefined,
) => PerformanceDashboardWebviewController;

/** The extension's editors, which the dashboards open plans and queries in. */
export interface PerformancePlanViewer {
    open(planXml: string, name: string): void;
    compare(
        first: { readonly name: string; readonly planXml: string },
        second: { readonly name: string; readonly planXml: string },
    ): Promise<void>;
    /** Opens T-SQL in a query editor that is connected to the target's database. */
    openQuery(sql: string, target: PerformanceDashboardTarget): Promise<void>;
}

/** Keeps one open dashboard for each connection and database. */
export class PerformanceDashboards implements PerformanceDashboardHost {
    private readonly _open = new Map<string, PerformanceDashboardWebviewController>();

    constructor(
        private readonly _context: vscode.ExtensionContext,
        readonly performanceService: PerformanceService,
        private readonly _planViewer: PerformancePlanViewer,
        private readonly _create: PerformanceDashboardFactory = (context, host, target, location) =>
            new PerformanceDashboardWebviewController(context, host, target, location),
    ) {}

    /**
     * Shows the dashboard of the target. An open dashboard is revealed, and goes to `location`
     * when it is set. Otherwise it keeps its location.
     */
    public open(
        target: PerformanceDashboardTarget,
        location?: string,
    ): PerformanceDashboardWebviewController {
        const existing = this.find(target);
        if (existing) {
            if (location !== undefined) {
                existing.navigate(location);
            }
            existing.revealToForeground();
            return existing;
        }

        const dashboard = this._create(this._context, this, target, location);
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
        this._planViewer.open(planXml, name);
    }

    public compareExecutionPlans(
        first: { readonly name: string; readonly planXml: string },
        second: { readonly name: string; readonly planXml: string },
    ): Promise<void> {
        return this._planViewer.compare(first, second);
    }

    public openSqlScript(sql: string, target: PerformanceDashboardTarget): Promise<void> {
        return this._planViewer.openQuery(sql, target);
    }

    public switchDatabase(
        dashboard: PerformanceDashboardWebviewController,
        database: string,
    ): boolean {
        const target = performanceDashboardTargetForDatabase(dashboard.target, database);
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

/** The connection ID and the database identify a dashboard. */
function dashboardKey(target: PerformanceDashboardTarget): string {
    const { reference } = target;
    return JSON.stringify([
        reference.profileId ?? reference.ownerUri,
        reference.database ?? target.databaseName,
    ]);
}
