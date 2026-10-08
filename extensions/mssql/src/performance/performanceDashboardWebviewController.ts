/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as LocConstants from "../constants/locConstants";
import { WebviewPanelController } from "../controllers/webviewPanelController";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { PerformanceConnectionReference } from "../sharedInterfaces/performance";
import {
    PerformanceDashboardReducers,
    PerformanceDashboardState,
} from "../sharedInterfaces/performanceDashboard";

/** The database that a dashboard shows. */
export interface PerformanceDashboardTarget {
    /** The connection to give the performance service. */
    readonly reference: PerformanceConnectionReference;
    readonly serverName: string;
    /** Empty for the login's default database. */
    readonly databaseName: string;
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

/** The performance dashboard of one database. */
export class PerformanceDashboardWebviewController extends WebviewPanelController<
    PerformanceDashboardState,
    PerformanceDashboardReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        readonly target: PerformanceDashboardTarget,
    ) {
        super(
            context,
            "performanceDashboard",
            "performanceDashboard",
            {
                serverName: target.serverName,
                databaseName: target.databaseName,
            },
            {
                title: LocConstants.PerformanceDashboard.title(
                    target.databaseName || target.serverName,
                ),
                viewColumn: vscode.ViewColumn.Active,
                iconPath: vscode.Uri.joinPath(
                    context.extensionUri,
                    "media",
                    "objectTypes",
                    "Database.svg",
                ),
            },
        );
    }
}
