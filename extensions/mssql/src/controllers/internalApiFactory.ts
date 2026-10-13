/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeMssql from "vscode-mssql";
import { IConnectionInfo } from "vscode-mssql";
import MainController from "./mainController";
import { loadComparisonGraphs } from "./executionPlanComparisonWebviewController";
import { openExecutionPlanComparisonWebview } from "./sharedExecutionPlanUtils";
import * as utils from "../models/utils";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";

/** A showplan to open in an execution plan comparison. */
export interface ExecutionPlanToCompare {
    /** Display name, such as the plan's file name. */
    name: string;
    /** Showplan XML, as saved in a .sqlplan file. */
    planXml: string;
    /** Statement to show first. Defaults to the first statement. */
    statementIndex?: number;
}

/** Internal services used by in-process features such as SQL Database Projects. */
export interface MssqlInternalApi {
    readonly dacFx: vscodeMssql.IDacFxService;
    readonly schemaCompare: vscodeMssql.ISchemaCompareService;
    readonly sqlProjects: vscodeMssql.ISqlProjectsService;
    readonly azureAccountService: vscodeMssql.IAzureAccountService;
    readonly azureResourceService: vscodeMssql.IAzureResourceService;
    promptForConnection(ignoreFocusOut?: boolean): Promise<IConnectionInfo | undefined>;
    connect(connectionInfo: IConnectionInfo, saveConnection?: boolean): Promise<string>;
    listDatabases(connectionUri: string): Promise<string[]>;
    getDatabaseNameFromTreeNode(node: vscodeMssql.ITreeNodeInfo): string;
    getServerInfo(connectionInfo: IConnectionInfo): vscodeMssql.IServerInfo;
    /**
     * Opens an execution plan comparison with the first plan in the primary pane and the second
     * in the secondary one. Panes without a plan start empty, for the user to add one. Rejects
     * when a plan cannot be parsed.
     */
    compareExecutionPlans(
        first?: ExecutionPlanToCompare,
        second?: ExecutionPlanToCompare,
    ): Promise<void>;
}

/**
 * Builds the mssql API surface backed by the given controller.
 *
 * This object is deliberately kept separate from the public extension exports.
 */
export function createMssqlInternalApi(controller: MainController): MssqlInternalApi {
    return {
        promptForConnection: async (ignoreFocusOut?: boolean) => {
            const connectionProfileList =
                await controller.connectionManager.connectionStore.getPickListItems();
            return controller.connectionManager.connectionUI.promptForConnection(
                connectionProfileList,
                ignoreFocusOut,
            );
        },
        connect: async (connectionInfo: IConnectionInfo, saveConnection?: boolean) => {
            const uri = utils.generateQueryUri().toString();
            // First wait for initial connection request to succeed
            const requestSucceeded = await controller.connect(
                uri,
                connectionInfo,
                saveConnection,
                "extensionApi",
            );
            if (!requestSucceeded) {
                throw new Error(`Connection request for ${JSON.stringify(connectionInfo)} failed`);
            }
            return uri;
        },
        listDatabases: (connectionUri: string) => {
            return controller.connectionManager.listDatabases(connectionUri);
        },
        getDatabaseNameFromTreeNode: (node: vscodeMssql.ITreeNodeInfo) => {
            return ObjectExplorerUtils.getDatabaseName(node);
        },
        dacFx: controller.dacFxService,
        schemaCompare: controller.schemaCompareService,
        sqlProjects: controller.sqlProjectsService,
        azureAccountService: controller.azureAccountService,
        azureResourceService: controller.azureResourceService,
        getServerInfo: (connectionInfo: IConnectionInfo) => {
            return controller.connectionManager.getServerInfo(connectionInfo);
        },
        compareExecutionPlans: async (first, second) => {
            const load = async (plan: ExecutionPlanToCompare | undefined) =>
                plan && {
                    name: plan.name,
                    graphs: await loadComparisonGraphs(
                        controller.executionPlanService,
                        plan.planXml,
                    ),
                    graphIndex: plan.statementIndex ?? 0,
                };
            const [primary, secondary] = await Promise.all([load(first), load(second)]);
            openExecutionPlanComparisonWebview(
                controller.context,
                controller.executionPlanService,
                controller.sqlDocumentService,
                { primary, secondary },
            );
        },
    };
}
