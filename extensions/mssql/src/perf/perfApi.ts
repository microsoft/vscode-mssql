/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Perf-only API surface (harness design §16.3). Registered ONLY when
 * PERF_MODE=1; outside perf mode this function is a no-op and none of these
 * commands exist. Not a public extension API — the perf driver extension is
 * the only intended caller (via vscode.commands.executeCommand).
 *
 * Probe commands intentionally reach into internals through any-casts: this
 * is the sanctioned test seam (like mssql.getControllerForTests), gated so it
 * cannot leak into the product surface.
 */

import * as vscode from "vscode";
import { Perf } from "./perfTelemetry";

export const perfGetStateCommand = "mssql.perf.getState";

export interface PerfApiProviders {
    getController?: () => unknown;
}

export function registerPerfApi(
    context: vscode.ExtensionContext,
    providers: PerfApiProviders = {},
): void {
    if (!Perf.enabled) {
        return;
    }
    context.subscriptions.push(
        vscode.commands.registerCommand(perfGetStateCommand, () => Perf.getState()),
    );

    /**
     * Results-grid probe: live product state for a results URI (or the most
     * recent one) — resultSetSummaries with rowCounts + isExecuting.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand("mssql.perf.gridState", (uri?: string) => {
            try {
                const controller = providers.getController?.() as
                    | {
                          _outputContentProvider?: {
                              queryResultWebviewController?: {
                                  getQueryResultState(uri: string): {
                                      resultSetSummaries?: Record<
                                          string,
                                          Record<string, { rowCount?: number; id?: number }>
                                      >;
                                      isExecuting?: boolean;
                                  };
                                  getActiveResultsUris?(): string[];
                              };
                          };
                      }
                    | undefined;
                const webviewController =
                    controller?._outputContentProvider?.queryResultWebviewController;
                if (!webviewController) {
                    return { error: "queryResultWebviewController unavailable" };
                }
                const targetUri =
                    uri ?? vscode.window.activeTextEditor?.document.uri.toString() ?? "";
                const state = webviewController.getQueryResultState(targetUri);
                const resultSets: Array<{
                    batchId: string;
                    resultId: string;
                    rowCount: number;
                    columnCount: number;
                }> = [];
                for (const [batchId, byResult] of Object.entries(state?.resultSetSummaries ?? {})) {
                    for (const [resultId, summary] of Object.entries(byResult)) {
                        resultSets.push({
                            batchId,
                            resultId,
                            rowCount: summary?.rowCount ?? 0,
                            columnCount:
                                (summary as { columnInfo?: unknown[] })?.columnInfo?.length ?? 0,
                        });
                    }
                }
                return {
                    uri: targetUri,
                    isExecuting: state?.isExecuting ?? null,
                    resultSets,
                    totalRows: resultSets.reduce((total, rs) => total + rs.rowCount, 0),
                    maxColumns: resultSets.reduce((max, rs) => Math.max(max, rs.columnCount), 0),
                };
            } catch (err) {
                return { error: String(err) };
            }
        }),
    );

    /**
     * Windowed row fetch through the REAL product row path (the same
     * rowRequestHandler the webview grid calls) — used to verify row
     * correctness at arbitrary offsets in virtual-window scenarios.
     */
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql.perf.gridFetchWindow",
            async (args: {
                uri?: string;
                batchId?: number;
                resultId?: number;
                rowStart: number;
                numberOfRows: number;
            }) => {
                try {
                    const controller = providers.getController?.() as
                        | {
                              _outputContentProvider?: {
                                  rowRequestHandler(
                                      uri: string,
                                      batchId: number,
                                      resultId: number,
                                      rowStart: number,
                                      numberOfRows: number,
                                  ): Promise<{
                                      rowCount?: number;
                                      rows?: Array<Array<{ displayValue?: string }>>;
                                  }>;
                              };
                          }
                        | undefined;
                    const provider = controller?._outputContentProvider;
                    if (!provider) {
                        return { error: "outputContentProvider unavailable" };
                    }
                    const targetUri =
                        args.uri ?? vscode.window.activeTextEditor?.document.uri.toString() ?? "";
                    const subset = await provider.rowRequestHandler(
                        targetUri,
                        args.batchId ?? 0,
                        args.resultId ?? 0,
                        args.rowStart,
                        args.numberOfRows,
                    );
                    return {
                        rowStart: args.rowStart,
                        rowsReturned: subset?.rows?.length ?? 0,
                        firstRow: subset?.rows?.[0]?.map((cell) => cell?.displayValue ?? "") ?? [],
                        lastRow:
                            subset?.rows?.[subset.rows.length - 1]?.map(
                                (cell) => cell?.displayValue ?? "",
                            ) ?? [],
                    };
                } catch (err) {
                    return { error: String(err) };
                }
            },
        ),
    );

    /**
     * Object Explorer probe: expanded-node child counts from the live tree
     * model (nodePath → childCount).
     */
    context.subscriptions.push(
        vscode.commands.registerCommand("mssql.perf.oeSnapshot", () => {
            try {
                const controller = providers.getController?.() as
                    | {
                          _objectExplorerProvider?: {
                              objectExplorerService?: {
                                  _treeNodeToChildrenMap?: Map<
                                      { nodePath?: string; label?: unknown },
                                      unknown[]
                                  >;
                              };
                              _objectExplorerService?: {
                                  _treeNodeToChildrenMap?: Map<
                                      { nodePath?: string; label?: unknown },
                                      unknown[]
                                  >;
                              };
                          };
                      }
                    | undefined;
                const oeProvider = controller?._objectExplorerProvider;
                const service =
                    oeProvider?.objectExplorerService ?? oeProvider?._objectExplorerService;
                const map = service?._treeNodeToChildrenMap;
                if (!map) {
                    return { error: "object explorer children map unavailable" };
                }
                const nodes: Array<{ nodePath: string; label: string; childCount: number }> = [];
                for (const [node, children] of map.entries()) {
                    nodes.push({
                        nodePath: node?.nodePath ?? "",
                        label: String(node?.label ?? ""),
                        childCount: Array.isArray(children) ? children.length : 0,
                    });
                }
                return { nodes };
            } catch (err) {
                return { error: String(err) };
            }
        }),
    );
}
