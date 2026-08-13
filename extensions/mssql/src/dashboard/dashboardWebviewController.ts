/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { WebviewPanelController } from "../controllers/webviewPanelController";
import {
    DashboardSnapshot,
    DashboardTabId,
    ServerDashboardReducers,
    ServerDashboardWebviewState,
} from "../sharedInterfaces/serverDashboard";
import { IDashboardDataService } from "../services/dashboard/iDashboardDataService";
import * as Constants from "../constants/constants";
import * as Loc from "../constants/locConstants";
import { getErrorMessage } from "../utils/utils";

export interface DashboardTargetChangedEvent {
    previousTargetId: string;
    targetId: string;
}

export class DashboardWebviewController extends WebviewPanelController<
    ServerDashboardWebviewState,
    ServerDashboardReducers
> {
    private readonly _onTargetChanged = new vscode.EventEmitter<DashboardTargetChangedEvent>();
    private _snapshotRequestId = 0;
    public readonly onTargetChanged = this._onTargetChanged.event;

    public constructor(
        context: vscode.ExtensionContext,
        private readonly _dataService: IDashboardDataService,
        snapshot: DashboardSnapshot,
        selectedTab: DashboardTabId,
    ) {
        const dbAgentAvailable = isConfigurationEnabled(Constants.configDbAgentEnabled);
        super(
            context,
            "serverDashboard",
            "serverDashboard",
            {
                snapshot,
                availableTargets: [
                    snapshot.target,
                    ..._dataService
                        .getAvailableTargets()
                        .filter((target) => target.id !== snapshot.target.id),
                ],
                dbAgentAvailable,
                selectedTab:
                    selectedTab === "issues" && !dbAgentAvailable ? "overview" : selectedTab,
                isRefreshing: false,
            },
            {
                title: Loc.Dashboard.panelTitle(snapshot.target.displayName),
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: false,
            },
        );

        this.registerReducers();
        this.registerDisposable(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration(Constants.configDbAgentEnabled)) {
                    return;
                }

                const available = isConfigurationEnabled(Constants.configDbAgentEnabled);
                this.state = {
                    ...this.state,
                    dbAgentAvailable: available,
                    selectedTab:
                        !available && this.state.selectedTab === "issues"
                            ? "overview"
                            : this.state.selectedTab,
                };
            }),
        );
    }

    public selectTab(tabId: DashboardTabId): void {
        if (tabId === "issues" && !this.state.dbAgentAvailable) {
            return;
        }
        this.state = {
            ...this.state,
            selectedTab: tabId,
        };
    }

    private registerReducers(): void {
        this.registerReducer("refresh", async (state) => {
            this.state = { ...state, isRefreshing: true, errorMessage: undefined };
            return this.loadSnapshot(() =>
                this._dataService.refreshDashboard(
                    state.snapshot.target,
                    state.snapshot.windowMinutes,
                ),
            );
        });

        this.registerReducer("changeTarget", async (state, payload) => {
            const target = state.availableTargets.find(
                (candidate) => candidate.id === payload.targetId,
            );
            if (!target) {
                return {
                    ...state,
                    errorMessage: Loc.Dashboard.selectedResourceUnavailable,
                };
            }

            this.state = { ...state, isRefreshing: true, errorMessage: undefined };
            return this.loadSnapshot(() =>
                this._dataService.loadDashboard(target, state.snapshot.windowMinutes),
            );
        });

        this.registerReducer("changeTimeWindow", async (state, payload) => {
            this.state = { ...state, isRefreshing: true, errorMessage: undefined };
            return this.loadSnapshot(() =>
                this._dataService.refreshDashboard(state.snapshot.target, payload.windowMinutes),
            );
        });

        this.registerReducer("selectTab", (state, payload) => ({
            ...state,
            selectedTab:
                payload.tabId === "issues" && !state.dbAgentAvailable ? "overview" : payload.tabId,
        }));

        this.registerReducer("acknowledgeIssue", async (state, payload) =>
            this.loadSnapshot(() =>
                this._dataService.acknowledgeIssue(state.snapshot.target, payload.issueId),
            ),
        );

        this.registerReducer("setDbAgentEnabled", async (state, payload) =>
            this.loadSnapshot(() =>
                this._dataService.setDbAgentEnabled(state.snapshot.target, payload.enabled),
            ),
        );

        this.registerReducer("openNewQuery", (state) => {
            void vscode.commands.executeCommand(Constants.cmdNewQuery);
            return state;
        });
    }

    private async loadSnapshot(
        loader: () => Promise<DashboardSnapshot>,
    ): Promise<ServerDashboardWebviewState> {
        const requestId = ++this._snapshotRequestId;
        try {
            const snapshot = await loader();
            if (requestId !== this._snapshotRequestId) {
                return this.state;
            }

            const previousTargetId = this.state.snapshot.target.id;
            this.panel.title = Loc.Dashboard.panelTitle(snapshot.target.displayName);
            const nextState = {
                ...this.state,
                snapshot,
                isRefreshing: false,
                errorMessage: undefined,
            };
            if (previousTargetId !== snapshot.target.id) {
                this._onTargetChanged.fire({
                    previousTargetId,
                    targetId: snapshot.target.id,
                });
            }
            return nextState;
        } catch (error) {
            if (requestId !== this._snapshotRequestId) {
                return this.state;
            }
            return {
                ...this.state,
                isRefreshing: false,
                errorMessage: Loc.Dashboard.refreshFailed(getErrorMessage(error)),
            };
        }
    }

    public override dispose(): void {
        super.dispose();
        this._onTargetChanged.dispose();
    }
}

function isConfigurationEnabled(configuration: string): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(configuration, true);
}
