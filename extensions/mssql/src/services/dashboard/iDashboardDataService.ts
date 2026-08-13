/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DashboardSnapshot,
    DashboardTarget,
    DbAgentAnalyzableSection,
    DbAgentSettings,
} from "../../sharedInterfaces/serverDashboard";

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
    registerDbAgent(target: DashboardTarget): Promise<DashboardSnapshot>;
    decideDbAgentAction(
        target: DashboardTarget,
        issueId: string,
        actionId: string,
        decision: "approve" | "reject",
    ): Promise<DashboardSnapshot>;
    executeDbAgentAction(
        target: DashboardTarget,
        issueId: string,
        actionId: string,
    ): Promise<DashboardSnapshot>;
    markDbAgentActionApplied(
        target: DashboardTarget,
        issueId: string,
        actionId: string,
    ): Promise<DashboardSnapshot>;
    analyzeDbAgentSection(
        target: DashboardTarget,
        issueId: string,
        section: DbAgentAnalyzableSection,
    ): Promise<DashboardSnapshot>;
    forceResolveInvestigation(
        target: DashboardTarget,
        investigationId: string,
        reason?: string,
    ): Promise<DashboardSnapshot>;
    saveDbAgentSettings(
        target: DashboardTarget,
        settings: DbAgentSettings,
    ): Promise<DashboardSnapshot>;
    createDbAgentInstruction(target: DashboardTarget, text: string): Promise<DashboardSnapshot>;
    revokeDbAgentInstruction(
        target: DashboardTarget,
        instructionId: string,
    ): Promise<DashboardSnapshot>;
}
