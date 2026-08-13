/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DashboardSnapshot, DashboardTarget } from "../../sharedInterfaces/serverDashboard";

/**
 * Data boundary for the server dashboard. A SQL Tools Service, ARM, Fabric, or HTTP-backed
 * implementation can replace the mock without changing the webview contract.
 */
export interface IDashboardDataService {
    getAvailableTargets(): DashboardTarget[];
    loadDashboard(target: DashboardTarget, windowMinutes?: number): Promise<DashboardSnapshot>;
    refreshDashboard(target: DashboardTarget, windowMinutes: number): Promise<DashboardSnapshot>;
    acknowledgeIssue(target: DashboardTarget, issueId: string): Promise<DashboardSnapshot>;
    setDbAgentEnabled(target: DashboardTarget, enabled: boolean): Promise<DashboardSnapshot>;
}
