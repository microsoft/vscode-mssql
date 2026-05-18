/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Dab } from "../../../../sharedInterfaces/dab";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { DabSessionRpc } from "../../../../dab/dabSessionRpc";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";

interface DabContextProps {
    isInitialized: boolean;
    isDabDeploymentSupported: boolean;
    copyToClipboard: (text: string, copyTextType: Dab.CopyTextType) => void;
    openUrl: (url: string, apiType?: Dab.ApiType) => void;
    openLogsInNewTab: (logsContent: string) => void;
    dabConfig: Dab.DabConfig | null;
    dabCommandError: string | undefined;
    clearDabCommandError: () => void;
    initializeDabConfig: () => void;
    syncDabConfigWithSchema: () => void;
    updateDabApiTypes: (apiTypes: Dab.ApiType[]) => void;
    toggleDabEntity: (entityId: string, isEnabled: boolean) => void;
    toggleDabEntities: (entityIds: string[], isEnabled: boolean) => void;
    toggleDabEntityAction: (entityId: string, action: Dab.EntityAction, isEnabled: boolean) => void;
    toggleDabEntityActions: (
        entityIds: string[],
        action: Dab.EntityAction,
        isEnabled: boolean,
    ) => void;
    toggleDabColumnExposure: (entityId: string, columnId: string, isExposed: boolean) => void;
    updateDabEntitySettings: (
        entityId: string,
        settings: Dab.EntityAdvancedSettings,
    ) => Promise<boolean>;
    dabTextFilter: string;
    setDabTextFilter: (text: string) => void;
    dabConfigTextFileContent: string;
    openDabConfigInEditor: (configContent: string) => void;
    addDabConfigToWorkspace: (configContent: string) => void;
    dabDeploymentState: Dab.DabDeploymentState;
    openDabDeploymentDialog: () => void;
    closeDabDeploymentDialog: () => void;
    setDabDeploymentDialogStep: (step: Dab.DabDeploymentDialogStep) => void;
    updateDabDeploymentParams: (params: Partial<Dab.DabDeploymentParams>) => void;
    validateDabDeploymentParams: (
        containerName: string,
        port: number,
    ) => Promise<Dab.ValidateDeploymentParamsResponse>;
    runDabDeploymentStep: (step: Dab.DabDeploymentStepOrder) => Promise<void>;
    resetDabDeploymentState: () => void;
    retryDabDeploymentSteps: () => Promise<void>;
    addDabMcpServer: (serverUrl: string) => Promise<Dab.AddMcpServerResponse>;
    currentFilteredTables: string[];
}

const DabContext = createContext<DabContextProps | undefined>(undefined);

interface DabProviderProps {
    children: React.ReactNode;
}

function cloneDabConfig(config: Dab.DabConfig): Dab.DabConfig {
    return {
        ...config,
        apiTypes: [...config.apiTypes],
        advancedJson: config.advancedJson ? { ...config.advancedJson } : undefined,
        entities: config.entities.map((entity) => ({
            ...entity,
            unsupportedReasons: entity.unsupportedReasons
                ? entity.unsupportedReasons.map((reason) => ({ ...reason }))
                : undefined,
            enabledActions: [...entity.enabledActions],
            columns: entity.columns.map((column) => ({ ...column })),
            parameters: entity.parameters?.map((parameter) => ({ ...parameter })),
            restMethods: entity.restMethods ? [...entity.restMethods] : undefined,
            advancedJson: entity.advancedJson ? { ...entity.advancedJson } : undefined,
            advancedSettings: { ...entity.advancedSettings },
        })),
    };
}

function resolveOptimisticEntityIndex(config: Dab.DabConfig, ref: Dab.DabEntityRef): number {
    if ("id" in ref) {
        return config.entities.findIndex((entity) => entity.id === ref.id);
    }
    return config.entities.findIndex(
        (entity) => entity.schemaName === ref.schemaName && entity.tableName === ref.tableName,
    );
}

function resolveOptimisticColumnIndex(entity: Dab.DabEntityConfig, ref: Dab.DabColumnRef): number {
    if ("id" in ref) {
        return entity.columns.findIndex((column) => column.id === ref.id);
    }
    return entity.columns.findIndex((column) => column.name === ref.name);
}

function applyOptimisticDabChanges(
    config: Dab.DabConfig,
    changes: Dab.DabToolChange[],
): Dab.DabConfig {
    const next = cloneDabConfig(config);
    const applyAdvancedJsonPatch = (
        current: Record<string, unknown> | undefined,
        patch: Record<string, unknown>,
    ): Record<string, unknown> | undefined => {
        const value = current ? { ...current } : {};
        for (const [key, entry] of Object.entries(patch)) {
            if (entry === null) {
                delete value[key];
            } else {
                value[key] = entry;
            }
        }
        return Object.keys(value).length > 0 ? value : undefined;
    };

    for (const change of changes) {
        switch (change.type) {
            case "set_api_types":
                next.apiTypes = [...change.apiTypes];
                break;
            case "set_entity_enabled": {
                const entityIndex = resolveOptimisticEntityIndex(next, change.entity);
                if (entityIndex >= 0) {
                    next.entities[entityIndex].isEnabled = change.isEnabled;
                }
                break;
            }
            case "set_entity_actions": {
                const entityIndex = resolveOptimisticEntityIndex(next, change.entity);
                if (entityIndex >= 0) {
                    next.entities[entityIndex].enabledActions = [...change.enabledActions];
                }
                break;
            }
            case "set_column_exposed": {
                const entityIndex = resolveOptimisticEntityIndex(next, change.entity);
                if (entityIndex >= 0) {
                    const columnIndex = resolveOptimisticColumnIndex(
                        next.entities[entityIndex],
                        change.column,
                    );
                    if (columnIndex >= 0) {
                        next.entities[entityIndex].columns[columnIndex].isExposed =
                            change.isExposed;
                    }
                }
                break;
            }
            case "patch_entity_settings": {
                const entityIndex = resolveOptimisticEntityIndex(next, change.entity);
                if (entityIndex >= 0) {
                    const settings = next.entities[entityIndex].advancedSettings;
                    next.entities[entityIndex].advancedSettings = {
                        ...settings,
                        ...change.set,
                        customRestPath:
                            change.set.customRestPath === undefined
                                ? settings.customRestPath
                                : (change.set.customRestPath ?? undefined),
                        customGraphQLType:
                            change.set.customGraphQLType === undefined
                                ? settings.customGraphQLType
                                : (change.set.customGraphQLType ?? undefined),
                    };
                }
                break;
            }
            case "patch_config_advanced_json":
                next.advancedJson = applyAdvancedJsonPatch(next.advancedJson, change.set);
                break;
            case "patch_entity_advanced_json": {
                const entityIndex = resolveOptimisticEntityIndex(next, change.entity);
                if (entityIndex >= 0) {
                    next.entities[entityIndex].advancedJson = applyAdvancedJsonPatch(
                        next.entities[entityIndex].advancedJson,
                        change.set,
                    );
                }
                break;
            }
            case "set_only_enabled_entities": {
                const enabledEntityIds = new Set(
                    change.entities.flatMap((entityRef) => {
                        const entityIndex = resolveOptimisticEntityIndex(next, entityRef);
                        return entityIndex >= 0 ? [next.entities[entityIndex].id] : [];
                    }),
                );
                next.entities = next.entities.map((entity) => ({
                    ...entity,
                    isEnabled: entity.isSupported && enabledEntityIds.has(entity.id),
                }));
                break;
            }
            case "set_all_entities_enabled":
                next.entities = next.entities.map((entity) => ({
                    ...entity,
                    isEnabled: entity.isSupported && change.isEnabled,
                }));
                break;
        }
    }

    return next;
}

export const DabProvider: React.FC<DabProviderProps> = ({ children }) => {
    const schemaDesignerContext = useContext(SchemaDesignerContext);
    const { extensionRpc, extractSchema, isInitialized } = schemaDesignerContext;
    const isDabDeploymentSupported =
        useSchemaDesignerSelector((s) => s?.isDabDeploymentSupported) ?? false;
    const currentFilteredTables = useSchemaDesignerSelector((s) => s?.currentFilteredTables) ?? [];

    const [dabConfig, setDabConfig] = useState<Dab.DabConfig | null>(null);
    const [dabVersion, setDabVersion] = useState<string>("");
    const [dabCommandError, setDabCommandError] = useState<string | undefined>(undefined);
    const [dabTextFilter, setDabTextFilter] = useState<string>("");
    const [dabConfigTextFileContent, setDabConfigTextFileContent] = useState<string>("");
    const [dabDeploymentState, setDabDeploymentState] = useState<Dab.DabDeploymentState>(
        Dab.createDefaultDeploymentState(),
    );

    const dabConfigRef = useRef<Dab.DabConfig | null>(null);
    const dabVersionRef = useRef<string>("");
    const dabCommandQueueRef = useRef<Promise<unknown>>(Promise.resolve());

    const setDabConfigState = useCallback((config: Dab.DabConfig | null) => {
        dabConfigRef.current = config;
        setDabConfig(config);
    }, []);

    const setDabVersionState = useCallback((version: string) => {
        dabVersionRef.current = version;
        setDabVersion(version);
    }, []);

    useEffect(() => {
        dabConfigRef.current = dabConfig;
    }, [dabConfig]);

    useEffect(() => {
        dabVersionRef.current = dabVersion;
    }, [dabVersion]);

    const applyDabState = useCallback(
        (response: Dab.GetDabToolStateResponse) => {
            dabVersionRef.current = response.version;
            setDabVersion(response.version);
            if (response.config) {
                setDabConfigState(response.config);
            }
        },
        [setDabConfigState],
    );

    useEffect(() => {
        extensionRpc.onNotification(DabSessionRpc.SnapshotChangedNotification.type, (snapshot) => {
            extensionRpc.log(
                `[StateCommands] feature=dab stage=receive_snapshot status=succeeded sessionId=${snapshot.sessionId} version=${snapshot.version} measurements={"entityCount":${snapshot.summary.entityCount},"enabledEntityCount":${snapshot.summary.enabledEntityCount}}`,
            );
            setDabVersionState(snapshot.version);
            if (snapshot.config) {
                setDabConfigState(snapshot.config);
            }
            setDabCommandError(undefined);
        });
    }, [extensionRpc, setDabConfigState, setDabVersionState]);

    useEffect(() => {
        extensionRpc.onNotification(DabSessionRpc.ApplyFailedNotification.type, (failure) => {
            extensionRpc.log(
                `[StateCommands] feature=dab source=${failure.source ?? "unknown"} stage=receive_apply_failure status=succeeded sessionId=${failure.sessionId} reason=${failure.reason} message=${failure.message}`,
                "error",
            );
            setDabCommandError(failure.message);
            if (failure.version) {
                setDabVersionState(failure.version);
            }
        });
    }, [extensionRpc, setDabVersionState]);

    const clearDabCommandError = useCallback(() => {
        setDabCommandError(undefined);
    }, []);

    const refreshDabState = useCallback(async () => {
        const schema = extractSchema();
        const schemaUpdate = await extensionRpc.sendRequest(
            DabSessionRpc.UpdateSchemaRequest.type,
            {
                schemaTables: schema.tables,
            },
        );
        setDabVersionState(schemaUpdate.snapshot.version);
        if (schemaUpdate.snapshot.config) {
            setDabConfigState(schemaUpdate.snapshot.config);
            return;
        }

        const response = await extensionRpc.sendRequest(Dab.GetDabToolStateRequest.type, undefined);
        applyDabState(response);
    }, [applyDabState, extensionRpc, extractSchema, setDabConfigState, setDabVersionState]);

    const dispatchDabChanges = useCallback(
        (createChanges: (config: Dab.DabConfig) => Dab.DabToolChange[]) => {
            const run = async (): Promise<boolean> => {
                if (!dabVersionRef.current || !dabConfigRef.current) {
                    await refreshDabState();
                }

                const currentConfig = dabConfigRef.current;
                const expectedVersion = dabVersionRef.current;
                if (!currentConfig || !expectedVersion) {
                    return false;
                }

                const changes = createChanges(currentConfig);
                if (changes.length === 0) {
                    return true;
                }

                setDabCommandError(undefined);
                setDabConfigState(applyOptimisticDabChanges(currentConfig, changes));

                const response = await extensionRpc.sendRequest(
                    Dab.ApplyDabToolChangesRequest.type,
                    {
                        expectedVersion,
                        changes,
                        options: { returnState: "full", source: "ux" },
                    },
                );

                if (response.success) {
                    setDabCommandError(undefined);
                    setDabVersionState(response.version);
                    if (response.config) {
                        setDabConfigState(response.config);
                    } else {
                        await refreshDabState();
                    }
                    return true;
                }

                if (response.reason === "stale_state" && response.config) {
                    setDabCommandError(response.message);
                    setDabVersionState(response.version ?? "");
                    setDabConfigState(response.config);
                    return false;
                }

                console.error("Failed to apply DAB change:", response.message);
                extensionRpc.log(
                    `[StateCommands] feature=dab source=ux stage=display_error status=shown reason=${response.reason} message=${response.message}`,
                    "error",
                );
                setDabCommandError(response.message);
                if (response.config) {
                    setDabConfigState(response.config);
                } else {
                    await refreshDabState();
                }
                return false;
            };

            const queued = dabCommandQueueRef.current.then(run, run);
            dabCommandQueueRef.current = queued.then(
                () => undefined,
                () => undefined,
            );
            return queued;
        },
        [extensionRpc, refreshDabState, setDabConfigState, setDabVersionState],
    );

    const dispatchDabChange = useCallback(
        (createChange: (config: Dab.DabConfig) => Dab.DabToolChange | undefined) =>
            dispatchDabChanges((config) => {
                const change = createChange(config);
                return change ? [change] : [];
            }),
        [dispatchDabChanges],
    );

    const initializeDabConfig = useCallback(() => {
        void refreshDabState().catch((error) => {
            console.error("Failed to initialize DAB config from cache:", error);
        });
    }, [refreshDabState]);

    const syncDabConfigWithSchema = useCallback(() => {
        void refreshDabState().catch((error) => {
            console.error("Failed to sync DAB config with schema:", error);
        });
    }, [refreshDabState]);

    const updateDabApiTypes = useCallback(
        (apiTypes: Dab.ApiType[]) => {
            void dispatchDabChange(() => ({ type: "set_api_types", apiTypes }));
        },
        [dispatchDabChange],
    );

    const toggleDabEntity = useCallback(
        (entityId: string, isEnabled: boolean) => {
            void dispatchDabChange(() => ({
                type: "set_entity_enabled",
                entity: { id: entityId },
                isEnabled,
            }));
        },
        [dispatchDabChange],
    );

    const toggleDabEntities = useCallback(
        (entityIds: string[], isEnabled: boolean) => {
            void dispatchDabChanges((config) => {
                const entityIdSet = new Set(entityIds);
                return config.entities
                    .filter(
                        (entity) => entityIdSet.has(entity.id) && entity.isEnabled !== isEnabled,
                    )
                    .map((entity) => ({
                        type: "set_entity_enabled",
                        entity: { id: entity.id },
                        isEnabled,
                    }));
            });
        },
        [dispatchDabChanges],
    );

    const toggleDabEntityAction = useCallback(
        (entityId: string, action: Dab.EntityAction, isEnabled: boolean) => {
            void dispatchDabChange((config) => {
                const entity = config.entities.find((e) => e.id === entityId);
                if (!entity) {
                    return undefined;
                }

                const enabledActions = isEnabled
                    ? [...entity.enabledActions.filter((a) => a !== action), action]
                    : entity.enabledActions.filter((a) => a !== action);

                return {
                    type: "set_entity_actions",
                    entity: { id: entityId },
                    enabledActions,
                };
            });
        },
        [dispatchDabChange],
    );

    const toggleDabEntityActions = useCallback(
        (entityIds: string[], action: Dab.EntityAction, isEnabled: boolean) => {
            void dispatchDabChanges((config) => {
                const entityIdSet = new Set(entityIds);
                return config.entities.flatMap((entity) => {
                    if (!entityIdSet.has(entity.id)) {
                        return [];
                    }

                    const hasAction = entity.enabledActions.includes(action);
                    if (hasAction === isEnabled) {
                        return [];
                    }

                    const enabledActions = isEnabled
                        ? [...entity.enabledActions.filter((a) => a !== action), action]
                        : entity.enabledActions.filter((a) => a !== action);

                    return [
                        {
                            type: "set_entity_actions",
                            entity: { id: entity.id },
                            enabledActions,
                        },
                    ];
                });
            });
        },
        [dispatchDabChanges],
    );

    const toggleDabColumnExposure = useCallback(
        (entityId: string, columnId: string, isExposed: boolean) => {
            void dispatchDabChange(() => ({
                type: "set_column_exposed",
                entity: { id: entityId },
                column: { id: columnId },
                isExposed,
            }));
        },
        [dispatchDabChange],
    );

    const updateDabEntitySettings = useCallback(
        (entityId: string, settings: Dab.EntityAdvancedSettings) => {
            return dispatchDabChange(() => ({
                type: "patch_entity_settings",
                entity: { id: entityId },
                set: settings,
            }));
        },
        [dispatchDabChange],
    );

    // Auto-generate text config whenever dabConfig changes
    useEffect(() => {
        if (!dabConfig) {
            return;
        }

        void extensionRpc
            .sendRequest(Dab.GenerateConfigRequest.type, { config: dabConfig })
            .then((response) => {
                if (response.success) {
                    setDabConfigTextFileContent(response.configContent);
                } else {
                    console.error("Failed to generate DAB config:", response.error);
                }
            })
            .catch((error) => {
                console.error("Failed to generate DAB config:", error);
            });
    }, [dabConfig, extensionRpc]);

    const copyToClipboard = useCallback(
        (text: string, copyTextType: Dab.CopyTextType) => {
            void extensionRpc.sendNotification(Dab.CopyTextNotification.type, {
                text,
                copyTextType,
            });
        },
        [extensionRpc],
    );

    const openUrl = useCallback(
        (url: string, apiType?: Dab.ApiType) => {
            void extensionRpc.sendNotification(Dab.OpenUrlNotification.type, { url, apiType });
        },
        [extensionRpc],
    );

    const openDabConfigInEditor = useCallback(
        (configContent: string) => {
            void extensionRpc.sendNotification(Dab.OpenConfigInEditorNotification.type, {
                configContent,
            });
        },
        [extensionRpc],
    );

    const addDabConfigToWorkspace = useCallback(
        (configContent: string) => {
            void extensionRpc.sendNotification(Dab.AddConfigToWorkspaceNotification.type, {
                configContent,
            });
        },
        [extensionRpc],
    );

    const openLogsInNewTab = useCallback(
        (logsContent: string) => {
            void extensionRpc.sendNotification(Dab.OpenLogsInNewTabNotification.type, {
                logsContent,
            });
        },
        [extensionRpc],
    );

    const openDabDeploymentDialog = useCallback(() => {
        setDabDeploymentState((prev) => ({
            ...prev,
            isDialogOpen: true,
            dialogStep: Dab.DabDeploymentDialogStep.Confirmation,
        }));
    }, []);

    const closeDabDeploymentDialog = useCallback(() => {
        setDabDeploymentState((prev) => ({
            ...prev,
            isDialogOpen: false,
        }));
    }, []);

    const setDabDeploymentDialogStep = useCallback((step: Dab.DabDeploymentDialogStep) => {
        setDabDeploymentState((prev) => ({
            ...prev,
            dialogStep: step,
        }));
    }, []);

    const updateDabDeploymentParams = useCallback((params: Partial<Dab.DabDeploymentParams>) => {
        setDabDeploymentState((prev) => ({
            ...prev,
            params: {
                ...prev.params,
                ...params,
            },
        }));
    }, []);

    const validateDabDeploymentParams = useCallback(
        async (
            containerName: string,
            port: number,
        ): Promise<Dab.ValidateDeploymentParamsResponse> => {
            return extensionRpc.sendRequest(Dab.ValidateDeploymentParamsRequest.type, {
                containerName,
                port,
            });
        },
        [extensionRpc],
    );

    const updateDeploymentStepStatus = useCallback(
        (
            step: Dab.DabDeploymentStepOrder,
            status: ApiStatus,
            message?: string,
            containerLogs?: string,
            fullErrorText?: string,
            errorLink?: string,
            errorLinkText?: string,
        ) => {
            setDabDeploymentState((prev) => ({
                ...prev,
                stepStatuses: prev.stepStatuses.map((s) =>
                    s.step === step
                        ? {
                              ...s,
                              status,
                              message,
                              containerLogs,
                              fullErrorText,
                              errorLink,
                              errorLinkText,
                          }
                        : s,
                ),
            }));
        },
        [],
    );

    const runDabDeploymentStep = useCallback(
        async (step: Dab.DabDeploymentStepOrder) => {
            updateDeploymentStepStatus(step, ApiStatus.Loading);

            if (step === Dab.DabDeploymentStepOrder.startContainer && !dabConfig) {
                updateDeploymentStepStatus(
                    step,
                    ApiStatus.Error,
                    "DAB configuration is not available.",
                    undefined,
                );
                return;
            }

            const response = await extensionRpc.sendRequest(Dab.RunDeploymentStepRequest.type, {
                step,
                params: dabDeploymentState.params,
                config: dabConfig ?? undefined,
            });

            if (response.success) {
                setDabDeploymentState((prev) => {
                    const updatedStatuses = prev.stepStatuses.map((s) =>
                        s.step === step ? { ...s, status: ApiStatus.Loaded } : s,
                    );

                    if (step === Dab.DabDeploymentStepOrder.checkContainer) {
                        return {
                            ...prev,
                            stepStatuses: updatedStatuses,
                            currentDeploymentStep: step + 1,
                            isDeploying: false,
                            apiUrl: response.apiUrl,
                            dialogStep: Dab.DabDeploymentDialogStep.Complete,
                        };
                    }

                    return {
                        ...prev,
                        stepStatuses: updatedStatuses,
                        currentDeploymentStep: step + 1,
                    };
                });
            } else {
                updateDeploymentStepStatus(
                    step,
                    ApiStatus.Error,
                    response.error,
                    response.containerLogs,
                    response.fullErrorText,
                    response.errorLink,
                    response.errorLinkText,
                );
            }
        },
        [dabConfig, dabDeploymentState.params, extensionRpc, updateDeploymentStepStatus],
    );

    const resetDabDeploymentState = useCallback(() => {
        setDabDeploymentState(Dab.createDefaultDeploymentState());
    }, []);

    const retryDabDeploymentSteps = useCallback(async () => {
        try {
            await extensionRpc.sendRequest(Dab.StopDeploymentRequest.type, {
                containerName: dabDeploymentState.params.containerName,
            });
        } catch (error) {
            console.error("Failed to clean up DAB container before retry:", error);
        }

        setDabDeploymentState((prev) => ({
            ...prev,
            currentDeploymentStep: Dab.DabDeploymentStepOrder.pullImage,
            stepStatuses: prev.stepStatuses.map((s) => {
                if (s.step >= Dab.DabDeploymentStepOrder.pullImage) {
                    return {
                        ...s,
                        status: ApiStatus.NotStarted,
                        message: undefined,
                        containerLogs: undefined,
                        fullErrorText: undefined,
                        errorLink: undefined,
                        errorLinkText: undefined,
                    };
                }
                return s;
            }),
            error: undefined,
            apiUrl: undefined,
        }));
    }, [dabDeploymentState.params.containerName, extensionRpc]);

    const addDabMcpServer = useCallback(
        async (serverUrl: string): Promise<Dab.AddMcpServerResponse> => {
            return extensionRpc.sendRequest(Dab.AddMcpServerRequest.type, {
                serverName: `DabMcp-${dabDeploymentState.params.port}`,
                serverUrl,
            });
        },
        [extensionRpc, dabDeploymentState.params.port],
    );

    return (
        <DabContext.Provider
            value={{
                isInitialized,
                isDabDeploymentSupported,
                copyToClipboard,
                openUrl,
                openLogsInNewTab,
                dabConfig,
                dabCommandError,
                clearDabCommandError,
                initializeDabConfig,
                syncDabConfigWithSchema,
                updateDabApiTypes,
                toggleDabEntity,
                toggleDabEntities,
                toggleDabEntityAction,
                toggleDabEntityActions,
                toggleDabColumnExposure,
                updateDabEntitySettings,
                dabTextFilter,
                setDabTextFilter,
                dabConfigTextFileContent,
                openDabConfigInEditor,
                addDabConfigToWorkspace,
                dabDeploymentState,
                openDabDeploymentDialog,
                closeDabDeploymentDialog,
                setDabDeploymentDialogStep,
                updateDabDeploymentParams,
                validateDabDeploymentParams,
                runDabDeploymentStep,
                resetDabDeploymentState,
                retryDabDeploymentSteps,
                addDabMcpServer,
                currentFilteredTables,
            }}>
            {children}
        </DabContext.Provider>
    );
};

export const useDabContext = (): DabContextProps => {
    const context = useContext(DabContext);
    if (!context) {
        throw new Error("useDabContext must be used within a DabProvider");
    }
    return context;
};
