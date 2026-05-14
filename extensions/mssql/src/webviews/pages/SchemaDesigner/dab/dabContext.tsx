/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Dab } from "../../../../sharedInterfaces/dab";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { registerSchemaDesignerDabToolHandlers } from "../schemaDesignerRpcHandlers";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";

interface DabContextProps {
    isInitialized: boolean;
    isDabDeploymentSupported: boolean;
    copyToClipboard: (text: string, copyTextType: Dab.CopyTextType) => void;
    openUrl: (url: string, apiType?: Dab.ApiType) => void;
    openLogsInNewTab: (logsContent: string) => void;
    dabConfig: Dab.DabConfig | null;
    dabEntityCandidates: Dab.DabEntityCandidate[];
    initializeDabConfig: () => void;
    syncDabConfigWithSchema: () => void;
    refreshDabEntityCandidates: () => Promise<void>;
    updateDabApiTypes: (apiTypes: Dab.ApiType[]) => void;
    toggleDabEntity: (entityId: string, isEnabled: boolean) => void;
    toggleDabEntityAction: (entityId: string, action: Dab.EntityAction, isEnabled: boolean) => void;
    toggleDabColumnExposure: (entityId: string, columnId: string, isExposed: boolean) => void;
    updateDabEntitySettings: (entityId: string, settings: Dab.EntityAdvancedSettings) => void;
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

function normalizeDabIdentifier(value: string): string {
    const normalized = value.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "");
    if (!normalized) {
        return "Entity";
    }
    return /^[A-Za-z]/.test(normalized) ? normalized : `Entity_${normalized}`;
}

function getUniqueEntityName(baseName: string, existingNames: Set<string>): string {
    const normalizedBaseName = normalizeDabIdentifier(baseName);
    let candidateName = normalizedBaseName;
    let index = 2;
    while (existingNames.has(candidateName.toLowerCase())) {
        candidateName = `${normalizedBaseName}${index}`;
        index++;
    }
    existingNames.add(candidateName.toLowerCase());
    return candidateName;
}

function getCandidateSourceKey(candidate: Dab.DabEntityCandidate): string {
    return `${candidate.sourceType}:${candidate.schemaName}.${candidate.objectName}`.toLowerCase();
}

function isSystemSchema(schemaName: string): boolean {
    const normalizedSchema = schemaName.toLowerCase();
    return normalizedSchema === "sys" || normalizedSchema === "information_schema";
}

function shouldHideDabEntity(entity: Dab.DabEntityConfig): boolean {
    const sourceType = entity.sourceType ?? Dab.EntitySourceType.Table;
    return (
        isSystemSchema(entity.schemaName) &&
        (sourceType === Dab.EntitySourceType.View ||
            sourceType === Dab.EntitySourceType.StoredProcedure)
    );
}

function createDabEntityFromCandidate(
    candidate: Dab.DabEntityCandidate,
    existingEntityNames: Set<string>,
): Dab.DabEntityConfig | undefined {
    if (candidate.sourceType === Dab.EntitySourceType.Table) {
        return undefined;
    }

    const columns: Dab.DabColumnConfig[] = (candidate.fields ?? []).map((field) => ({
        id: `${candidate.id}:${field.name}`,
        name: field.name,
        dataType: field.dataType ?? "",
        isPrimaryKey: !!field.isKey,
        isSupported: true,
        isExposed: true,
    }));

    return {
        id: candidate.id,
        tableName: candidate.objectName,
        schemaName: candidate.schemaName,
        sourceType: candidate.sourceType,
        keyFields:
            candidate.sourceType === Dab.EntitySourceType.View ? candidate.keyFields : undefined,
        parameters:
            candidate.sourceType === Dab.EntitySourceType.StoredProcedure
                ? candidate.parameters
                : undefined,
        restMethods:
            candidate.sourceType === Dab.EntitySourceType.StoredProcedure
                ? [Dab.StoredProcedureRestMethod.Post]
                : undefined,
        graphQLOperation:
            candidate.sourceType === Dab.EntitySourceType.StoredProcedure
                ? Dab.StoredProcedureGraphQLOperation.Mutation
                : undefined,
        mcp:
            candidate.sourceType === Dab.EntitySourceType.StoredProcedure
                ? { customTool: false }
                : undefined,
        isEnabled: false,
        isSupported: candidate.isSupported,
        unsupportedReasons:
            candidate.isSupported || !candidate.unsupportedReason
                ? undefined
                : [
                      {
                          type:
                              candidate.sourceType === Dab.EntitySourceType.View
                                  ? "noViewKeyFields"
                                  : "noPrimaryKey",
                      },
                  ],
        enabledActions: [Dab.EntityAction.Read],
        columns,
        advancedSettings: {
            entityName: getUniqueEntityName(candidate.objectName, existingEntityNames),
            authorizationRole: Dab.AuthorizationRole.Anonymous,
        },
    };
}

function syncConfigWithEntityCandidates(
    config: Dab.DabConfig,
    candidates: Dab.DabEntityCandidate[],
): Dab.DabConfig {
    if (candidates.length === 0) {
        const entities = config.entities.filter((entity) => !shouldHideDabEntity(entity));
        return entities.length === config.entities.length ? config : { ...config, entities };
    }

    const visibleEntities = config.entities.filter((entity) => !shouldHideDabEntity(entity));
    const existingSourceKeys = new Set(
        visibleEntities.map((entity) =>
            `${entity.sourceType ?? Dab.EntitySourceType.Table}:${entity.schemaName}.${entity.tableName}`.toLowerCase(),
        ),
    );
    const existingEntityNames = new Set(
        visibleEntities.map((entity) => entity.advancedSettings.entityName.toLowerCase()),
    );
    const discoveredEntities = candidates
        .filter(
            (candidate) =>
                !isSystemSchema(candidate.schemaName) &&
                !existingSourceKeys.has(getCandidateSourceKey(candidate)),
        )
        .map((candidate) => createDabEntityFromCandidate(candidate, existingEntityNames))
        .filter((entity): entity is Dab.DabEntityConfig => !!entity);

    if (discoveredEntities.length === 0) {
        return visibleEntities.length === config.entities.length
            ? config
            : { ...config, entities: visibleEntities };
    }

    return {
        ...config,
        entities: [...visibleEntities, ...discoveredEntities],
    };
}

export const DabProvider: React.FC<DabProviderProps> = ({ children }) => {
    const schemaDesignerContext = useContext(SchemaDesignerContext);
    const { extensionRpc, extractSchema, isInitialized, isInitializedRef, waitForInitialization } =
        schemaDesignerContext;
    const isDabDeploymentSupported =
        useSchemaDesignerSelector((s) => s?.isDabDeploymentSupported) ?? false;
    const currentFilteredTables = useSchemaDesignerSelector((s) => s?.currentFilteredTables) ?? [];

    const [dabConfig, setDabConfig] = useState<Dab.DabConfig | null>(null);
    const [dabEntityCandidates, setDabEntityCandidates] = useState<Dab.DabEntityCandidate[]>([]);
    const [dabTextFilter, setDabTextFilter] = useState<string>("");
    const [dabConfigTextFileContent, setDabConfigTextFileContent] = useState<string>("");
    const [dabDeploymentState, setDabDeploymentState] = useState<Dab.DabDeploymentState>(
        Dab.createDefaultDeploymentState(),
    );

    const dabConfigRef = useRef<Dab.DabConfig | null>(dabConfig);
    const extractSchemaRef = useRef<() => ReturnType<typeof extractSchema>>(extractSchema);

    useEffect(() => {
        dabConfigRef.current = dabConfig;
    }, [dabConfig]);

    useEffect(() => {
        extractSchemaRef.current = extractSchema;
    }, [extractSchema]);

    useEffect(() => {
        registerSchemaDesignerDabToolHandlers({
            extensionRpc,
            isInitializedRef,
            waitForInitialization,
            getCurrentDabConfig: () => dabConfigRef.current,
            getCurrentSchemaTables: () => extractSchemaRef.current().tables,
            getDabEntityCandidates: async () => {
                const response = await extensionRpc.sendRequest(
                    Dab.GetEntityCandidatesRequest.type,
                );
                return response.entityCandidates;
            },
            commitDabConfig: (config) => {
                setDabConfig(config);
            },
        });
    }, [extensionRpc, waitForInitialization]);

    const refreshDabEntityCandidates = useCallback(async () => {
        const response = await extensionRpc.sendRequest(Dab.GetEntityCandidatesRequest.type);
        setDabEntityCandidates(response.entityCandidates);
    }, [extensionRpc]);

    useEffect(() => {
        if (!isInitialized) {
            return;
        }

        void refreshDabEntityCandidates().catch((error) => {
            console.error("Failed to load DAB entity candidates:", error);
        });
    }, [isInitialized, refreshDabEntityCandidates]);

    useEffect(() => {
        if (!dabConfig || dabEntityCandidates.length === 0) {
            return;
        }

        setDabConfig((prev) => {
            if (!prev) {
                return prev;
            }
            const next = syncConfigWithEntityCandidates(prev, dabEntityCandidates);
            return next;
        });
    }, [dabConfig, dabEntityCandidates]);

    const initializeDabConfig = useCallback(() => {
        void extensionRpc
            .sendRequest(Dab.GetCachedConfigRequest.type)
            .then((response) => {
                const schema = extractSchema();
                const baseConfig = response.config ?? Dab.createDefaultConfig(schema.tables);
                const synced = Dab.syncConfigWithSchema(baseConfig, schema.tables);
                setDabConfig(syncConfigWithEntityCandidates(synced.config, dabEntityCandidates));
            })
            .catch((error) => {
                console.error("Failed to initialize DAB config from cache:", error);
                const schema = extractSchema();
                setDabConfig(
                    syncConfigWithEntityCandidates(
                        Dab.createDefaultConfig(schema.tables),
                        dabEntityCandidates,
                    ),
                );
            });
    }, [dabEntityCandidates, extensionRpc, extractSchema]);

    const syncDabConfigWithSchema = useCallback(() => {
        if (!dabConfig) {
            return;
        }

        const synced = Dab.syncConfigWithSchema(dabConfig, extractSchema().tables);
        const syncedWithCandidates = syncConfigWithEntityCandidates(
            synced.config,
            dabEntityCandidates,
        );
        if (synced.changed || syncedWithCandidates !== synced.config) {
            setDabConfig(syncedWithCandidates);
        }
    }, [dabConfig, dabEntityCandidates, extractSchema]);

    const updateDabApiTypes = useCallback((apiTypes: Dab.ApiType[]) => {
        setDabConfig((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                apiTypes,
            };
        });
    }, []);

    const toggleDabEntity = useCallback((entityId: string, isEnabled: boolean) => {
        setDabConfig((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                entities: prev.entities.map((e) => (e.id === entityId ? { ...e, isEnabled } : e)),
            };
        });
    }, []);

    const toggleDabEntityAction = useCallback(
        (entityId: string, action: Dab.EntityAction, isEnabled: boolean) => {
            setDabConfig((prev) => {
                if (!prev) {
                    return prev;
                }

                let didChange = false;
                const entities = prev.entities.map((e) => {
                    if (e.id !== entityId) {
                        return e;
                    }

                    const hasActionEnabled = e.enabledActions.includes(action);
                    if (hasActionEnabled === isEnabled) {
                        return e;
                    }

                    didChange = true;
                    const enabledActions = isEnabled
                        ? [...e.enabledActions, action]
                        : e.enabledActions.filter((a) => a !== action);
                    return { ...e, enabledActions };
                });

                if (!didChange) {
                    return prev;
                }

                return {
                    ...prev,
                    entities,
                };
            });
        },
        [],
    );

    const toggleDabColumnExposure = useCallback(
        (entityId: string, columnId: string, isExposed: boolean) => {
            setDabConfig((prev) => {
                if (!prev) {
                    return prev;
                }

                return {
                    ...prev,
                    entities: prev.entities.map((entity) =>
                        entity.id === entityId
                            ? {
                                  ...entity,
                                  columns: entity.columns.map((column) =>
                                      column.id === columnId ? { ...column, isExposed } : column,
                                  ),
                              }
                            : entity,
                    ),
                };
            });
        },
        [],
    );

    const updateDabEntitySettings = useCallback(
        (entityId: string, settings: Dab.EntityAdvancedSettings) => {
            setDabConfig((prev) => {
                if (!prev) {
                    return prev;
                }
                return {
                    ...prev,
                    entities: prev.entities.map((e) =>
                        e.id === entityId ? { ...e, advancedSettings: settings } : e,
                    ),
                };
            });
        },
        [],
    );

    // Auto-generate text config whenever dabConfig changes
    useEffect(() => {
        if (!dabConfig) {
            return;
        }

        void extensionRpc.sendNotification(Dab.CacheConfigNotification.type, {
            config: dabConfig,
        });

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
                dabEntityCandidates,
                initializeDabConfig,
                syncDabConfigWithSchema,
                refreshDabEntityCandidates,
                updateDabApiTypes,
                toggleDabEntity,
                toggleDabEntityAction,
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
