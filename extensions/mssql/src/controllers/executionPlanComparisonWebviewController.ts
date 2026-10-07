/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";
import { ErrorCodes, ResponseError } from "vscode-jsonrpc/node";

import { startActivity } from "extension-toolkit/vscode";
import * as LocalizedConstants from "../constants/locConstants";
import { sqlPlanLanguageId } from "../constants/constants";
import * as ep from "../sharedInterfaces/executionPlan";
import * as epc from "../sharedInterfaces/executionPlanComparison";
import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { ExecutionPlanService } from "../services/executionPlanService";
import { getErrorMessage } from "../utils/utils";
import { executionPlanSourceRegistry } from "./executionPlanSourceRegistry";
import { WebviewPanelController } from "./webviewPanelController";
import SqlDocumentService, { ConnectionStrategy } from "./sqlDocumentService";

interface PlanQuickPickItem extends vscode.QuickPickItem {
    plan?: { name: string; contents: string };
}

let comparisonEditorCounter = 0;
const viewSettingsStorageKey = "executionPlanComparison.viewSettings";

/**
 * A comparison shows a snapshot. Drop the live markers of a statement that is still running, so
 * the snapshot does not claim to refresh.
 */
export function toComparisonGraph(graph: ep.ExecutionPlanGraph): ep.ExecutionPlanGraph {
    if (!graph.isLive && !graph.liveQueryStatistics && graph.liveRefreshId === undefined) {
        return graph;
    }
    const snapshot = { ...graph };
    delete snapshot.isLive;
    delete snapshot.liveRefreshId;
    delete snapshot.liveQueryStatistics;
    return snapshot;
}

/**
 * SQL Tools Service's getExecutionPlan response contains graphs but no ResultStatus, even though
 * the shared TypeScript interface inherits it. Treat only a status explicitly supplied as false
 * as failure, while still validating that the selected file produced a comparable graph.
 */
export function getComparisonExecutionPlanGraphs(
    result: ep.GetExecutionPlanResult,
): ep.ExecutionPlanGraph[] {
    if (result.success === false) {
        throw new Error(
            result.errorMessage || LocalizedConstants.executionPlanComparisonLoadFailed,
        );
    }
    if (!Array.isArray(result.graphs) || result.graphs.length === 0) {
        throw new Error(LocalizedConstants.executionPlanComparisonFileContainsNoPlans);
    }
    return result.graphs;
}

/** Parses showplan XML into the graphs of one comparison pane. */
export async function loadComparisonGraphs(
    executionPlanService: ExecutionPlanService,
    planXml: string,
): Promise<ep.ExecutionPlanGraph[]> {
    return getComparisonExecutionPlanGraphs(
        await executionPlanService.getExecutionPlan({
            graphFileContent: planXml,
            graphFileType: `.${sqlPlanLanguageId}`,
        }),
    );
}

function toInitialSource(
    source: epc.ExecutionPlanComparisonInitialSource,
): epc.ExecutionPlanComparisonInitialSource {
    return {
        name: source.name,
        graphs: source.graphs.map(toComparisonGraph),
        graphIndex: Math.min(Math.max(source.graphIndex, 0), Math.max(source.graphs.length - 1, 0)),
    };
}

function collectMatches(
    root: ep.ExecutionGraphComparisonResult,
): epc.ExecutionPlanComparisonMatch[] {
    const matches: epc.ExecutionPlanComparisonMatch[] = [];
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.hasMatch) {
            matches.push({
                nodeId: String(node.baseNode.id),
                groupIndex: node.groupIndex,
                matchingNodeIds: (node.matchingNodesId ?? []).map(String),
            });
        }
        const children = node.children ?? [];
        for (let index = children.length - 1; index >= 0; index--) {
            stack.push(children[index]);
        }
    }
    return matches;
}

/**
 * Reduces a tools service comparison to the matched nodes of each graph. The response repeats the
 * full subtree of every node, which is quadratic in the plan size, and carries no ResultStatus;
 * its comparison trees are the authoritative success payload, matching Azure Data Studio.
 */
export function getExecutionPlanComparisonMatches(
    result: ep.ExecutionPlanComparisonResult,
): epc.CompareExecutionPlanGraphsResult {
    if (result.success === false) {
        throw new Error(result.errorMessage || LocalizedConstants.executionPlanComparisonFailed);
    }
    if (!result.firstComparisonResult || !result.secondComparisonResult) {
        throw new Error(LocalizedConstants.executionPlanComparisonFailed);
    }
    return {
        primary: collectMatches(result.firstComparisonResult),
        secondary: collectMatches(result.secondComparisonResult),
    };
}

/**
 * A ResponseError reaches the webview with its message as is. Any other error would arrive
 * wrapped in the name of the request.
 */
function toResponseError(error: unknown, fallbackMessage: string): ResponseError<void> {
    return new ResponseError(ErrorCodes.InternalError, getErrorMessage(error) || fallbackMessage);
}

/**
 * Hosts the comparison editor. The webview owns which plans and statements it shows, so this
 * controller keeps no webview state: it hands over the plans the editor was opened with, loads
 * the plans the user picks, and compares the graphs the webview sends.
 */
export class ExecutionPlanComparisonWebviewController extends WebviewPanelController<
    epc.ExecutionPlanComparisonWebviewState,
    epc.ExecutionPlanComparisonReducers
> {
    private readonly _initialSources: epc.ExecutionPlanComparisonInitialSources;

    constructor(
        context: vscode.ExtensionContext,
        private readonly _executionPlanService: ExecutionPlanService,
        private readonly _sqlDocumentService: SqlDocumentService,
        initialSources: epc.ExecutionPlanComparisonInitialSources = {},
    ) {
        comparisonEditorCounter++;
        super(
            context,
            "executionPlanComparison",
            "executionPlanComparison",
            {},
            {
                title: LocalizedConstants.compareExecutionPlansEditor(comparisonEditorCounter),
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "executionPlan_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "executionPlan_light.svg",
                    ),
                },
            },
        );

        this._initialSources = {
            primary: initialSources.primary && toInitialSource(initialSources.primary),
            secondary: initialSources.secondary && toInitialSource(initialSources.secondary),
        };

        this.onRequest(epc.GetInitialComparisonSourcesRequest.type, () => this._initialSources);
        this.onRequest(epc.PickComparisonSourceRequest.type, (params) =>
            this.pickSource(params?.replacing),
        );
        this.onRequest(epc.CompareExecutionPlanGraphsRequest.type, (params) =>
            this.compareGraphs(params),
        );
        this.onRequest(epc.GetComparisonViewSettingsRequest.type, () => this.getViewSettings());
        this.onNotification(epc.UpdateComparisonViewSettingsNotification.type, (update) => {
            void this._context.globalState.update(viewSettingsStorageKey, {
                ...this.getViewSettings(),
                ...update,
            });
        });
        this.onNotification(epc.ShowComparisonQueryNotification.type, ({ query }) => {
            void this._sqlDocumentService.newQuery({
                content: query,
                connectionStrategy: ConnectionStrategy.DoNotConnect,
            });
        });
    }

    private getViewSettings(): epc.ExecutionPlanComparisonViewSettings {
        return {
            ...epc.defaultComparisonViewSettings,
            ...this._context.globalState.get<Partial<epc.ExecutionPlanComparisonViewSettings>>(
                viewSettingsStorageKey,
            ),
        };
    }

    private async pickSource(
        replacing: string | undefined,
    ): Promise<epc.ExecutionPlanComparisonSource | undefined> {
        const plan = await this.pickPlan(replacing);
        if (!plan) {
            return undefined;
        }
        try {
            const graphs = await loadComparisonGraphs(this._executionPlanService, plan.contents);
            return { name: plan.name, graphs };
        } catch (error) {
            this.logger.error("Failed to load execution plan for comparison", error);
            throw toResponseError(error, LocalizedConstants.executionPlanComparisonLoadFailed);
        }
    }

    private async compareGraphs(
        params: epc.CompareExecutionPlanGraphsParams,
    ): Promise<epc.CompareExecutionPlanGraphsResult> {
        const activity = startActivity(TelemetryViews.ExecutionPlan, TelemetryActions.Compare);
        try {
            const matches = getExecutionPlanComparisonMatches(
                await this._executionPlanService.compareExecutionPlanGraph(
                    params.primary,
                    params.secondary,
                ),
            );
            activity.end(ActivityStatus.Succeeded, {
                additionalMeasurements: {
                    primaryMatchCount: matches.primary.length,
                    secondaryMatchCount: matches.secondary.length,
                },
            });
            return matches;
        } catch (error) {
            this.logger.error("Failed to compare execution plans", error);
            activity.endFailed(error instanceof Error ? error : new Error(getErrorMessage(error)));
            throw toResponseError(error, LocalizedConstants.executionPlanComparisonFailed);
        }
    }

    /** Offers the open plans and a file browser, and returns the chosen plan's XML. */
    private async pickPlan(
        replacing: string | undefined,
    ): Promise<{ name: string; contents: string } | undefined> {
        const registeredSources = executionPlanSourceRegistry.getSources();
        const registeredContents = new Set(registeredSources.map((source) => source.contents));
        const registeredItems: PlanQuickPickItem[] = registeredSources.map((source) => ({
            label: `$(graph) ${source.sourceName}`,
            description: LocalizedConstants.openExecutionPlan,
            plan: { name: source.sourceName, contents: source.contents },
        }));
        // A .sqlplan file opened in its plan viewer stays in workspace.textDocuments, so skip the
        // documents that already appear as open plans.
        const documentItems: PlanQuickPickItem[] = [];
        for (const document of vscode.workspace.textDocuments) {
            if (
                document.uri.scheme === "untitled" ||
                (document.languageId !== sqlPlanLanguageId &&
                    !document.fileName.toLowerCase().endsWith(`.${sqlPlanLanguageId}`))
            ) {
                continue;
            }
            const contents = document.getText();
            if (registeredContents.has(contents)) {
                continue;
            }
            const name = path.basename(document.fileName);
            documentItems.push({
                label: `$(file) ${name}`,
                description: document.uri.fsPath,
                plan: { name, contents },
            });
        }
        const browseItem: PlanQuickPickItem = {
            label: `$(folder-opened) ${LocalizedConstants.browseForExecutionPlan}`,
        };

        const selected = await vscode.window.showQuickPick(
            [browseItem, ...registeredItems, ...documentItems],
            {
                placeHolder:
                    replacing === undefined
                        ? LocalizedConstants.selectExecutionPlanToCompare
                        : LocalizedConstants.selectExecutionPlanToReplace(replacing),
                matchOnDescription: true,
            },
        );
        if (!selected) {
            return undefined;
        }
        if (selected.plan) {
            return selected.plan;
        }

        const uri = (
            await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    [LocalizedConstants.executionPlanFileFilter]: [sqlPlanLanguageId],
                },
                openLabel: LocalizedConstants.compareExecutionPlans,
            })
        )?.[0];
        if (!uri) {
            return undefined;
        }
        return {
            name: path.basename(uri.fsPath || uri.path),
            contents: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
        };
    }
}
