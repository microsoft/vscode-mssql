/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as LocConstants from "../constants/locConstants";
import { WebviewNavigation } from "../controllers/webviewNavigation";
import { WebviewPanelController } from "../controllers/webviewPanelController";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import {
    PerformanceConnectionReference,
    isPerformanceUnavailable,
} from "../sharedInterfaces/performance";
import {
    ListDatabasesRequest,
    ListDatabasesResult,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
    SwitchDatabaseRequest,
} from "../sharedInterfaces/performanceDashboard";
import { PerformanceService } from "./performanceService";

/** The database that a dashboard shows. */
export interface PerformanceDashboardTarget {
    /** The connection to give the performance service. */
    readonly reference: PerformanceConnectionReference;
    readonly serverName: string;
    /** Empty for the login's default database. */
    readonly databaseName: string;
}

/** What a dashboard needs from the code that opens it. */
export interface PerformanceDashboardHost {
    readonly performanceService: PerformanceService;
    /**
     * Shows another database of the same server in the dashboard, or reveals the open dashboard
     * of that database. Returns true when the dashboard now shows the database.
     */
    switchDatabase(dashboard: PerformanceDashboardWebviewController, database: string): boolean;
}

/**
 * Returns the saved profile and database of an Object Explorer node, or undefined when the node
 * has no saved profile.
 */
export function performanceDashboardTargetForNode(
    node: TreeNodeInfo | undefined,
): PerformanceDashboardTarget | undefined {
    const profile = node?.connectionProfile;
    if (!profile?.id) {
        return undefined;
    }
    const nodeDatabase = ObjectExplorerUtils.getDatabaseName(node);
    const databaseName =
        nodeDatabase && nodeDatabase !== LocConstants.defaultDatabaseLabel
            ? nodeDatabase
            : profile.database;
    return {
        reference: databaseName
            ? { profileId: profile.id, database: databaseName }
            : { profileId: profile.id },
        serverName: profile.server,
        databaseName: databaseName ?? "",
    };
}

/** Returns the target for another database of the same server. */
export function performanceDashboardTargetForDatabase(
    target: PerformanceDashboardTarget,
    database: string,
): PerformanceDashboardTarget {
    return {
        ...target,
        reference: { ...target.reference, database },
        databaseName: database,
    };
}

/** The performance dashboard of one database. */
export class PerformanceDashboardWebviewController extends WebviewPanelController<
    PerformanceDashboardState,
    PerformanceDashboardReducers
> {
    private readonly _navigation: WebviewNavigation;
    private _target: PerformanceDashboardTarget;

    /**
     * @param initialLocation The dashboard location to open at, for example `queries/913`. The
     * default is the overview.
     */
    constructor(
        context: vscode.ExtensionContext,
        private readonly _host: PerformanceDashboardHost,
        target: PerformanceDashboardTarget,
        initialLocation?: string,
    ) {
        super(context, "performanceDashboard", "performanceDashboard", stateFor(target), {
            title: titleFor(target),
            viewColumn: vscode.ViewColumn.Active,
            iconPath: {
                light: vscode.Uri.joinPath(
                    context.extensionUri,
                    "media",
                    "performanceDashboard_light.svg",
                ),
                dark: vscode.Uri.joinPath(
                    context.extensionUri,
                    "media",
                    "performanceDashboard_dark.svg",
                ),
            },
        });
        this._target = target;
        this._navigation = new WebviewNavigation(this, initialLocation);
        this.onRequest(ListDatabasesRequest.type, () => this.listDatabases());
        this.onRequest(SwitchDatabaseRequest.type, ({ database }) => ({
            switched: this._host.switchDatabase(this, database),
        }));
    }

    public get target(): PerformanceDashboardTarget {
        return this._target;
    }

    /** The current dashboard location. */
    public get location(): string {
        return this._navigation.location;
    }

    /** Shows a dashboard location. */
    public navigate(location: string): void {
        this._navigation.navigate(location);
    }

    /** Shows another database in this panel. The host keeps one panel for each database. */
    public setTarget(target: PerformanceDashboardTarget): void {
        this._target = target;
        this.panel.title = titleFor(target);
        this.state = stateFor(target);
    }

    /**
     * Lists the databases of the server. In Azure SQL Database, a user database sees only itself
     * and `master`, so the list comes from `master` when the login can open it.
     */
    private async listDatabases(): Promise<ListDatabasesResult> {
        const reference = this._target.reference;
        const fromTarget = await this.readDatabases(reference);
        if (
            fromTarget.platform === "azureSqlDatabase" &&
            reference.database?.toLowerCase() !== "master"
        ) {
            const fromMaster = await this.readDatabases({ ...reference, database: "master" });
            if (!fromMaster.result.errorMessage) {
                return fromMaster.result;
            }
        }
        return fromTarget.result;
    }

    private async readDatabases(
        reference: PerformanceConnectionReference,
    ): Promise<{ result: ListDatabasesResult; platform?: string }> {
        const target = await this._host.performanceService.resolveTarget(reference);
        if (isPerformanceUnavailable(target)) {
            return { result: { databases: [], errorMessage: target.detail ?? target.reason } };
        }
        const read = await target.databases();
        return {
            platform: read.platform,
            result: read.data
                ? { databases: read.data }
                : { databases: [], errorMessage: read.error?.message ?? read.status },
        };
    }
}

function stateFor(target: PerformanceDashboardTarget): PerformanceDashboardState {
    return { serverName: target.serverName, databaseName: target.databaseName };
}

function titleFor(target: PerformanceDashboardTarget): string {
    return LocConstants.PerformanceDashboard.title(target.databaseName || target.serverName);
}
