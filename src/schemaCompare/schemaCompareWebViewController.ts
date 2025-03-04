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
    generateOperationId,
    getDefaultOptions,
    includeExcludeNode,
    openScmp,
    publishDatabaseChanges,
    publishProjectChanges,
    saveScmp,
    openFileDialog,
} from "./schemaCompareUtils";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { TaskExecutionMode, DiffEntry } from "vscode-mssql";

export class SchemaCompareWebViewController extends ReactWebviewPanelController<
    SchemaCompareWebViewState,
    SchemaCompareReducers
> {
    private operationId: string;
    // private sourceTargetSwitched: boolean = false;
    // private originalSourceExcludes = new Map<string, mssql.DiffEntry>();
    // private originalTargetExcludes = new Map<string, mssql.DiffEntry>();
    // private scmpSourceExcludes: mssql.SchemaCompareObjectId[];
    // private scmpTargetExcludes: mssql.SchemaCompareObjectId[];

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        node: any,
        private readonly schemaCompareService: mssql.ISchemaCompareService,
        private readonly connectionMgr: ConnectionManager,
        schemaCompareOptionsResult: mssql.SchemaCompareOptionsResult,
        title: string,
    ) {
        super(
            context,
            vscodeWrapper,
            "schemaCompare",
            "schemaCompare",
            {
                defaultDeploymentOptionsResult: schemaCompareOptionsResult,
                auxiliaryEndpointInfo: undefined,
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

        this.operationId = generateOperationId();

        if (node && !this.isTreeNodeInfoType(node)) {
            node = this.getFullSqlProjectsPathFromNode(node);
        }

        void this.start(node);
        this.registerRpcHandlers();
    }

    /**
     * Starts the schema comparison process. Schema compare can get started with four contexts for the source:
     * 1. undefined
     * 2. Connection profile
     * 3. Dacpac
     * 4. Project
     * @param sourceContext can be undefined, connection profile, dacpac, or project.
     * @param comparisonResult Result of a previous comparison, if available.
     */
    public async start(
        sourceContext: any,
        comparisonResult: mssql.SchemaCompareResult = undefined,
    ): Promise<void> {
        let source: mssql.SchemaCompareEndpointInfo;

        let connectionProfile: IConnectionProfile | undefined = sourceContext
            ? (sourceContext.connectionInfo as IConnectionProfile)
            : undefined;

        if (connectionProfile) {
            source = await this.getEndpointInfoFromConnectionProfile(
                connectionProfile,
                sourceContext,
            );
        } else if (
            sourceContext &&
            (sourceContext as string) &&
            (sourceContext as string).endsWith(".dacpac")
        ) {
            source = this.getEndpointInfoFromDacpac(sourceContext as string);
        } else if (sourceContext) {
            source = this.getEndpointInfoFromProject(sourceContext as string);
        }

        await this.launch(source, undefined, false, comparisonResult);
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

    private async getEndpointInfoFromConnectionProfile(
        connectionProfile: IConnectionProfile,
        sourceContext: any,
    ): Promise<mssql.SchemaCompareEndpointInfo> {
        let ownerUri =
            await this.connectionMgr.getUriForConnection(connectionProfile);
        let user = connectionProfile.user;
        if (!user) {
            user = "default";
        }

        const source = {
            endpointType: mssql.SchemaCompareEndpointType.Database,
            serverDisplayName: `${connectionProfile.server} (${user})`,
            serverName: connectionProfile.server,
            databaseName: ObjectExplorerUtils.getDatabaseName(sourceContext),
            ownerUri: ownerUri,
            packageFilePath: "",
            connectionDetails: undefined,
            connectionName: connectionProfile.profileName
                ? connectionProfile.profileName
                : "",
            projectFilePath: "",
            targetScripts: [],
            dataSchemaProvider: "",
            extractTarget: mssql.ExtractTarget.schemaObjectType,
        };

        return source;
    }

    private getEndpointInfoFromDacpac(
        sourceDacpac: string,
    ): mssql.SchemaCompareEndpointInfo {
        const source = {
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

        return source;
    }

    private getEndpointInfoFromProject(
        sourceProject: string,
    ): mssql.SchemaCompareEndpointInfo {
        const source = {
            endpointType: mssql.SchemaCompareEndpointType.Project,
            projectFilePath: sourceProject,
            extractTarget: mssql.ExtractTarget.schemaObjectType,
            targetScripts: [],
            dataSchemaProvider: "",
            serverDisplayName: "",
            serverName: "",
            databaseName: "",
            ownerUri: "",
            packageFilePath: "",
            connectionDetails: undefined,
        };

        return source;
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
        this.registerReducer("selectFile", async (state, payload) => {
            const filePath = await openFileDialog(payload);
            const updatedEndpointInfo =
                payload.fileType === "dacpac"
                    ? this.getEndpointInfoFromDacpac(filePath)
                    : this.getEndpointInfoFromProject(filePath);

            if (filePath) {
                state.auxiliaryEndpointInfo = updatedEndpointInfo;

                // if (payload.fileType === "dacpac") {
                //     if (payload.endpointType === "source") {
                //         state.sourceEndpointInfo = updatedEndpointInfo;
                //     } else {
                //         state.targetEndpointInfo = updatedEndpointInfo;
                //     }
                // }
                // else
                if (payload.fileType === "sqlproj") {
                    if (payload.endpointType === "source") {
                        // state.sourceEndpointInfo = updatedEndpointInfo;
                        // state.sourceEndpointInfo.dataSchemaProvider = "160";
                        state.auxiliaryEndpointInfo.targetScripts = [
                            "c:\\DatabaseProjects\\SimpleProj\\Address.sql",
                        ];
                    } else {
                        // state.targetEndpointInfo = updatedEndpointInfo;
                        // state.targetEndpointInfo.dataSchemaProvider = "160";
                        state.auxiliaryEndpointInfo.targetScripts = [
                            "c:\\DatabaseProjects\\SimpleProj2\\Address.sql",
                            "c:\\DatabaseProjects\\SimpleProj2\\Person.sql",
                        ];
                    }
                }

                this.updateState(state);
            }

            return state;
        });

        this.registerReducer(
            "confirmSelectedSchema",
            async (state, payload) => {
                if (payload.endpointType === "source") {
                    state.sourceEndpointInfo = state.auxiliaryEndpointInfo;
                } else {
                    state.targetEndpointInfo = state.auxiliaryEndpointInfo;
                }
                state.auxiliaryEndpointInfo = undefined;

                this.updateState(state);

                return state;
            },
        );

        this.registerReducer("compare", async (state, payload) => {
            // telemetry - schema comparison started

            const result = await compare(
                this.operationId,
                TaskExecutionMode.execute,
                payload,
                this.schemaCompareService,
            );

            if (!result || !result.success) {
                // telemetry - schema comparison failed
                // log errors and show error message
            }

            // telemetry - schema comparison finished

            const finalDifferences = this.getAllObjectTypeDifferences(result);
            result.differences = finalDifferences;
            state.schemaCompareResult = result;
            this.updateState(state);

            return state;
        });

        this.registerReducer("generateScript", async (state, payload) => {
            const result = await generateScript(
                this.operationId,
                payload,
                this.schemaCompareService,
            );

            state.generateScriptResultStatus = result;
            return state;
        });

        this.registerReducer(
            "publishDatabaseChanges",
            async (state, payload) => {
                const result = await publishDatabaseChanges(
                    this.operationId,
                    payload,
                    this.schemaCompareService,
                );

                state.publishDatabaseChangesResultStatus = result;
                return state;
            },
        );

        this.registerReducer(
            "publishProjectChanges",
            async (state, payload) => {
                const result = await publishProjectChanges(
                    this.operationId,
                    payload,
                    this.schemaCompareService,
                );

                state.schemaComparePublishProjectResult = result;
                return state;
            },
        );

        this.registerReducer("getDefaultOptions", async (state) => {
            const result = await getDefaultOptions(this.schemaCompareService);

            state.defaultDeploymentOptionsResult = result;
            return state;
        });

        this.registerReducer("includeExcludeNode", async (state, payload) => {
            const result = await includeExcludeNode(
                this.operationId,
                payload,
                this.schemaCompareService,
            );

            state.schemaCompareIncludeExcludeResult = result;
            return state;
        });

        this.registerReducer("openScmp", async (state, payload) => {
            const result = await openScmp(payload, this.schemaCompareService);

            state.schemaCompareOpenScmpResult = result;
            return state;
        });

        this.registerReducer("saveScmp", async (state, payload) => {
            const result = await saveScmp(payload, this.schemaCompareService);

            state.saveScmpResultStatus = result;
            return state;
        });

        this.registerReducer("cancel", async (state) => {
            const result = await cancel(
                this.operationId,
                this.schemaCompareService,
            );

            state.cancelResultStatus = result;
            return state;
        });
    }

    private getAllObjectTypeDifferences(
        result: mssql.SchemaCompareResult,
    ): DiffEntry[] {
        // let data = [];
        let finalDifferences: DiffEntry[] = [];
        let differences = result.differences;
        if (differences) {
            differences.forEach((difference) => {
                if (
                    difference.differenceType ===
                    mssql.SchemaDifferenceType.Object
                ) {
                    if (
                        (difference.sourceValue !== null &&
                            difference.sourceValue.length > 0) ||
                        (difference.targetValue !== null &&
                            difference.targetValue.length > 0)
                    ) {
                        finalDifferences.push(difference); // Add only non-null changes to ensure index does not mismatch between dictionay and UI - #6234
                        // let include: boolean = true;
                        // data.push([
                        //     difference.name,
                        //     this.createName(difference.sourceValue),
                        //     include,
                        //     updateAction,
                        //     this.createName(difference.targetValue),
                        // ]);
                    }
                }
            });
        }

        return finalDifferences;

        // result.differences = finalDifferences;
        // return data;
    }

    // private shouldDiffBeIncluded(diff: mssql.DiffEntry): boolean {
    //     let key =
    //         diff.sourceValue && diff.sourceValue.length > 0
    //             ? this.createName(diff.sourceValue)
    //             : this.createName(diff.targetValue);
    //     if (key) {
    //         if (
    //             this.sourceTargetSwitched === true &&
    //             (this.originalTargetExcludes.has(key) ||
    //                 this.hasExcludeEntry(this.scmpTargetExcludes, key))
    //         ) {
    //             this.originalTargetExcludes.set(key, diff);
    //             return false;
    //         }
    //         if (
    //             this.sourceTargetSwitched === false &&
    //             (this.originalSourceExcludes.has(key) ||
    //                 this.hasExcludeEntry(this.scmpSourceExcludes, key))
    //         ) {
    //             this.originalSourceExcludes.set(key, diff);
    //             return false;
    //         }
    //         return true;
    //     }
    //     return true;
    // }

    // private createName(nameParts: string[]): string {
    //     if (!nameParts || nameParts.length === 0) {
    //         return "";
    //     }
    //     return nameParts.join(".");
    // }

    // private hasExcludeEntry(
    //     collection: mssql.SchemaCompareObjectId[],
    //     entryName: string,
    // ): boolean {
    //     let found = false;
    //     if (collection) {
    //         const index = collection.findIndex(
    //             (e) => this.createName(e.nameParts) === entryName,
    //         );
    //         found = index !== -1;
    //     }
    //     return found;
    // }
}
