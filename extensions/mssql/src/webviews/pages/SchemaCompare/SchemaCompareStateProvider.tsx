/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sc from "../../../sharedInterfaces/schemaCompare";
import * as mssql from "vscode-mssql";

import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";
import { useSchemaCompareSelector } from "./schemaCompareSelector";

const schemaCompareContext = createContext<sc.SchemaCompareContextProps>(
    {} as sc.SchemaCompareContextProps,
);

interface SchemaCompareStateProviderProps {
    children: React.ReactNode;
}

const SchemaCompareStateProvider: React.FC<SchemaCompareStateProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview<
        sc.SchemaCompareWebViewState,
        sc.SchemaCompareReducers
    >();
    const schemaCompareResult = useSchemaCompareSelector((state) => state.schemaCompareResult);
    const [differences, setDifferences] = useState<mssql.DiffEntry[]>(
        schemaCompareResult?.differences ?? [],
    );
    const confirmedDifferencesRef = useRef(differences);
    const pendingSelectionsRef = useRef(new Map<number, boolean>());
    const isIncludeExcludeAllInProgressRef = useRef(false);
    const [pendingDifferenceIds, setPendingDifferenceIds] = useState<ReadonlySet<number>>(
        new Set(),
    );
    const [isIncludeExcludeAllInProgress, setIsIncludeExcludeAllInProgress] = useState(false);
    const loadingDifferenceDetailIdsRef = useRef(new Set<number>());
    const [loadingDifferenceDetailIds, setLoadingDifferenceDetailIds] = useState<
        ReadonlySet<number>
    >(new Set());

    const updateDifferences = useCallback(
        (updater: (current: mssql.DiffEntry[]) => mssql.DiffEntry[]) => {
            setDifferences((current) => {
                const updated = updater(current);
                return updated;
            });
        },
        [],
    );

    const renderConfirmedDifferences = useCallback(() => {
        const updated = confirmedDifferencesRef.current.map((difference, index) => {
            const pendingSelection = pendingSelectionsRef.current.get(index);
            return pendingSelection === undefined
                ? difference
                : { ...difference, included: pendingSelection };
        });
        setDifferences(updated);
    }, []);

    useEffect(() => {
        if (pendingSelectionsRef.current.size > 0 || isIncludeExcludeAllInProgressRef.current) {
            return;
        }
        const updated = schemaCompareResult?.differences ?? [];
        confirmedDifferencesRef.current = updated;
        setDifferences(updated);
    }, [schemaCompareResult]);

    const includeExcludeNode = useCallback(
        async (id: number, diffEntry: mssql.DiffEntry, includeRequest: boolean): Promise<void> => {
            if (isIncludeExcludeAllInProgressRef.current || pendingSelectionsRef.current.has(id)) {
                return;
            }

            pendingSelectionsRef.current.set(id, includeRequest);
            setPendingDifferenceIds(new Set(pendingSelectionsRef.current.keys()));
            renderConfirmedDifferences();

            try {
                const response = await extensionRpc.sendRequest(
                    sc.SchemaCompareIncludeExcludeNodeRequest.type,
                    { id, diffEntry, includeRequest },
                );

                if (response.success) {
                    const updates = new Map(
                        response.updates.map((update) => [update.id, update.included]),
                    );
                    confirmedDifferencesRef.current = confirmedDifferencesRef.current.map(
                        (difference, index) => {
                            const included = updates.get(index);
                            return included === undefined
                                ? difference
                                : { ...difference, included };
                        },
                    );
                    renderConfirmedDifferences();
                }
            } catch {
                // The extension host owns user-facing error notifications for this request.
            } finally {
                pendingSelectionsRef.current.delete(id);
                setPendingDifferenceIds(new Set(pendingSelectionsRef.current.keys()));
                renderConfirmedDifferences();
            }
        },
        [extensionRpc, renderConfirmedDifferences],
    );

    const includeExcludeAllNodes = useCallback(
        async (includeRequest: boolean): Promise<void> => {
            if (isIncludeExcludeAllInProgressRef.current || pendingSelectionsRef.current.size > 0) {
                return;
            }

            isIncludeExcludeAllInProgressRef.current = true;
            setIsIncludeExcludeAllInProgress(true);
            updateDifferences((current) =>
                current.map((difference) => ({ ...difference, included: includeRequest })),
            );

            try {
                const response = await extensionRpc.sendRequest(
                    sc.SchemaCompareIncludeExcludeAllRequest.type,
                    { includeRequest },
                );
                if (response.success) {
                    const includedById = new Map(
                        response.updates.map((update) => [update.id, update.included]),
                    );
                    confirmedDifferencesRef.current = confirmedDifferencesRef.current.map(
                        (difference, id) => {
                            const included = includedById.get(id);
                            return included === undefined
                                ? difference
                                : { ...difference, included };
                        },
                    );
                    setDifferences(confirmedDifferencesRef.current);
                } else {
                    renderConfirmedDifferences();
                }
            } catch {
                renderConfirmedDifferences();
            } finally {
                isIncludeExcludeAllInProgressRef.current = false;
                setIsIncludeExcludeAllInProgress(false);
            }
        },
        [extensionRpc, renderConfirmedDifferences, updateDifferences],
    );

    const loadDifferenceDetails = useCallback(
        async (id: number): Promise<void> => {
            const current = confirmedDifferencesRef.current[id];
            if (
                !current ||
                current.hasDetails !== false ||
                loadingDifferenceDetailIdsRef.current.has(id)
            ) {
                return;
            }

            loadingDifferenceDetailIdsRef.current.add(id);
            setLoadingDifferenceDetailIds(new Set(loadingDifferenceDetailIdsRef.current));
            try {
                const response = await extensionRpc.sendRequest(
                    sc.SchemaCompareGetDifferenceDetailsRequest.type,
                    { id },
                );
                if (response.success && response.difference) {
                    const existing = confirmedDifferencesRef.current[id];
                    if (existing) {
                        confirmedDifferencesRef.current = confirmedDifferencesRef.current.map(
                            (difference, index) =>
                                index === id
                                    ? { ...response.difference!, included: existing.included }
                                    : difference,
                        );
                        renderConfirmedDifferences();
                    }
                }
            } finally {
                loadingDifferenceDetailIdsRef.current.delete(id);
                setLoadingDifferenceDetailIds(new Set(loadingDifferenceDetailIdsRef.current));
            }
        },
        [extensionRpc, renderConfirmedDifferences],
    );

    const commands = useMemo<sc.SchemaCompareContextProps>(
        () => ({
            ...getCoreRPCs(extensionRpc),
            differences,
            loadingDifferenceDetailIds,
            pendingDifferenceIds,
            isIncludeExcludeAllInProgress,
            isSqlProjectExtensionInstalled: function (): void {
                extensionRpc.action("isSqlProjectExtensionInstalled", {});
            },
            listActiveServers: function (): void {
                extensionRpc.action("listActiveServers", {});
            },
            listDatabasesForActiveServer: function (
                connectionUri: string,
                connectionDatabaseName?: string,
            ): void {
                extensionRpc.action("listDatabasesForActiveServer", {
                    connectionUri: connectionUri,
                    connectionDatabaseName: connectionDatabaseName,
                });
            },
            selectFile: function (
                endpoint: mssql.SchemaCompareEndpointInfo,
                endpointType: "source" | "target",
                fileType: "dacpac" | "sqlproj",
            ): void {
                extensionRpc.action("selectFile", {
                    endpoint: endpoint,
                    endpointType: endpointType,
                    fileType: fileType,
                });
            },
            confirmSelectedSchema: function (
                endpointType: "source" | "target",
                folderStructure: string,
            ): void {
                extensionRpc.action("confirmSelectedSchema", {
                    endpointType: endpointType,
                    folderStructure: folderStructure,
                });
            },
            confirmSelectedDatabase: function (
                endpointType: "source" | "target",
                serverConnectionUri: string,
                databaseName: string,
            ): void {
                extensionRpc.action("confirmSelectedDatabase", {
                    endpointType: endpointType,
                    serverConnectionUri: serverConnectionUri,
                    databaseName: databaseName,
                });
            },
            setIntermediarySchemaOptions: function (): void {
                extensionRpc.action("setIntermediarySchemaOptions", {});
            },
            intermediaryGeneralOptionsChanged(key: string): void {
                extensionRpc.action("intermediaryGeneralOptionsChanged", {
                    key: key,
                });
            },
            intermediaryGeneralOptionsBulkChanged(keys: string[], checked: boolean): void {
                extensionRpc.action("intermediaryGeneralOptionsBulkChanged", {
                    keys: keys,
                    checked: checked,
                });
            },
            intermediaryIncludeObjectTypesOptionsChanged(key: string): void {
                extensionRpc.action("intermediaryIncludeObjectTypesOptionsChanged", { key: key });
            },
            intermediaryIncludeObjectTypesBulkChanged(keys: string[], checked: boolean): void {
                extensionRpc.action("intermediaryIncludeObjectTypesBulkChanged", {
                    keys: keys,
                    checked: checked,
                });
            },
            confirmSchemaOptions: function (optionsChanged: boolean): void {
                extensionRpc.action("confirmSchemaOptions", {
                    optionsChanged: optionsChanged,
                });
            },
            switchEndpoints: function (
                newSourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
                newTargetEndpointInfo: mssql.SchemaCompareEndpointInfo,
            ): void {
                extensionRpc.action("switchEndpoints", {
                    newSourceEndpointInfo: newSourceEndpointInfo,
                    newTargetEndpointInfo: newTargetEndpointInfo,
                });
            },
            resetEndpointsSwitched: function (): void {
                extensionRpc.action("resetEndpointsSwitched", {});
            },
            compare: function (
                sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
                targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
                deploymentOptions: mssql.DeploymentOptions,
            ): void {
                extensionRpc.action("compare", {
                    sourceEndpointInfo: sourceEndpointInfo,
                    targetEndpointInfo: targetEndpointInfo,
                    deploymentOptions: deploymentOptions,
                });
            },
            generateScript: function (targetServerName: string, targetDatabaseName: string): void {
                extensionRpc.action("generateScript", {
                    targetServerName: targetServerName,
                    targetDatabaseName: targetDatabaseName,
                });
            },
            publishChanges: function (targetServerName: string, targetDatabaseName: string) {
                extensionRpc.action("publishChanges", {
                    targetServerName: targetServerName,
                    targetDatabaseName: targetDatabaseName,
                });
            },
            publishDatabaseChanges: function (
                targetServerName: string,
                targetDatabaseName: string,
            ): void {
                extensionRpc.action("publishDatabaseChanges", {
                    targetServerName: targetServerName,
                    targetDatabaseName: targetDatabaseName,
                });
            },
            publishProjectChanges: function (
                targetProjectPath: string,
                targetFolderStructure: sc.ExtractTarget,
                taskExecutionMode: sc.TaskExecutionMode,
            ): void {
                extensionRpc.action("publishProjectChanges", {
                    targetProjectPath: targetProjectPath,
                    targetFolderStructure: targetFolderStructure,
                    taskExecutionMode: taskExecutionMode,
                });
            },
            resetOptions: function (): void {
                extensionRpc.action("resetOptions", {});
            },
            includeExcludeNode,
            includeExcludeAllNodes,
            loadDifferenceDetails,
            openScmp: function (): void {
                extensionRpc.action("openScmp", {});
            },
            saveScmp: function (): void {
                extensionRpc.action("saveScmp", {});
            },
            cancel: function (): void {
                extensionRpc.action("cancel", {});
            },
        }),
        [
            differences,
            extensionRpc,
            includeExcludeAllNodes,
            includeExcludeNode,
            isIncludeExcludeAllInProgress,
            pendingDifferenceIds,
            loadDifferenceDetails,
            loadingDifferenceDetailIds,
        ],
    );

    return (
        <schemaCompareContext.Provider value={commands}>{children}</schemaCompareContext.Provider>
    );
};

export { schemaCompareContext, SchemaCompareStateProvider };
