/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";

import * as LocalizedConstants from "../constants/locConstants";
import { sqlPlanLanguageId } from "../constants/constants";
import {
    getPreviewConfigKey,
    isReactFlowExecutionPlanPreviewEnabled,
    PreviewFeature,
} from "../previews/previewService";
import * as ep from "../sharedInterfaces/executionPlan";
import { ApiStatus } from "../sharedInterfaces/webview";
import { ExecutionPlanService } from "../services/executionPlanService";
import { getErrorMessage } from "../utils/utils";
import {
    executionPlanSourceRegistry,
    OpenExecutionPlanSource,
} from "./executionPlanSourceRegistry";
import { WebviewPanelController } from "./webviewPanelController";

interface ExecutionPlanQuickPickItem extends vscode.QuickPickItem {
    document?: vscode.TextDocument;
    source?: OpenExecutionPlanSource;
    browse?: boolean;
}

let comparisonEditorCounter = 0;

/**
 * SQL Tools Service comparison expects an extensionless SQL plan file type. Clone the graph info
 * so switching into comparison mode never mutates the graph used by the normal plan renderer.
 */
export function getExecutionPlanComparisonGraphInfo(
    graphInfo: ep.ExecutionPlanGraphInfo,
): ep.ExecutionPlanGraphInfo {
    return {
        ...graphInfo,
        graphFileType: sqlPlanLanguageId,
    };
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

/**
 * SQL Tools Service's comparison response also contains no ResultStatus. The comparison trees are
 * the authoritative success payload, matching Azure Data Studio's handling.
 */
export function getValidExecutionPlanComparisonResult(
    result: ep.ExecutionPlanComparisonResult,
): ep.ExecutionPlanComparisonResult {
    if (result.success === false) {
        throw new Error(result.errorMessage || LocalizedConstants.executionPlanComparisonFailed);
    }
    if (!result.firstComparisonResult || !result.secondComparisonResult) {
        throw new Error(LocalizedConstants.executionPlanComparisonFailed);
    }
    return result;
}

export class ExecutionPlanComparisonWebviewController extends WebviewPanelController<
    ep.ExecutionPlanWebviewState,
    ep.ExecutionPlanReducers
> {
    private _comparisonRequestVersion = 0;

    constructor(
        context: vscode.ExtensionContext,
        private readonly _executionPlanService: ExecutionPlanService,
        primaryGraphs: ep.ExecutionPlanGraph[],
        primaryGraphIndex: number,
        primarySourceName: string,
    ) {
        comparisonEditorCounter++;
        super(
            context,
            "executionPlan",
            "executionPlanComparison",
            {
                executionPlanState: {
                    loadState: ApiStatus.Loaded,
                    executionPlanGraphs: [],
                    totalCost: 0,
                    isReactFlowExecutionPlanEnabled: isReactFlowExecutionPlanPreviewEnabled(),
                },
                executionPlanComparisonState: {
                    primary: {
                        sourceName: primarySourceName,
                        graphs: primaryGraphs,
                        selectedGraphIndex: Math.min(
                            Math.max(primaryGraphIndex, 0),
                            Math.max(primaryGraphs.length - 1, 0),
                        ),
                    },
                    loadState: ApiStatus.Loaded,
                },
            },
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

        this.registerRpcHandlers();
        this.registerDisposable(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (
                    event.affectsConfiguration(
                        getPreviewConfigKey(PreviewFeature.ReactFlowExecutionPlan),
                    )
                ) {
                    this.updateState({
                        ...this.state,
                        executionPlanState: {
                            ...this.state.executionPlanState,
                            isReactFlowExecutionPlanEnabled:
                                isReactFlowExecutionPlanPreviewEnabled(),
                        },
                    });
                }
            }),
        );
    }

    private registerRpcHandlers(): void {
        this.registerReducer("getExecutionPlan", async (state) => state);
        this.registerReducer("saveExecutionPlan", async (state) => state);
        this.registerReducer("showPlanXml", async (state) => state);
        this.registerReducer("showQuery", async (state) => state);
        this.registerReducer("updateTotalCost", async (state) => state);
        this.registerReducer("compareExecutionPlan", async (state) => state);
        this.registerReducer("selectComparisonPlan", async (state) => {
            const selection = await this.selectComparisonPlan();
            if (!selection) {
                return state;
            }

            const loadingState: ep.ExecutionPlanWebviewState = {
                ...state,
                executionPlanComparisonState: {
                    ...state.executionPlanComparisonState!,
                    loadState: ApiStatus.Loading,
                    errorMessage: undefined,
                },
            };
            this.updateState(loadingState);

            try {
                const result = await this._executionPlanService.getExecutionPlan({
                    graphFileContent: selection.contents,
                    graphFileType: `.${sqlPlanLanguageId}`,
                });
                const graphs = getComparisonExecutionPlanGraphs(result);

                const comparisonState: ep.ExecutionPlanComparisonState = {
                    ...loadingState.executionPlanComparisonState!,
                    secondary: {
                        sourceName: selection.sourceName,
                        graphs,
                        selectedGraphIndex: 0,
                    },
                };
                return await this.compareSelectedGraphs({
                    ...loadingState,
                    executionPlanComparisonState: comparisonState,
                });
            } catch (error) {
                this.logger.error("Failed to load execution plan for comparison", error);
                return {
                    ...loadingState,
                    executionPlanComparisonState: {
                        ...loadingState.executionPlanComparisonState!,
                        loadState: ApiStatus.Error,
                        errorMessage:
                            getErrorMessage(error) ||
                            LocalizedConstants.executionPlanComparisonLoadFailed,
                    },
                };
            }
        });
        this.registerReducer("setComparisonGraphIndexes", async (state, payload) => {
            const comparisonState = state.executionPlanComparisonState;
            if (!comparisonState) {
                return state;
            }

            const primaryIndex =
                payload.primaryGraphIndex ?? comparisonState.primary.selectedGraphIndex;
            const secondaryIndex =
                payload.secondaryGraphIndex ?? comparisonState.secondary?.selectedGraphIndex ?? 0;
            const nextState: ep.ExecutionPlanWebviewState = {
                ...state,
                executionPlanComparisonState: {
                    ...comparisonState,
                    primary: {
                        ...comparisonState.primary,
                        selectedGraphIndex: Math.min(
                            Math.max(primaryIndex, 0),
                            Math.max(comparisonState.primary.graphs.length - 1, 0),
                        ),
                    },
                    secondary: comparisonState.secondary
                        ? {
                              ...comparisonState.secondary,
                              selectedGraphIndex: Math.min(
                                  Math.max(secondaryIndex, 0),
                                  Math.max(comparisonState.secondary.graphs.length - 1, 0),
                              ),
                          }
                        : undefined,
                    comparisonResult: undefined,
                    errorMessage: undefined,
                },
            };
            return await this.compareSelectedGraphs(nextState);
        });
    }

    private async compareSelectedGraphs(
        state: ep.ExecutionPlanWebviewState,
    ): Promise<ep.ExecutionPlanWebviewState> {
        const comparisonState = state.executionPlanComparisonState;
        const primaryGraph =
            comparisonState?.primary.graphs[comparisonState.primary.selectedGraphIndex];
        const secondaryGraph =
            comparisonState?.secondary?.graphs[comparisonState.secondary.selectedGraphIndex];
        if (!comparisonState || !primaryGraph || !secondaryGraph) {
            return {
                ...state,
                executionPlanComparisonState: {
                    ...comparisonState!,
                    loadState: ApiStatus.Loaded,
                },
            };
        }

        const requestVersion = ++this._comparisonRequestVersion;
        const loadingState: ep.ExecutionPlanWebviewState = {
            ...state,
            executionPlanComparisonState: {
                ...comparisonState,
                loadState: ApiStatus.Loading,
                comparisonResult: undefined,
                errorMessage: undefined,
            },
        };
        this.updateState(loadingState);

        try {
            const comparisonResult = getValidExecutionPlanComparisonResult(
                await this._executionPlanService.compareExecutionPlanGraph(
                    getExecutionPlanComparisonGraphInfo(primaryGraph.graphFile),
                    getExecutionPlanComparisonGraphInfo(secondaryGraph.graphFile),
                ),
            );
            if (requestVersion !== this._comparisonRequestVersion) {
                return this.state;
            }
            return {
                ...loadingState,
                executionPlanComparisonState: {
                    ...loadingState.executionPlanComparisonState!,
                    comparisonResult,
                    loadState: ApiStatus.Loaded,
                },
            };
        } catch (error) {
            if (requestVersion !== this._comparisonRequestVersion) {
                return this.state;
            }
            this.logger.error("Failed to compare execution plans", error);
            return {
                ...loadingState,
                executionPlanComparisonState: {
                    ...loadingState.executionPlanComparisonState!,
                    loadState: ApiStatus.Error,
                    errorMessage:
                        getErrorMessage(error) || LocalizedConstants.executionPlanComparisonFailed,
                },
            };
        }
    }

    private async selectComparisonPlan(): Promise<
        { contents: string; sourceName: string } | undefined
    > {
        const openPlanItems: ExecutionPlanQuickPickItem[] = vscode.workspace.textDocuments
            .filter(
                (document) =>
                    document.uri.scheme !== "untitled" &&
                    (document.languageId === sqlPlanLanguageId ||
                        document.fileName.toLowerCase().endsWith(`.${sqlPlanLanguageId}`)),
            )
            .map((document) => ({
                label: `$(file) ${path.basename(document.fileName)}`,
                description: document.uri.fsPath,
                document,
            }));
        const browseItem: ExecutionPlanQuickPickItem = {
            label: `$(folder-opened) ${LocalizedConstants.browseForExecutionPlan}`,
            browse: true,
        };
        const registeredPlanItems: ExecutionPlanQuickPickItem[] = executionPlanSourceRegistry
            .getSources()
            .map((source) => ({
                label: `$(graph) ${source.sourceName}`,
                description: LocalizedConstants.openExecutionPlan,
                source,
            }));

        const selected = await vscode.window.showQuickPick(
            [browseItem, ...registeredPlanItems, ...openPlanItems],
            {
                placeHolder: LocalizedConstants.selectExecutionPlanToCompare,
                matchOnDescription: true,
            },
        );
        if (!selected) {
            return undefined;
        }
        if (selected.document) {
            return {
                contents: selected.document.getText(),
                sourceName: path.basename(selected.document.fileName),
            };
        }
        if (selected.source) {
            return {
                contents: selected.source.contents,
                sourceName: selected.source.sourceName,
            };
        }

        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                [LocalizedConstants.executionPlanFileFilter]: [sqlPlanLanguageId],
            },
            openLabel: LocalizedConstants.compareExecutionPlans,
        });
        const uri = uris?.[0];
        if (!uri) {
            return undefined;
        }
        const contents = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        return {
            contents,
            sourceName: path.basename(uri.fsPath || uri.path),
        };
    }
}
