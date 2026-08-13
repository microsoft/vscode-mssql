/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as Loc from "../constants/locConstants";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { DashboardTabId, DashboardTarget } from "../sharedInterfaces/serverDashboard";
import { detectDashboardPlatform } from "../services/dashboard/dashboardTarget";
import { IDashboardDataService } from "../services/dashboard/iDashboardDataService";
import { MockDashboardDataService } from "../services/dashboard/mockDashboardDataService";
import { DashboardWebviewController } from "./dashboardWebviewController";

export class DashboardCommandService implements vscode.Disposable {
    private readonly _controllers = new Map<string, DashboardWebviewController>();
    private readonly _disposables: vscode.Disposable[] = [];

    public constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _dataService: IDashboardDataService = new MockDashboardDataService(),
    ) {
        this._disposables.push(
            vscode.commands.registerCommand(
                Constants.cmdShowServerDashboard,
                async (node?: TreeNodeInfo) => this.openDashboard(node, "overview"),
            ),
            vscode.commands.registerCommand(
                Constants.cmdShowServerDashboardDbAgent,
                async (node?: TreeNodeInfo) => this.openDashboard(node, "issues"),
            ),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (
                    event.affectsConfiguration(Constants.configDashboardEnabled) &&
                    !isConfigurationEnabled(Constants.configDashboardEnabled)
                ) {
                    for (const controller of new Set(this._controllers.values())) {
                        controller.dispose();
                    }
                }
            }),
        );
    }

    public dispose(): void {
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
        for (const controller of new Set(this._controllers.values())) {
            controller.dispose();
        }
        this._controllers.clear();
    }

    private async openDashboard(
        node: TreeNodeInfo | undefined,
        selectedTab: DashboardTabId,
    ): Promise<void> {
        if (!isConfigurationEnabled(Constants.configDashboardEnabled)) {
            await vscode.window.showInformationMessage(Loc.Dashboard.dashboardDisabled);
            return;
        }
        if (selectedTab === "issues" && !isConfigurationEnabled(Constants.configDbAgentEnabled)) {
            await vscode.window.showInformationMessage(Loc.Dashboard.dbAgentDisabled);
            return;
        }

        const target = node ? this.getTargetFromNode(node) : await this.pickMockTarget();
        if (!target) {
            return;
        }

        const existingController = this._controllers.get(target.id);
        if (existingController && !existingController.isDisposed) {
            existingController.selectTab(selectedTab);
            existingController.revealToForeground();
            return;
        }

        const snapshot = await this._dataService.loadDashboard(target);
        const controller = new DashboardWebviewController(
            this._context,
            this._dataService,
            snapshot,
            selectedTab,
        );
        this.trackController(target.id, controller);
    }

    private trackController(targetId: string, controller: DashboardWebviewController): void {
        this._controllers.set(targetId, controller);
        const controllerSubscriptions: vscode.Disposable[] = [];

        controllerSubscriptions.push(
            controller.onTargetChanged(({ previousTargetId, targetId: nextTargetId }) => {
                if (this._controllers.get(previousTargetId) === controller) {
                    this._controllers.delete(previousTargetId);
                }

                const duplicateController = this._controllers.get(nextTargetId);
                if (
                    duplicateController &&
                    duplicateController !== controller &&
                    !duplicateController.isDisposed
                ) {
                    duplicateController.dispose();
                }
                this._controllers.set(nextTargetId, controller);
            }),
            controller.onDisposed(() => {
                for (const [registeredTargetId, registeredController] of this._controllers) {
                    if (registeredController === controller) {
                        this._controllers.delete(registeredTargetId);
                    }
                }
                for (const subscription of controllerSubscriptions) {
                    subscription.dispose();
                }
            }),
        );
    }

    private getTargetFromNode(node: TreeNodeInfo): DashboardTarget {
        const connectionProfile = node.connectionProfile;
        const serverName = connectionProfile?.server || node.label?.toString() || "SQL Server";
        const databaseName =
            ObjectExplorerUtils.getDatabaseName(node) ||
            connectionProfile?.database ||
            Constants.defaultDatabase;

        return {
            id: `${connectionProfile?.id ?? serverName}:${databaseName}`,
            displayName: `${serverName} / ${databaseName}`,
            serverName,
            databaseName,
            platform: detectDashboardPlatform(serverName),
            launchSource: "objectExplorer",
        };
    }

    private async pickMockTarget(): Promise<DashboardTarget | undefined> {
        const targets = this._dataService.getAvailableTargets();
        const items = targets.map((target) => ({
            label: target.displayName,
            description: this.getPlatformLabel(target),
            target,
        }));
        const selection = await vscode.window.showQuickPick(items, {
            title: Loc.Dashboard.openPerformanceDashboard,
            placeHolder: Loc.Dashboard.selectSqlResource,
        });
        return selection?.target;
    }

    private getPlatformLabel(target: DashboardTarget): string {
        switch (target.platform) {
            case "azureSql":
                return Loc.Dashboard.azureSqlDatabase;
            case "fabricSql":
                return Loc.Dashboard.fabricSqlEndpoint;
            case "sqlServer":
                return Loc.Dashboard.sqlServer;
        }
    }
}

function isConfigurationEnabled(configuration: string): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(configuration, true);
}
