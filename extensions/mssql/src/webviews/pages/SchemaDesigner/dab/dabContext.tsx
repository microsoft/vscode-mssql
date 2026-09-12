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

interface DabContextProps {
    isInitialized: boolean;
    isDabDeploymentSupported: boolean;
    dabTargetSupport: Record<string, SchemaDesigner.DabTargetSupport>;
    /** True unless this connection's authentication rules the container out. */
    isDockerTargetSupported: boolean;
    copyToClipboard: (text: string, copyTextType: Dab.CopyTextType) => void;
    openUrl: (url: string, apiType?: Dab.ApiType) => void;
    openLogsInNewTab: (logsContent: string) => void;
    dabConfig: Dab.DabConfig | null;
    initializeDabConfig: () => void;
    syncDabConfigWithSchema: () => void;
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
    openDabConfigInEditor: (configContent: string) => void;
    addDabConfigToWorkspace: (configContent: string) => void;
    dabDeploymentState: Dab.DabDeploymentState;
    openDabDeploymentDialog: () => void;
    openDabDeploymentsDialog: () => void;
    closeDabDeploymentDialog: () => void;
    setDabDeploymentDialogView: (view: Dab.DabDeploymentDialogView) => void;
    setDabDeploymentDialogStep: (step: Dab.DabDeploymentDialogStep) => void;
    dabDeployments: Dab.DabDeploymentListItem[];
    dabDeploymentsStatus: ApiStatus;
    dabDeploymentsError: string | undefined;
    loadDabDeployments: () => Promise<void>;
    deleteDabDeployment: (deploymentId: string) => Promise<Dab.DeploymentActionResponse>;
    startDabDeploymentContainer: (deploymentId: string) => Promise<Dab.DeploymentActionResponse>;
    stopDabDeploymentContainer: (deploymentId: string) => Promise<Dab.DeploymentActionResponse>;
    redeployDabDeployment: (deploymentId: string) => Promise<Dab.DeploymentActionResponse>;
    updateDabDeploymentParams: (params: Partial<Dab.DabDeploymentParams>) => void;
    validateDabDeploymentParams: (
        containerName: string,
        port: number,
        namingStyle?: Dab.DabDeploymentNamingStyle,
    ) => Promise<Dab.ValidateDeploymentParamsResponse>;
    runDabDeploymentStep: (step: Dab.DabDeploymentStepOrder) => Promise<void>;
    resetDabDeploymentState: () => void;
    startNewDabDeployment: (target: Dab.DabDeploymentTarget) => void;
    restartDabDeploymentFlow: () => void;
    retryDabDeploymentSteps: () => Promise<void>;
    addDabMcpServer: (serverUrl: string) => Promise<Dab.AddMcpServerResponse>;
    currentFilteredTables: string[];
}

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
    const dabTargetSupport = useSchemaDesignerSelector((s) => s?.dabTargetSupport) ?? {};
    // Read as supported until the extension says otherwise, so a state that
    // has not arrived yet does not read as a refusal.
    const isDockerTargetSupported =
        dabTargetSupport[Dab.DabDeploymentTarget.Docker]?.isSupported !== false;
    const currentFilteredTables = useSchemaDesignerSelector((s) => s?.currentFilteredTables) ?? [];

    const [dabConfig, setDabConfig] = useState<Dab.DabConfig | null>(null);
    const [dabSourceObjects, setDabSourceObjects] = useState<Dab.DabSourceObject[]>([]);
    const [dabTextFilter, setDabTextFilter] = useState<string>("");
    const [dabConfigTextFileContent, setDabConfigTextFileContent] = useState<string>("");
    const [dabDeploymentState, setDabDeploymentState] = useState<Dab.DabDeploymentState>(
        Dab.createDefaultDeploymentState(),
    );
    const [dabDeployments, setDabDeployments] = useState<Dab.DabDeploymentListItem[]>([]);
    const [dabDeploymentsStatus, setDabDeploymentsStatus] = useState<ApiStatus>(
        ApiStatus.NotStarted,
    );
    const [dabDeploymentsError, setDabDeploymentsError] = useState<string | undefined>(undefined);

    const dabConfigRef = useRef<Dab.DabConfig | null>(dabConfig);
    const extractSchemaRef = useRef<() => ReturnType<typeof extractSchema>>(extractSchema);
    const dabSourceObjectsRef = useRef<Dab.DabSourceObject[]>(dabSourceObjects);

    useEffect(() => {
        dabConfigRef.current = dabConfig;
    }, [dabConfig]);

    useEffect(() => {
        extractSchemaRef.current = extractSchema;
    }, [extractSchema]);

    useEffect(() => {
        dabSourceObjectsRef.current = dabSourceObjects;
    }, [dabSourceObjects]);

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
            commitDabConfig: (config) => {
                dabConfigRef.current = config;
                setDabConfig(config);
            },
        });
    }, [extensionRpc, waitForInitialization]);

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
                setDabConfig(synced.config);
            })
            .catch((error) => {
                extensionRpc.log.error("Failed to initialize DAB config from cache", error);
                const schema = extractSchema();
                setDabConfig(Dab.createDefaultConfig(schema.tables));
            });
    }, [extensionRpc, extractSchema]);

    const syncDabConfigWithSchema = useCallback(() => {
        if (!dabConfig) {
            return;
        }

        const schema = extractSchema();
        const sourceObjects = [
            ...schema.tables.map((table) => Dab.createSourceObjectFromTable(table)),
            ...dabSourceObjects,
        ];
        const synced = Dab.syncConfigWithSources(dabConfig, sourceObjects);
        if (synced.changed) {
            setDabConfig(synced.config);
        }
    }, [dabConfig, dabSourceObjects, extractSchema]);

    /**
     * Rebuilds the configuration from the current schema, discarding every
     * saved edit. The new config flows through the usual save path, so the
     * stored file is replaced with these defaults.
     */
    const resetDabConfig = useCallback(() => {
        void extensionRpc.sendNotification(Dab.ResetConfigNotification.type, undefined);

        const schema = extractSchema();
        const sourceObjects = [
            ...schema.tables.map((table) => Dab.createSourceObjectFromTable(table)),
            ...dabSourceObjects,
        ];
        setDabConfig(Dab.createDefaultConfigFromSources(sourceObjects));
    }, [dabSourceObjects, extensionRpc, extractSchema]);

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

    const updateDabEntityConfig = useCallback((updatedEntity: Dab.DabEntityConfig) => {
        setDabConfig((prev) => {
            if (!prev) {
                return prev;
            }

            return {
                ...prev,
                entities: prev.entities.map((entity) =>
                    entity.id === updatedEntity.id ? updatedEntity : entity,
                ),
            };
        });
    }, []);

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
                    extensionRpc.log.error("Failed to generate DAB config", response.error);
                }
            })
            .catch((error) => {
                extensionRpc.log.error("Failed to generate DAB config", error);
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

    /**
     * Opens the toolbar's Deploy flow: a self-contained Docker deployment that
     * starts at its confirmation step and ends on its own completion screen.
     * It deliberately never enters the deployments views, so that experience
     * can be switched off without this flow losing a beginning or an end.
     */
    const openDabDeploymentDialog = useCallback(() => {
        setDabDeploymentState({
            ...Dab.createDefaultDeploymentState(Dab.DabDeploymentTarget.Docker),
            isDialogOpen: true,
            dialogView: Dab.DabDeploymentDialogView.Wizard,
            dialogStep: Dab.DabDeploymentDialogStep.Confirmation,
            entryPoint: Dab.DabDeploymentEntryPoint.Standalone,
        });
    }, []);

    const openDabDeploymentsDialog = useCallback(() => {
        setDabDeploymentState({
            ...Dab.createDefaultDeploymentState(),
            isDialogOpen: true,
            dialogView: Dab.DabDeploymentDialogView.List,
        });
    }, []);

    const closeDabDeploymentDialog = useCallback(() => {
        setDabDeploymentState((prev) => ({
            ...prev,
            isDialogOpen: false,
        }));
    }, []);

    const setDabDeploymentDialogView = useCallback((view: Dab.DabDeploymentDialogView) => {
        setDabDeploymentState((prev) => ({
            ...prev,
            dialogView: view,
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
            namingStyle?: Dab.DabDeploymentNamingStyle,
        ): Promise<Dab.ValidateDeploymentParamsResponse> => {
            return extensionRpc.sendRequest(Dab.ValidateDeploymentParamsRequest.type, {
                containerName,
                port,
                namingStyle,
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
                target: dabDeploymentState.target,
                params: dabDeploymentState.params,
                config: dabConfig ?? undefined,
                deploymentId:
                    dabDeploymentState.mode === Dab.DabDeploymentMode.Redeploy
                        ? dabDeploymentState.activeDeploymentId
                        : undefined,
            });

            if (response.success) {
                setDabDeploymentState((prev) => {
                    const updatedStatuses = prev.stepStatuses.map((s) =>
                        s.step === step ? { ...s, status: ApiStatus.Loaded } : s,
                    );
                    // Each target has its own step sequence, so the next step
                    // comes from that sequence rather than from the enum order.
                    const nextStep = Dab.getNextDabDeploymentStep(prev.target, step) ?? step;

                    if (Dab.isFinalDabDeploymentStep(prev.target, step)) {
                        // Started from the deployments dialog, a finished
                        // deployment belongs back in the list where its
                        // endpoints and actions live. The standalone flow has no
                        // list to return to, so it ends on its own screen.
                        const isStandalone =
                            prev.entryPoint === Dab.DabDeploymentEntryPoint.Standalone;

                        return {
                            ...prev,
                            stepStatuses: updatedStatuses,
                            currentDeploymentStep: nextStep,
                            isDeploying: false,
                            apiUrl: response.apiUrl,
                            ...(isStandalone
                                ? { dialogStep: Dab.DabDeploymentDialogStep.Complete }
                                : { dialogView: Dab.DabDeploymentDialogView.List }),
                        };
                    }

                    return {
                        ...prev,
                        stepStatuses: updatedStatuses,
                        currentDeploymentStep: nextStep,
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
        [
            dabConfig,
            dabDeploymentState.params,
            dabDeploymentState.target,
            dabDeploymentState.mode,
            dabDeploymentState.activeDeploymentId,
            extensionRpc,
            updateDeploymentStepStatus,
        ],
    );

    const resetDabDeploymentState = useCallback(() => {
        setDabDeploymentState(Dab.createDefaultDeploymentState());
    }, []);

    /**
     * Starts a fresh deployment in the open dialog. Applied as one update so
     * the dialog stays open: the default state is closed, so resetting and then
     * setting the view separately would dismiss the dialog in between.
     */
    const startNewDabDeployment = useCallback((target: Dab.DabDeploymentTarget) => {
        setDabDeploymentState({
            ...Dab.createDefaultDeploymentState(target),
            isDialogOpen: true,
            dialogView: Dab.DabDeploymentDialogView.Wizard,
            dialogStep: Dab.DabDeploymentDialogStep.Confirmation,
            entryPoint: Dab.DabDeploymentEntryPoint.Deployments,
        });
    }, []);

    /**
     * Runs the current deployment again from the first prerequisite check,
     * keeping the container name, port, and redeploy target the user is on.
     */
    const restartDabDeploymentFlow = useCallback(() => {
        setDabDeploymentState((prev) => ({
            ...Dab.createDefaultDeploymentState(prev.target),
            isDialogOpen: prev.isDialogOpen,
            dialogView: prev.dialogView,
            target: prev.target,
            entryPoint: prev.entryPoint,
            mode: prev.mode,
            activeDeploymentId: prev.activeDeploymentId,
            params: prev.params,
            dialogStep: Dab.DabDeploymentDialogStep.Prerequisites,
        }));
    }, []);

    const retryDabDeploymentSteps = useCallback(async () => {
        // Only the Docker target leaves a container behind to clean up; a CLI
        // engine that failed to start has nothing to remove.
        if (dabDeploymentState.target === Dab.DabDeploymentTarget.Docker) {
            try {
                await extensionRpc.sendRequest(Dab.StopDeploymentRequest.type, {
                    containerName: dabDeploymentState.params.containerName,
                });
            } catch (error) {
                extensionRpc.log.error("Failed to clean up DAB container before retry", error);
            }
        }

        setDabDeploymentState((prev) => {
            // Rerun this target's deployment steps, leaving its prerequisites
            // alone: they are already satisfied and are numbered independently.
            const deploymentSteps = Dab.dabDeploymentStepsByTarget[prev.target].deployment;
            return {
                ...prev,
                currentDeploymentStep: deploymentSteps[0],
                stepStatuses: prev.stepStatuses.map((s) => {
                    if (deploymentSteps.includes(s.step)) {
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
            };
        });
    }, [dabDeploymentState.params.containerName, dabDeploymentState.target, extensionRpc]);

    const loadDabDeployments = useCallback(async () => {
        setDabDeploymentsStatus(ApiStatus.Loading);
        try {
            const response = await extensionRpc.sendRequest(Dab.GetDeploymentsRequest.type, {
                config: dabConfig ?? undefined,
            });
            setDabDeployments(response.deployments);
            setDabDeploymentsError(response.error);
            setDabDeploymentsStatus(response.error ? ApiStatus.Error : ApiStatus.Loaded);
        } catch (error) {
            extensionRpc.log.error("Failed to load DAB deployments", error);
            setDabDeployments([]);
            setDabDeploymentsError(error instanceof Error ? error.message : String(error));
            setDabDeploymentsStatus(ApiStatus.Error);
        }
    }, [dabConfig, extensionRpc]);

    /**
     * Runs an action against a tracked deployment and refreshes the list, so
     * the row reflects the container's new state without a manual refresh.
     */
    const runDeploymentAction = useCallback(
        async (
            requestType: typeof Dab.DeleteDeploymentRequest.type,
            deploymentId: string,
        ): Promise<Dab.DeploymentActionResponse> => {
            try {
                const response = await extensionRpc.sendRequest(requestType, { deploymentId });
                await loadDabDeployments();
                return response;
            } catch (error) {
                extensionRpc.log.error("DAB deployment action failed", error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        },
        [extensionRpc, loadDabDeployments],
    );

    const deleteDabDeployment = useCallback(
        (deploymentId: string) =>
            runDeploymentAction(Dab.DeleteDeploymentRequest.type, deploymentId),
        [runDeploymentAction],
    );

    const startDabDeploymentContainer = useCallback(
        (deploymentId: string) =>
            runDeploymentAction(Dab.StartDeploymentContainerRequest.type, deploymentId),
        [runDeploymentAction],
    );

    const stopDabDeploymentContainer = useCallback(
        (deploymentId: string) =>
            runDeploymentAction(Dab.StopDeploymentContainerRequest.type, deploymentId),
        [runDeploymentAction],
    );

    /**
     * Removes the existing container, then hands the wizard the same name and
     * port so the deployment steps recreate it with the current config.
     */
    const redeployDabDeployment = useCallback(
        async (deploymentId: string): Promise<Dab.DeploymentActionResponse> => {
            let response: Dab.PrepareRedeploymentResponse;
            try {
                response = await extensionRpc.sendRequest(Dab.PrepareRedeploymentRequest.type, {
                    deploymentId,
                });
            } catch (error) {
                extensionRpc.log.error("Failed to prepare DAB redeployment", error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }

            if (!response.success || !response.params) {
                // The container may already be gone; show the list as it is now.
                await loadDabDeployments();
                return response;
            }

            // Redeploy re-runs the target the deployment was originally made
            // with, not whichever one the dialog last used.
            const target = response.target ?? Dab.DabDeploymentTarget.Docker;
            setDabDeploymentState({
                ...Dab.createDefaultDeploymentState(target),
                isDialogOpen: true,
                dialogView: Dab.DabDeploymentDialogView.Wizard,
                dialogStep: Dab.DabDeploymentDialogStep.Prerequisites,
                mode: Dab.DabDeploymentMode.Redeploy,
                activeDeploymentId: deploymentId,
                params: response.params,
            });
            return { success: true };
        },
        [extensionRpc, loadDabDeployments],
    );

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
                dabTargetSupport,
                isDockerTargetSupported,
                copyToClipboard,
                openUrl,
                openLogsInNewTab,
                dabConfig,
                initializeDabConfig,
                syncDabConfigWithSchema,
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
                openDabConfigInEditor,
                addDabConfigToWorkspace,
                dabDeploymentState,
                openDabDeploymentDialog,
                openDabDeploymentsDialog,
                closeDabDeploymentDialog,
                setDabDeploymentDialogView,
                setDabDeploymentDialogStep,
                dabDeployments,
                dabDeploymentsStatus,
                dabDeploymentsError,
                loadDabDeployments,
                deleteDabDeployment,
                startDabDeploymentContainer,
                stopDabDeploymentContainer,
                redeployDabDeployment,
                updateDabDeploymentParams,
                validateDabDeploymentParams,
                runDabDeploymentStep,
                resetDabDeploymentState,
                startNewDabDeployment,
                restartDabDeploymentFlow,
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
