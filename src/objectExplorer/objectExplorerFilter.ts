/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactWebviewPanelController } from "../controllers/reactWebviewController";
import * as vscodeMssql from "vscode-mssql";
import * as vscode from "vscode";
import { TreeNodeInfo } from "./treeNodeInfo";
import {
    ObjectExplorerFilterState,
    ObjectExplorerReducers,
} from "../sharedInterfaces/objectExplorerFilter";
import { sendActionEvent } from "../telemetry/telemetry";
import {
    TelemetryActions,
    TelemetryViews,
} from "../sharedInterfaces/telemetry";
import { randomUUID } from "crypto";

export class ObjectExplorerFilterReactWebviewController extends ReactWebviewPanelController<
    ObjectExplorerFilterState,
    ObjectExplorerReducers
> {
    private _onSubmit: vscode.EventEmitter<vscodeMssql.NodeFilter[]> =
        new vscode.EventEmitter<vscodeMssql.NodeFilter[]>();
    public readonly onSubmit: vscode.Event<vscodeMssql.NodeFilter[]> =
        this._onSubmit.event;

    private _onCancel: vscode.EventEmitter<void> =
        new vscode.EventEmitter<void>();
    public readonly onCancel: vscode.Event<void> = this._onCancel.event;

    constructor(
        context: vscode.ExtensionContext,
        data?: ObjectExplorerFilterState,
    ) {
        super(
            context,
            vscode.l10n.t("Object Explorer Filter"),
            "objectExplorerFilter",
            data ?? {
                filterProperties: [],
                existingFilters: [],
                nodePath: "",
            },
            vscode.ViewColumn.Beside,
            {
                dark: vscode.Uri.joinPath(
                    context.extensionUri,
                    "media",
                    "filter_dark.svg",
                ),
                light: vscode.Uri.joinPath(
                    context.extensionUri,
                    "media",
                    "filter_light.svg",
                ),
            },
        );

        this.registerReducer("submit", (state, payload) => {
            this._onSubmit.fire(payload.filters);
            this.panel.dispose();
            return state;
        });

        this.registerReducer("cancel", (state) => {
            this._onCancel.fire();
            this.panel.dispose();
            return state;
        });
    }

    public loadData(data: ObjectExplorerFilterState): void {
        this.state = data;
    }
}

export class ObjectExplorerFilter {
    private static _filterWebviewController: ObjectExplorerFilterReactWebviewController;
    /**
     * This method is used to get the filters from the user for the given treeNode.
     * @param context The extension context
     * @param treeNode The treeNode for which the filters are needed
     * @returns The filters that the user has selected or undefined if the user has cancelled the operation.
     */
    public static async getFilters(
        context: vscode.ExtensionContext,
        treeNode: TreeNodeInfo,
    ): Promise<vscodeMssql.NodeFilter[] | undefined> {
        return await new Promise((resolve, _reject) => {
            const correlationId = randomUUID();
            sendActionEvent(
                TelemetryViews.ObjectExplorerFilter,
                TelemetryActions.Open,
                {
                    nodeType: treeNode.nodeType,
                    correlationId,
                },
            );
            if (
                !this._filterWebviewController ||
                this._filterWebviewController.isDisposed
            ) {
                this._filterWebviewController =
                    new ObjectExplorerFilterReactWebviewController(context, {
                        filterProperties: treeNode.filterableProperties,
                        existingFilters: treeNode.filters,
                        nodePath: treeNode.nodePath,
                    });
            } else {
                this._filterWebviewController.loadData({
                    filterProperties: treeNode.filterableProperties,
                    existingFilters: treeNode.filters,
                    nodePath: treeNode.nodePath,
                });
            }
            this._filterWebviewController.revealToForeground();
            this._filterWebviewController.onSubmit((e) => {
                sendActionEvent(
                    TelemetryViews.ObjectExplorerFilter,
                    TelemetryActions.Submit,
                    {
                        nodeType: treeNode.nodeType,
                        correlationId,
                    },
                    {
                        filterCount: e.length,
                    },
                );
                resolve(e);
            });
            this._filterWebviewController.onCancel(() => {
                sendActionEvent(
                    TelemetryViews.ObjectExplorerFilter,
                    TelemetryActions.Cancel,
                    {
                        nodeType: treeNode.nodeType,
                        correlationId,
                    },
                );
                resolve(undefined);
            });
            this._filterWebviewController.onDisposed(() => {
                sendActionEvent(
                    TelemetryViews.ObjectExplorerFilter,
                    TelemetryActions.Cancel,
                    {
                        nodeType: treeNode.nodeType,
                        correlationId,
                    },
                );
                resolve(undefined);
            });
        });
    }
}
