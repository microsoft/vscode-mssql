/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Dab } from "../../../../sharedInterfaces/dab";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { registerSchemaDesignerDabToolHandlers } from "../schemaDesignerRpcHandlers";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { DabConfigHistory } from "./dabConfigHistory";

interface DabContextProps {
    isInitialized: boolean;
    isDabDeploymentSupported: boolean;
    copyToClipboard: (text: string, copyTextType: Dab.CopyTextType) => void;
    openUrl: (url: string, apiType?: Dab.ApiType) => void;
    openLogsInNewTab: (logsContent: string) => void;
    dabConfig: Dab.DabConfig | null;
    initializeDabConfig: () => void;
    syncDabConfigWithSchema: () => void;
    canUndoDabConfig: boolean;
    canRedoDabConfig: boolean;
    undoDabConfig: () => void;
    redoDabConfig: () => void;
    resetDabConfig: () => void;
    updateDabApiTypes: (apiTypes: Dab.ApiType[]) => void;
    toggleDabEntity: (entityId: string, isEnabled: boolean) => void;
    toggleDabEntityAction: (entityId: string, action: Dab.EntityAction, isEnabled: boolean) => void;
    toggleDabColumnExposure: (entityId: string, columnId: string, isExposed: boolean) => void;
    updateDabEntitySettings: (entityId: string, settings: Dab.EntityAdvancedSettings) => void;
    updateDabEntityConfig: (entity: Dab.DabEntityConfig) => void;
    dabTextFilter: string;
    setDabTextFilter: (text: string) => void;
    dabConfigTextFileContent: string;
    dabCliSetupState: Dab.DabCliSetupState;
    dabValidationState: DabValidationState;
    retryDabCliSetup: () => void;
    openDabDotnetSettings: () => void;
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

export type DabValidationState =
    | { status: "idle" | "validating"; diagnostics: Dab.DabValidationDiagnostic[] }
    | { status: "valid"; diagnostics: Dab.DabValidationDiagnostic[] }
    | { status: "invalid"; diagnostics: Dab.DabValidationDiagnostic[] }
    | { status: "blocked"; diagnostics: []; setup: Dab.DabCliSetupState };

const DabContext = createContext<DabContextProps | undefined>(undefined);

interface DabProviderProps {
    children: React.ReactNode;
}

export const DabProvider: React.FC<DabProviderProps> = ({ children }) => {
    const schemaDesignerContext = useContext(SchemaDesignerContext);
    const { extensionRpc, extractSchema, isInitialized, isInitializedRef, waitForInitialization } =
        schemaDesignerContext;
    const isDabDeploymentSupported =
        useSchemaDesignerSelector((s) => s?.isDabDeploymentSupported) ?? false;
    const currentFilteredTables = useSchemaDesignerSelector((s) => s?.currentFilteredTables) ?? [];
    const activeView = useSchemaDesignerSelector((s) => s?.activeView);

    const [dabConfig, setDabConfig] = useState<Dab.DabConfig | null>(null);
    const [dabSourceObjects, setDabSourceObjects] = useState<Dab.DabSourceObject[]>([]);
    const [dabTextFilter, setDabTextFilter] = useState<string>("");
    const [dabConfigTextFileContent, setDabConfigTextFileContent] = useState<string>("");
    const [dabCliSetupState, setDabCliSetupState] = useState<Dab.DabCliSetupState>({
        status: "notStarted",
        version: Dab.DAB_CLI_VERSION,
    });
    const [dabValidationState, setDabValidationState] = useState<DabValidationState>({
        status: "idle",
        diagnostics: [],
    });
    const [canUndoDabConfig, setCanUndoDabConfig] = useState(false);
    const [canRedoDabConfig, setCanRedoDabConfig] = useState(false);
    const [dabDeploymentState, setDabDeploymentState] = useState<Dab.DabDeploymentState>(
        Dab.createDefaultDeploymentState(),
    );

    const dabConfigRef = useRef<Dab.DabConfig | null>(dabConfig);
    const extractSchemaRef = useRef<() => ReturnType<typeof extractSchema>>(extractSchema);
    const dabSourceObjectsRef = useRef<Dab.DabSourceObject[]>(dabSourceObjects);
    const historyRef = useRef(new DabConfigHistory());
    const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
    const validationSequenceRef = useRef(0);
    const hasRequestedDabCliSetupRef = useRef(false);

    useEffect(() => {
        dabConfigRef.current = dabConfig;
    }, [dabConfig]);

    useEffect(() => {
        extractSchemaRef.current = extractSchema;
    }, [extractSchema]);

    useEffect(() => {
        dabSourceObjectsRef.current = dabSourceObjects;
    }, [dabSourceObjects]);

    const updateHistoryState = useCallback(() => {
        setCanUndoDabConfig(historyRef.current.canUndo);
        setCanRedoDabConfig(historyRef.current.canRedo);
    }, []);

    const persistDabConfig = useCallback(
        (config: Dab.DabConfig) => {
            persistenceQueueRef.current = persistenceQueueRef.current
                .catch(() => undefined)
                .then(async () => {
                    await extensionRpc.sendRequest(Dab.PersistConfigRequest.type, { config });
                })
                .catch((error) => {
                    extensionRpc.log.error("Failed to persist DAB config", error);
                });
        },
        [extensionRpc],
    );

    const setInitialDabConfig = useCallback(
        (config: Dab.DabConfig, shouldPersist: boolean) => {
            historyRef.current.clear();
            dabConfigRef.current = config;
            setDabConfig(config);
            updateHistoryState();
            if (shouldPersist) {
                persistDabConfig(config);
            }
        },
        [persistDabConfig, updateHistoryState],
    );

    const commitDabConfig = useCallback(
        (config: Dab.DabConfig) => {
            const previous = dabConfigRef.current;
            if (!previous || !historyRef.current.push(previous, config)) {
                return;
            }

            dabConfigRef.current = config;
            setDabConfig(config);
            updateHistoryState();
            persistDabConfig(config);
        },
        [persistDabConfig, updateHistoryState],
    );

    const replaceDabConfigWithoutHistory = useCallback(
        (config: Dab.DabConfig) => {
            historyRef.current.clear();
            dabConfigRef.current = config;
            setDabConfig(config);
            updateHistoryState();
            persistDabConfig(config);
        },
        [persistDabConfig, updateHistoryState],
    );

    useEffect(() => {
        registerSchemaDesignerDabToolHandlers({
            extensionRpc,
            isInitializedRef,
            waitForInitialization,
            getCurrentDabConfig: () => dabConfigRef.current,
            getCurrentSourceObjects: () => [
                ...extractSchemaRef
                    .current()
                    .tables.map((table) => Dab.createSourceObjectFromTable(table)),
                ...dabSourceObjectsRef.current,
            ],
            commitDabConfig: (config, options) => {
                if (options?.recordHistory === false) {
                    replaceDabConfigWithoutHistory(config);
                } else {
                    commitDabConfig(config);
                }
            },
        });
    }, [commitDabConfig, extensionRpc, replaceDabConfigWithoutHistory, waitForInitialization]);

    const initializeDabConfig = useCallback(() => {
        void Promise.all([
            extensionRpc.sendRequest(Dab.GetCachedConfigRequest.type),
            extensionRpc.sendRequest(Dab.GetDatabaseObjectsRequest.type).catch(() => ({
                sourceObjects: [],
            })),
        ])
            .then(([response, databaseObjects]) => {
                const schema = extractSchema();
                const sourceObjects = [
                    ...schema.tables.map((table) => Dab.createSourceObjectFromTable(table)),
                    ...databaseObjects.sourceObjects,
                ];
                setDabSourceObjects(databaseObjects.sourceObjects);
                const baseConfig =
                    response.config ?? Dab.createDefaultConfigFromSources(sourceObjects);
                const synced = Dab.syncConfigWithSources(baseConfig, sourceObjects);
                setInitialDabConfig(synced.config, !response.config || synced.changed);
            })
            .catch((error) => {
                extensionRpc.log.error("Failed to initialize persisted DAB config", error);
                const schema = extractSchema();
                setInitialDabConfig(Dab.createDefaultConfig(schema.tables), true);
            });
    }, [extensionRpc, extractSchema, setInitialDabConfig]);

    const syncDabConfigWithSchema = useCallback(() => {
        const currentConfig = dabConfigRef.current;
        if (!currentConfig) {
            return;
        }

        const schema = extractSchema();
        const sourceObjects = [
            ...schema.tables.map((table) => Dab.createSourceObjectFromTable(table)),
            ...dabSourceObjects,
        ];
        const synced = Dab.syncConfigWithSources(currentConfig, sourceObjects);
        if (synced.changed) {
            replaceDabConfigWithoutHistory(synced.config);
        }
    }, [dabSourceObjects, extractSchema, replaceDabConfigWithoutHistory]);

    const mutateDabConfig = useCallback(
        (mutator: (config: Dab.DabConfig) => Dab.DabConfig) => {
            const current = dabConfigRef.current;
            if (!current) {
                return;
            }
            commitDabConfig(mutator(current));
        },
        [commitDabConfig],
    );

    const updateDabApiTypes = useCallback(
        (apiTypes: Dab.ApiType[]) => {
            mutateDabConfig((prev) => {
                return {
                    ...prev,
                    apiTypes,
                };
            });
        },
        [mutateDabConfig],
    );

    const toggleDabEntity = useCallback(
        (entityId: string, isEnabled: boolean) => {
            mutateDabConfig((prev) => {
                return {
                    ...prev,
                    entities: prev.entities.map((entity) => {
                        if (entity.id !== entityId) {
                            return entity;
                        }

                        return {
                            ...entity,
                            isEnabled,
                            advancedSettings: {
                                ...entity.advancedSettings,
                                restEnabled: isEnabled,
                                graphQLEnabled: isEnabled,
                                mcpEnabled: isEnabled,
                                mcpDmlToolsEnabled: isEnabled,
                                ...(entity.sourceType === Dab.EntitySourceType.StoredProcedure
                                    ? {
                                          exposeAsMcpCustomTool: false,
                                          mcpCustomToolEnabled: false,
                                      }
                                    : {}),
                            },
                        };
                    }),
                };
            });
        },
        [mutateDabConfig],
    );

    const toggleDabEntityAction = useCallback(
        (entityId: string, action: Dab.EntityAction, isEnabled: boolean) => {
            mutateDabConfig((prev) => {
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
                    const role = e.advancedSettings.authorizationRole;
                    const permissions = Dab.getEntityPermissions(e).map((permission) =>
                        permission.role === role
                            ? { ...permission, actions: enabledActions }
                            : permission,
                    );
                    return {
                        ...e,
                        enabledActions,
                        advancedSettings: {
                            ...e.advancedSettings,
                            permissions,
                        },
                    };
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
        [mutateDabConfig],
    );

    const toggleDabColumnExposure = useCallback(
        (entityId: string, columnId: string, isExposed: boolean) => {
            mutateDabConfig((prev) => {
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
        [mutateDabConfig],
    );

    const updateDabEntitySettings = useCallback(
        (entityId: string, settings: Dab.EntityAdvancedSettings) => {
            mutateDabConfig((prev) => {
                return {
                    ...prev,
                    entities: prev.entities.map((e) =>
                        e.id === entityId ? { ...e, advancedSettings: settings } : e,
                    ),
                };
            });
        },
        [mutateDabConfig],
    );

    const updateDabEntityConfig = useCallback(
        (updatedEntity: Dab.DabEntityConfig) => {
            mutateDabConfig((prev) => {
                return {
                    ...prev,
                    entities: prev.entities.map((entity) =>
                        entity.id === updatedEntity.id ? updatedEntity : entity,
                    ),
                };
            });
        },
        [mutateDabConfig],
    );

    const undoDabConfig = useCallback(() => {
        const current = dabConfigRef.current;
        if (!current) {
            return;
        }
        const previous = historyRef.current.undo(current);
        if (!previous) {
            return;
        }
        dabConfigRef.current = previous;
        setDabConfig(previous);
        updateHistoryState();
        persistDabConfig(previous);
    }, [persistDabConfig, updateHistoryState]);

    const redoDabConfig = useCallback(() => {
        const current = dabConfigRef.current;
        if (!current) {
            return;
        }
        const next = historyRef.current.redo(current);
        if (!next) {
            return;
        }
        dabConfigRef.current = next;
        setDabConfig(next);
        updateHistoryState();
        persistDabConfig(next);
    }, [persistDabConfig, updateHistoryState]);

    const resetDabConfig = useCallback(() => {
        const sourceObjects = [
            ...extractSchemaRef
                .current()
                .tables.map((table) => Dab.createSourceObjectFromTable(table)),
            ...dabSourceObjectsRef.current,
        ];
        commitDabConfig(Dab.createDefaultConfigFromSources(sourceObjects));
    }, [commitDabConfig]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                activeView !== SchemaDesigner.SchemaDesignerActiveView.Dab ||
                (!event.ctrlKey && !event.metaKey) ||
                event.altKey
            ) {
                return;
            }

            const target = event.target as HTMLElement | null;
            if (
                target?.tagName === "INPUT" ||
                target?.tagName === "TEXTAREA" ||
                target?.isContentEditable
            ) {
                return;
            }

            const key = event.key.toLocaleLowerCase();
            if (key === "z") {
                event.preventDefault();
                event.shiftKey ? redoDabConfig() : undoDabConfig();
            } else if (key === "y") {
                event.preventDefault();
                redoDabConfig();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [activeView, redoDabConfig, undoDabConfig]);

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
                    extensionRpc.log.error("Failed to generate DAB config", response.error);
                }
            })
            .catch((error) => {
                extensionRpc.log.error("Failed to generate DAB config", error);
            });
    }, [dabConfig, extensionRpc]);

    useEffect(() => {
        if (
            activeView !== SchemaDesigner.SchemaDesignerActiveView.Dab ||
            !isInitialized ||
            hasRequestedDabCliSetupRef.current
        ) {
            return;
        }

        hasRequestedDabCliSetupRef.current = true;
        setDabCliSetupState({ status: "installing", version: Dab.DAB_CLI_VERSION });
        void extensionRpc
            .sendRequest(Dab.GetDabCliSetupRequest.type)
            .then((setup) => {
                setDabCliSetupState(setup);
                if (setup.status !== "ready") {
                    setDabValidationState({ status: "blocked", diagnostics: [], setup });
                }
            })
            .catch((error) => {
                const setup: Dab.DabCliSetupState = {
                    status: "installationFailed",
                    version: Dab.DAB_CLI_VERSION,
                    reason: error instanceof Error ? error.message : String(error),
                };
                setDabCliSetupState(setup);
                setDabValidationState({ status: "blocked", diagnostics: [], setup });
            });
    }, [activeView, extensionRpc, isInitialized]);

    useEffect(() => {
        if (!dabConfigTextFileContent || dabCliSetupState.status !== "ready") {
            return;
        }

        const sequence = ++validationSequenceRef.current;
        const timeout = window.setTimeout(() => {
            setDabValidationState((current) => ({
                status: "validating",
                diagnostics: current.diagnostics,
            }));
            void extensionRpc
                .sendRequest(Dab.ValidateConfigRequest.type, {
                    configContent: dabConfigTextFileContent,
                })
                .then((result) => {
                    if (sequence !== validationSequenceRef.current) {
                        return;
                    }
                    if (result.status === "blocked") {
                        setDabCliSetupState(result.setup);
                        setDabValidationState({
                            status: "blocked",
                            diagnostics: [],
                            setup: result.setup,
                        });
                    } else {
                        setDabValidationState(result);
                    }
                })
                .catch((error) => {
                    if (sequence !== validationSequenceRef.current) {
                        return;
                    }
                    setDabValidationState({
                        status: "invalid",
                        diagnostics: [
                            {
                                severity: "error",
                                message: error instanceof Error ? error.message : String(error),
                            },
                        ],
                    });
                });
        }, 600);

        return () => {
            window.clearTimeout(timeout);
            validationSequenceRef.current++;
        };
    }, [dabCliSetupState.status, dabConfigTextFileContent, extensionRpc]);

    const retryDabCliSetup = useCallback(() => {
        setDabCliSetupState({ status: "installing", version: Dab.DAB_CLI_VERSION });
        setDabValidationState({ status: "idle", diagnostics: [] });
        void extensionRpc
            .sendRequest(Dab.RetryDabCliSetupRequest.type)
            .then((setup) => {
                setDabCliSetupState(setup);
                if (setup.status !== "ready") {
                    setDabValidationState({ status: "blocked", diagnostics: [], setup });
                }
            })
            .catch((error) => {
                const setup: Dab.DabCliSetupState = {
                    status: "installationFailed",
                    version: Dab.DAB_CLI_VERSION,
                    reason: error instanceof Error ? error.message : String(error),
                };
                setDabCliSetupState(setup);
                setDabValidationState({ status: "blocked", diagnostics: [], setup });
            });
    }, [extensionRpc]);

    const openDabDotnetSettings = useCallback(() => {
        void extensionRpc.sendNotification(Dab.OpenDabDotnetSettingsNotification.type);
    }, [extensionRpc]);

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
            extensionRpc.log.error("Failed to clean up DAB container before retry", error);
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
                initializeDabConfig,
                syncDabConfigWithSchema,
                canUndoDabConfig,
                canRedoDabConfig,
                undoDabConfig,
                redoDabConfig,
                resetDabConfig,
                updateDabApiTypes,
                toggleDabEntity,
                toggleDabEntityAction,
                toggleDabColumnExposure,
                updateDabEntitySettings,
                updateDabEntityConfig,
                dabTextFilter,
                setDabTextFilter,
                dabConfigTextFileContent,
                dabCliSetupState,
                dabValidationState,
                retryDabCliSetup,
                openDabDotnetSettings,
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
