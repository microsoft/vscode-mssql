/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";

import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    SchemaCompareReducers,
    SchemaCompareWebViewState,
} from "../sharedInterfaces/schemaCompare";
import { TreeNodeInfo } from "../objectExplorer/treeNodeInfo";
import ConnectionManager from "../controllers/connectionManager";
import { IConnectionProfile } from "../models/interfaces";
import {
    cancel,
    compare,
    generateScript,
    includeExcludeNode,
    openScmp,
    publishDatabaseChanges,
    publishProjectChanges,
    saveScmp,
} from "./schemaCompareUtils";
// import { ConnectionProfile } from "../models/connectionProfile";

export class SchemaCompareWebViewController extends ReactWebviewPanelController<
    SchemaCompareWebViewState,
    SchemaCompareReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        node: any,
        private readonly schemaCompareService: mssql.ISchemaCompareService,
        private readonly connectionMgr: ConnectionManager,
        defaultDeploymentOptions: mssql.DeploymentOptions,
        title: string,
    ) {
        super(
            context,
            "schemaCompare",
            {
                defaultDeploymentOptions: defaultDeploymentOptions,
                sourceEndpointInfo: undefined,
                targetEndpointInfo: undefined,
                schemaCompareResult: undefined,
                generateScriptResultStatus: undefined,
                publishDatabaseChangesResultStatus: undefined,
                schemaComparePublishProjectResult: undefined,
                schemaCompareIncludeExcludeResult: undefined,
                schemaCompareOpenScmpResult: undefined,
                saveScmpResultStatus: undefined,
                cancelResultStatus: undefined,
            },
            {
                title: title,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "schemaCompare_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "schemaCompare_light.svg",
                    ),
                },
            },
        );

        if (!this.isTreeNodeInfoType(node)) {
            node = this.getFullSqlProjectsPathFromNode(node);
        }

        void this.start(node);
        this.registerRpcHandlers();
    }

    /**
     * Starts the schema comparison process.
     * @param sourceContext can be undefined, connection profile, dacpac, or project.
     * @param targetContext optional parameter, but can be connection profile, dacpac, or project.
     * @param comparisonResult Result of a previous comparison, if available.
     */
    // schema compare can get started with four contexts for the source:
    public async start(
        sourceContext: any,
        targetContext: mssql.SchemaCompareEndpointInfo = undefined,
        comparisonResult: mssql.SchemaCompareResult = undefined,
    ): Promise<void> {
        let source: mssql.SchemaCompareEndpointInfo;
        let target: mssql.SchemaCompareEndpointInfo;

        const targetIsSetAsProject: boolean =
            targetContext &&
            targetContext.endpointType ===
                mssql.SchemaCompareEndpointType.Project;

        let profile: IConnectionProfile;

        if (targetIsSetAsProject) {
            profile = sourceContext;
            target = targetContext;
        } else {
            if (!sourceContext) {
                profile = undefined;
            } else {
                profile = <IConnectionProfile>sourceContext.connectionInfo;
            }
        }

        let sourceDacpac = undefined;
        let sourceProject = undefined;

        if (
            !profile &&
            (sourceContext as string) &&
            (sourceContext as string).endsWith(".dacpac")
        ) {
            sourceDacpac = sourceContext as string;
        } else if (!profile) {
            sourceProject = sourceContext as string;
        }

        if (profile) {
            let ownerUri =
                await this.connectionMgr.getUriForConnection(profile);
            let usr = profile.user;
            if (!usr) {
                usr = "default";
            }

            source = {
                endpointType: mssql.SchemaCompareEndpointType.Database,
                serverDisplayName: `${profile.server} (${usr})`,
                serverName: profile.server,
                databaseName:
                    ObjectExplorerUtils.getDatabaseName(sourceContext),
                ownerUri: ownerUri,
                packageFilePath: "",
                connectionDetails: undefined,
                connectionName: profile.profileName ? profile.profileName : "",
                projectFilePath: "",
                targetScripts: [],
                dataSchemaProvider: "",
                extractTarget: mssql.ExtractTarget.schemaObjectType,
            };
        } else if (sourceDacpac) {
            source = {
                endpointType: mssql.SchemaCompareEndpointType.Dacpac,
                serverDisplayName: "",
                serverName: "",
                databaseName: "",
                ownerUri: "",
                packageFilePath: sourceDacpac,
                connectionDetails: undefined,
                projectFilePath: "",
                targetScripts: [],
                dataSchemaProvider: "",
                extractTarget: mssql.ExtractTarget.schemaObjectType,
            };
        } else if (sourceProject) {
            source = {
                endpointType: mssql.SchemaCompareEndpointType.Project,
                packageFilePath: "",
                serverDisplayName: "",
                serverName: "",
                databaseName: "",
                ownerUri: "",
                connectionDetails: undefined,
                projectFilePath: sourceProject,
                targetScripts: [],
                dataSchemaProvider: undefined,
                extractTarget: mssql.ExtractTarget.schemaObjectType,
            };
        }

        await this.launch(source, target, false, comparisonResult);
    }

    /**
     * Primary functional entrypoint for opening the schema comparison window, and optionally running it.
     * @param source
     * @param target
     * @param runComparison whether to immediately run the schema comparison.  Requires both source and target to be specified.  Cannot be true when comparisonResult is set.
     * @param comparisonResult a pre-computed schema comparison result to display.  Cannot be set when runComparison is true.
     */
    public async launch(
        source: mssql.SchemaCompareEndpointInfo | undefined,
        target: mssql.SchemaCompareEndpointInfo | undefined,
        runComparison: boolean = false,
        comparisonResult: mssql.SchemaCompareResult | undefined,
    ): Promise<void> {
        if (runComparison && comparisonResult) {
            throw new Error(
                "Cannot both pass a comparison result and request a new comparison be run.",
            );
        }

        this.state.sourceEndpointInfo = source;
        this.state.targetEndpointInfo = target;
        this.updateState();
    }

    private isTreeNodeInfoType(node: any): boolean {
        if (node instanceof TreeNodeInfo) {
            return true;
        }

        return false;
    }

    private getFullSqlProjectsPathFromNode(node: any): string {
        return node.treeDataProvider?.roots[0]?.projectFileUri?.fsPath ?? "";
    }

    private registerRpcHandlers(): void {
        this.registerReducer("schemaCompare", async (state, payload) => {
            const result = await compare(
                state,
                payload,
                this.schemaCompareService,
            );

            return { ...state, schemaCompareResult: result };
        });

        this.registerReducer(
            "schemaCompareGenerateScript",
            async (state, payload) => {
                const result = await generateScript(
                    state,
                    payload,
                    this.schemaCompareService,
                );

                return { ...state, generateScriptResultStatus: result };
            },
        );

        this.registerReducer(
            "schemaComparePublishDatabaseChanges",
            async (state, payload) => {
                const result = await publishDatabaseChanges(
                    state,
                    payload,
                    this.schemaCompareService,
                );

                return { ...state, publishDatabaseChangesResultStatus: result };
            },
        );

        this.registerReducer(
            "schemaComparePublishProjectChanges",
            async (state, payload) => {
                const result = await publishProjectChanges(
                    state,
                    payload,
                    this.schemaCompareService,
                );

                return { ...state, schemaComparePublishProjectResult: result };
            },
        );

        this.registerReducer(
            "schemaCompareIncludeExcludeNode",
            async (state, payload) => {
                const result = await includeExcludeNode(
                    state,
                    payload,
                    this.schemaCompareService,
                );

                return { ...state, schemaCompareIncludeExcludeResult: result };
            },
        );

        this.registerReducer(
            "schemaCompareOpenScmp",
            async (state, payload) => {
                const result = await openScmp(
                    state,
                    payload,
                    this.schemaCompareService,
                );

                return { ...state, schemaCompareOpenScmpResult: result };
            },
        );

        this.registerReducer(
            "schemaCompareSaveScmp",
            async (state, payload) => {
                const result = await saveScmp(
                    state,
                    payload,
                    this.schemaCompareService,
                );

                return { ...state, saveScmpResultStatus: result };
            },
        );

        this.registerReducer("schemaCompareCancel", async (state, payload) => {
            const result = await cancel(
                state,
                payload,
                this.schemaCompareService,
            );

            return { ...state, cancelResultStatus: result };
        });
    }
}
