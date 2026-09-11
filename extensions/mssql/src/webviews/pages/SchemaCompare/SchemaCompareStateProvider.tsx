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
import { applyDifferenceDetails, applyInclusionUpdates } from "./schemaCompareDifferencesUtils";

const schemaCompareContext = createContext<sc.SchemaCompareContextProps>(
    {} as sc.SchemaCompareContextProps,
);

/** Gap between background detail requests so they don't starve checkbox and navigation calls. */
const DETAIL_PREFETCH_DELAY_MS = 50;

interface SchemaCompareStateProviderProps {
    children: React.ReactNode;
}

/**
 * Owns the difference list shown by the Schema Compare page. The extension host keeps the full
 * result and only syncs a summary; this provider fetches the list once per comparison, applies
 * checkbox changes optimistically, and drops any response that belongs to an older comparison.
 */
const SchemaCompareStateProvider: React.FC<SchemaCompareStateProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview<
        sc.SchemaCompareWebViewState,
        sc.SchemaCompareReducers
    >();
    const comparisonId = useSchemaCompareSelector(
        (state) => state.schemaCompareResult?.comparisonId,
    );
    const comparisonIdRef = useRef<number | undefined>(undefined);
    const [differences, setDifferences] = useState<mssql.DiffEntry[]>([]);
    const [isDifferencesLoading, setIsDifferencesLoading] = useState(false);
    const pendingSelectionsRef = useRef(new Set<number>());
    const isIncludeExcludeAllInProgressRef = useRef(false);
    const [pendingDifferenceIds, setPendingDifferenceIds] = useState<ReadonlySet<number>>(
        new Set(),
    );
    const [isIncludeExcludeAllInProgress, setIsIncludeExcludeAllInProgress] = useState(false);
    const [isScriptGenerationInProgress, setIsScriptGenerationInProgress] = useState(false);
    const loadingDifferenceDetailIdsRef = useRef(new Set<number>());
    const [loadingDifferenceDetailIds, setLoadingDifferenceDetailIds] = useState<
        ReadonlySet<number>
    >(new Set());

    const isCurrentComparison = useCallback(
        (id: number | undefined) => id !== undefined && id === comparisonIdRef.current,
        [],
    );

    const patchDifferences = useCallback((updates: readonly sc.SchemaCompareDifferenceUpdate[]) => {
        setDifferences((current) => applyInclusionUpdates(current, updates));
    }, []);

    useEffect(() => {
        comparisonIdRef.current = comparisonId;
        pendingSelectionsRef.current.clear();
        isIncludeExcludeAllInProgressRef.current = false;
        loadingDifferenceDetailIdsRef.current.clear();
        setPendingDifferenceIds(new Set());
        setIsIncludeExcludeAllInProgress(false);
        setLoadingDifferenceDetailIds(new Set());
        setDifferences([]);

        if (comparisonId === undefined) {
            setIsDifferencesLoading(false);
            return;
        }

        // Runs on mount as well, so a restored webview reloads the list from the host.
        setIsDifferencesLoading(true);
        void (async () => {
            try {
                const response = await extensionRpc.sendRequest(
                    sc.SchemaCompareGetDifferencesRequest.type,
                    { comparisonId },
                );
                if (response.success && isCurrentComparison(response.comparisonId)) {
                    setDifferences(response.differences);
                }
            } catch {
                // The extension host owns user-facing error notifications for this request.
            } finally {
                if (isCurrentComparison(comparisonId)) {
                    setIsDifferencesLoading(false);
                }
            }
        })();
    }, [comparisonId, extensionRpc, isCurrentComparison]);

    const includeExcludeNode = useCallback(
        async (id: number, diffEntry: mssql.DiffEntry, includeRequest: boolean): Promise<void> => {
            const requestComparisonId = comparisonIdRef.current;
            if (
                requestComparisonId === undefined ||
                isIncludeExcludeAllInProgressRef.current ||
                pendingSelectionsRef.current.has(id)
            ) {
                return;
            }

            const previousIncluded = diffEntry.included;
            pendingSelectionsRef.current.add(id);
            setPendingDifferenceIds(new Set(pendingSelectionsRef.current));
            patchDifferences([{ id, included: includeRequest }]);

            let confirmed = false;
            try {
                const response = await extensionRpc.sendRequest(
                    sc.SchemaCompareIncludeExcludeNodeRequest.type,
                    { comparisonId: requestComparisonId, id, diffEntry, includeRequest },
                );

                if (isCurrentComparison(requestComparisonId) && response.success) {
                    patchDifferences(response.updates);
                    confirmed = true;
                }
            } catch {
                // The extension host owns user-facing error notifications for this request.
            } finally {
                if (isCurrentComparison(requestComparisonId)) {
                    if (!confirmed) {
                        patchDifferences([{ id, included: previousIncluded }]);
                    }
                    pendingSelectionsRef.current.delete(id);
                    setPendingDifferenceIds(new Set(pendingSelectionsRef.current));
                }
            }
        },
        [extensionRpc, isCurrentComparison, patchDifferences],
    );

    const includeExcludeAllNodes = useCallback(
        async (includeRequest: boolean): Promise<void> => {
            const requestComparisonId = comparisonIdRef.current;
            if (
                requestComparisonId === undefined ||
                isIncludeExcludeAllInProgressRef.current ||
                pendingSelectionsRef.current.size > 0
            ) {
                return;
            }

            isIncludeExcludeAllInProgressRef.current = true;
            setIsIncludeExcludeAllInProgress(true);
            let previousSelections: sc.SchemaCompareDifferenceUpdate[] = [];
            setDifferences((current) => {
                previousSelections = current.map((difference, id) => ({
                    id,
                    included: difference.included,
                }));
                return applyInclusionUpdates(
                    current,
                    current.map((_difference, id) => ({ id, included: includeRequest })),
                );
            });

            let confirmed = false;
            try {
                const response = await extensionRpc.sendRequest(
                    sc.SchemaCompareIncludeExcludeAllRequest.type,
                    { comparisonId: requestComparisonId, includeRequest },
                );
                if (isCurrentComparison(requestComparisonId) && response.success) {
                    patchDifferences(response.updates);
                    confirmed = true;
                }
            } catch {
                // The extension host owns user-facing error notifications for this request.
            } finally {
                if (isCurrentComparison(requestComparisonId)) {
                    if (!confirmed) {
                        patchDifferences(previousSelections);
                    }
                    isIncludeExcludeAllInProgressRef.current = false;
                    setIsIncludeExcludeAllInProgress(false);
                }
            }
        },
        [extensionRpc, isCurrentComparison, patchDifferences],
    );

    const differencesRef = useRef(differences);
    differencesRef.current = differences;

    const loadDifferenceDetails = useCallback(
        async (id: number): Promise<void> => {
            const requestComparisonId = comparisonIdRef.current;
            const current = differencesRef.current[id];
            if (
                requestComparisonId === undefined ||
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
                    { comparisonId: requestComparisonId, id },
                );
                if (
                    isCurrentComparison(requestComparisonId) &&
                    response.success &&
                    response.difference
                ) {
                    const details = response.difference;
                    setDifferences((latest) => applyDifferenceDetails(latest, id, details));
                }
            } catch {
                // Detail loading is best-effort. Selecting the row again retries it.
            } finally {
                if (isCurrentComparison(requestComparisonId)) {
                    loadingDifferenceDetailIdsRef.current.delete(id);
                    setLoadingDifferenceDetailIds(new Set(loadingDifferenceDetailIdsRef.current));
                }
            }
        },
        [extensionRpc, isCurrentComparison],
    );

    // Once the list is in, walk it in the background so most scripts are ready before the user
    // gets to them. Rows already loaded (for example because the user selected them) are skipped,
    // and a new comparison cancels the walk.
    const differenceCount = differences.length;
    useEffect(() => {
        if (comparisonId === undefined || isDifferencesLoading || differenceCount === 0) {
            return;
        }

        let canceled = false;
        void (async () => {
            for (let id = 0; id < differenceCount && !canceled; id++) {
                if (differencesRef.current[id]?.hasDetails !== false) {
                    continue;
                }
                await loadDifferenceDetails(id);
                await new Promise((resolve) => setTimeout(resolve, DETAIL_PREFETCH_DELAY_MS));
            }
        })();

        return () => {
            canceled = true;
        };
    }, [comparisonId, differenceCount, isDifferencesLoading, loadDifferenceDetails]);

    const generateScript = useCallback(
        async (
            targetServerName: string,
            targetDatabaseName: string,
        ): Promise<sc.SchemaCompareGenerateScriptResponse> => {
            const requestComparisonId = comparisonIdRef.current;
            if (requestComparisonId === undefined) {
                return { success: false };
            }

            setIsScriptGenerationInProgress(true);
            try {
                return await extensionRpc.sendRequest(sc.SchemaCompareGenerateScriptRequest.type, {
                    comparisonId: requestComparisonId,
                    targetServerName,
                    targetDatabaseName,
                });
            } finally {
                setIsScriptGenerationInProgress(false);
            }
        },
        [extensionRpc],
    );

    const isOperationInProgress =
        isDifferencesLoading ||
        isIncludeExcludeAllInProgress ||
        isScriptGenerationInProgress ||
        pendingDifferenceIds.size > 0;

    const commands = useMemo<sc.SchemaCompareContextProps>(
        () => ({
            ...getCoreRPCs(extensionRpc),
            differences,
            isDifferencesLoading,
            loadingDifferenceDetailIds,
            pendingDifferenceIds,
            isIncludeExcludeAllInProgress,
            isScriptGenerationInProgress,
            isOperationInProgress,
            setLayout: function (layout: sc.SchemaCompareLayout): void {
                extensionRpc.action("setLayout", { layout });
            },
            setGroupBy: function (groupBy: sc.SchemaCompareGroupBy): void {
                extensionRpc.action("setGroupBy", { groupBy });
            },
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
            generateScript,
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
            generateScript,
            includeExcludeAllNodes,
            includeExcludeNode,
            isDifferencesLoading,
            isIncludeExcludeAllInProgress,
            isOperationInProgress,
            isScriptGenerationInProgress,
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
