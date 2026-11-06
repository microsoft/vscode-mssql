/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Dab } from "../../../../sharedInterfaces/dab";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { TelemetryActions, TelemetryViews } from "../../../../sharedInterfaces/telemetry";
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
    resetDabConfig: () => Promise<void>;
    discardPendingDabCliEngine: () => Promise<void>;
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
    /** Opens the deployment view straight on its configuration changes. */
    openDabDeploymentChanges: () => void;
    closeDabDeploymentDialog: () => void;
    setDabDeploymentDialogStep: (step: Dab.DabDeploymentDialogStep) => void;
    dabDeployments: Dab.DabDeploymentListItem[];
    dabDeploymentsStatus: ApiStatus;
    dabDeploymentsError: string | undefined;
    /**
     * Reloads the deployment. A quiet reload keeps the current status while it
     * runs, so a background refresh never swaps a view for a spinner.
     */
    loadDabDeployments: (options?: { quiet?: boolean }) => Promise<void>;
    deleteDabDeployment: (deploymentId: string) => Promise<Dab.DeploymentActionResponse>;
    stopDabDeploymentContainer: (deploymentId: string) => Promise<Dab.DeploymentActionResponse>;
    updateDabDeploymentParams: (params: Partial<Dab.DabDeploymentParams>) => void;
    validateDabDeploymentParams: (
        containerName: string,
        port: number,
    ) => Promise<Dab.ValidateDeploymentParamsResponse>;
    runDabDeploymentStep: (step: Dab.DabDeploymentStepOrder) => Promise<void>;
    resetDabDeploymentState: () => void;
    /** The database's deployment run, while there is one to show. */
    dabDeploymentRun: Dab.DabDeploymentRunState | undefined;
    loadDabDeploymentRun: () => Promise<void>;
    /**
     * Starts a deployment run. With a deployment id, the existing deployment is
     * replaced with the current config on its original target; without one, a
     * first deployment is made to the given target and port.
     */
    startDabDeployment: (
        target: Dab.DabDeploymentTarget,
        deploymentId?: string,
        port?: number,
    ) => Promise<void>;
    respondToDabDeploymentStep: (
        step: Dab.DabDeploymentStepOrder,
        action: Dab.DabDeploymentStepAction,
    ) => void;
    retryDabDeploymentRun: () => Promise<void>;
    cancelDabDeploymentRun: () => Promise<void>;
    dismissDabDeploymentRun: () => Promise<void>;
    getDabDeploymentChanges: (deploymentId: string) => Promise<Dab.GetDeploymentChangesResponse>;
    /** Suggests the first free port when none is given, or checks the given one. */
    checkDabDeploymentPort: (port?: number) => Promise<Dab.CheckDeploymentPortResponse>;
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
    const [dabDeploymentRun, setDabDeploymentRun] = useState<Dab.DabDeploymentRunState | undefined>(
        undefined,
    );
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
     *
     * The discard is awaited first. Publishing the rebuilt config is what
     * schedules its save, and letting that start while the delete is still in
     * flight leaves which of the two lands last to chance.
     */
    const resetDabConfig = useCallback(async () => {
        await extensionRpc.sendRequest(Dab.ResetConfigRequest.type, undefined);

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
        extensionRpc.sendActionEvent({
            telemetryView: TelemetryViews.SchemaDesigner,
            telemetryAction: TelemetryActions.OpenDabDeploymentDialog,
            additionalProps: { entryPoint: Dab.DabDeploymentEntryPoint.Standalone },
        });
        setDabDeploymentState({
            ...Dab.createDefaultDeploymentState(Dab.DabDeploymentTarget.Docker),
            isDialogOpen: true,
            dialogStep: Dab.DabDeploymentDialogStep.Confirmation,
            entryPoint: Dab.DabDeploymentEntryPoint.Standalone,
        });
    }, [extensionRpc]);

    const openDeploymentsDialog = useCallback(
        (showChanges: boolean) => {
            extensionRpc.sendActionEvent({
                telemetryView: TelemetryViews.SchemaDesigner,
                telemetryAction: TelemetryActions.OpenDabDeploymentDialog,
                additionalProps: { entryPoint: Dab.DabDeploymentEntryPoint.Deployments },
            });
            setDabDeploymentState({
                ...Dab.createDefaultDeploymentState(),
                isDialogOpen: true,
                showChanges,
            });
        },
        [extensionRpc],
    );

    const openDabDeploymentsDialog = useCallback(
        () => openDeploymentsDialog(false),
        [openDeploymentsDialog],
    );

    /** Opens the deployment view straight on its configuration changes. */
    const openDabDeploymentChanges = useCallback(
        () => openDeploymentsDialog(true),
        [openDeploymentsDialog],
    );

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
            update: Partial<Omit<Dab.DabDeploymentStepStatus, "step" | "status">> = {},
        ) => {
            setDabDeploymentState((prev) => ({
                ...prev,
                stepStatuses: prev.stepStatuses.map((s) =>
                    s.step === step
                        ? {
                              step,
                              status,
                              ...update,
                          }
                        : s,
                ),
            }));
        },
        [],
    );

    /**
     * Runs one step of the toolbar's Deploy flow. The deployments dialog does
     * not use this: its deployment is run by the extension, so it keeps going
     * when the designer is closed.
     */
    const runDabDeploymentStep = useCallback(
        async (step: Dab.DabDeploymentStepOrder) => {
            updateDeploymentStepStatus(step, ApiStatus.Loading);

            if (step === Dab.DabDeploymentStepOrder.startContainer && !dabConfig) {
                updateDeploymentStepStatus(step, ApiStatus.Error, {
                    message: "DAB configuration is not available.",
                });
                return;
            }

            const response = await extensionRpc.sendRequest(Dab.RunDeploymentStepRequest.type, {
                step,
                target: dabDeploymentState.target,
                entryPoint: dabDeploymentState.entryPoint,
                params: dabDeploymentState.params,
                config: dabConfig ?? undefined,
            });

            if (!response.success) {
                updateDeploymentStepStatus(step, ApiStatus.Error, {
                    message: response.error,
                    containerLogs: response.containerLogs,
                    fullErrorText: response.fullErrorText,
                    errorLink: response.errorLink,
                    errorLinkText: response.errorLinkText,
                });
                return;
            }

            setDabDeploymentState((prev) => {
                const updatedStatuses = prev.stepStatuses.map((s) =>
                    s.step === step ? { step, status: ApiStatus.Loaded } : s,
                );
                const nextStep = Dab.getNextDabDeploymentStep(prev.target, step) ?? step;

                if (Dab.isFinalDabDeploymentStep(prev.target, step)) {
                    return {
                        ...prev,
                        stepStatuses: updatedStatuses,
                        currentDeploymentStep: nextStep,
                        isDeploying: false,
                        apiUrl: response.apiUrl,
                        dialogStep: Dab.DabDeploymentDialogStep.Complete,
                    };
                }

                return {
                    ...prev,
                    stepStatuses: updatedStatuses,
                    currentDeploymentStep: nextStep,
                };
            });
        },
        [
            dabConfig,
            dabDeploymentState.params,
            dabDeploymentState.target,
            dabDeploymentState.entryPoint,
            extensionRpc,
            updateDeploymentStepStatus,
        ],
    );

    const resetDabDeploymentState = useCallback(() => {
        setDabDeploymentState(Dab.createDefaultDeploymentState());
    }, []);

    // The extension owns the deployment run and reports every change to it.
    useEffect(() => {
        extensionRpc.onNotification(Dab.DeploymentRunChangedNotification.type, (run) => {
            setDabDeploymentRun(run);
        });
    }, [extensionRpc]);

    /** Picks up the database's deployment run, which may have started in an earlier session. */
    const loadDabDeploymentRun = useCallback(async () => {
        try {
            const response = await extensionRpc.sendRequest(
                Dab.GetDeploymentRunRequest.type,
                undefined,
            );
            setDabDeploymentRun(response.run);
        } catch (error) {
            extensionRpc.log.error("Failed to load the DAB deployment run", error);
        }
    }, [extensionRpc]);

    /**
     * Starts a deployment run. With a deployment id, the existing deployment is
     * replaced with the current config on its original target; without one, a
     * first deployment is made to the given target and port.
     */
    const startDabDeployment = useCallback(
        async (target: Dab.DabDeploymentTarget, deploymentId?: string, port?: number) => {
            if (!dabConfig) {
                return;
            }
            if (!deploymentId) {
                extensionRpc.sendActionEvent({
                    telemetryView: TelemetryViews.SchemaDesigner,
                    telemetryAction: TelemetryActions.SelectDabDeploymentTarget,
                    additionalProps: {
                        target:
                            target === Dab.DabDeploymentTarget.Docker ||
                            target === Dab.DabDeploymentTarget.DabCli
                                ? target
                                : "unknown",
                    },
                });
            }

            const run = await extensionRpc.sendRequest(Dab.StartDeploymentRunRequest.type, {
                target,
                deploymentId,
                port,
                config: dabConfig,
            });
            setDabDeploymentRun(run);
            // A dialog opened on the changes returns to the deployment itself
            // once the run that applies them is done.
            setDabDeploymentState((prev) => ({ ...prev, showChanges: false }));
        },
        [dabConfig, extensionRpc],
    );

    const respondToDabDeploymentStep = useCallback(
        (step: Dab.DabDeploymentStepOrder, action: Dab.DabDeploymentStepAction) => {
            if (!dabDeploymentRun) {
                return;
            }
            void extensionRpc.sendRequest(Dab.RespondToDeploymentStepRequest.type, {
                runId: dabDeploymentRun.runId,
                step,
                action,
            });
        },
        [dabDeploymentRun, extensionRpc],
    );

    const retryDabDeploymentRun = useCallback(async () => {
        if (dabDeploymentRun) {
            await extensionRpc.sendRequest(Dab.RetryDeploymentRunRequest.type, {
                runId: dabDeploymentRun.runId,
            });
        }
    }, [dabDeploymentRun, extensionRpc]);

    const cancelDabDeploymentRun = useCallback(async () => {
        if (dabDeploymentRun) {
            await extensionRpc.sendRequest(Dab.CancelDeploymentRunRequest.type, {
                runId: dabDeploymentRun.runId,
            });
        }
    }, [dabDeploymentRun, extensionRpc]);

    /** Forgets a finished run, so the dialog shows the deployment again. */
    const dismissDabDeploymentRun = useCallback(async () => {
        if (!dabDeploymentRun) {
            return;
        }
        const runId = dabDeploymentRun.runId;
        setDabDeploymentRun(undefined);
        await extensionRpc.sendRequest(Dab.DismissDeploymentRunRequest.type, { runId });
    }, [dabDeploymentRun, extensionRpc]);

    /** The config a deployment runs and the one the current designer config produces. */
    const getDabDeploymentChanges = useCallback(
        async (deploymentId: string): Promise<Dab.GetDeploymentChangesResponse> => {
            if (!dabConfig) {
                return { currentConfig: "" };
            }
            return extensionRpc.sendRequest(Dab.GetDeploymentChangesRequest.type, {
                deploymentId,
                config: dabConfig,
            });
        },
        [dabConfig, extensionRpc],
    );

    const checkDabDeploymentPort = useCallback(
        async (port?: number): Promise<Dab.CheckDeploymentPortResponse> => {
            try {
                return await extensionRpc.sendRequest(Dab.CheckDeploymentPortRequest.type, {
                    port,
                });
            } catch (error) {
                return {
                    port,
                    isAvailable: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        },
        [extensionRpc],
    );

    /**
     * Stops a CLI engine that started but never became a tracked deployment.
     * Does nothing for any other target, or once the deployment has finished.
     */
    const discardPendingDabCliEngine = useCallback(async () => {
        if (dabDeploymentState.target !== Dab.DabDeploymentTarget.DabCli) {
            return;
        }

        try {
            await extensionRpc.sendRequest(Dab.DiscardPendingCliEngineRequest.type, {
                port: dabDeploymentState.params.port,
            });
        } catch (error) {
            extensionRpc.log.error("Failed to stop a pending DAB CLI engine", error);
        }
    }, [dabDeploymentState.params.port, dabDeploymentState.target, extensionRpc]);

    const retryDabDeploymentSteps = useCallback(async () => {
        // Each target can leave something behind that would make the retry fail
        // against its own previous attempt: Docker a container, the CLI an
        // engine that started but never passed its readiness check and is still
        // holding the port.
        try {
            // No name means the run failed before one was picked, so the
            // deployment steps never started and left nothing behind.
            if (!dabDeploymentState.params.containerName) {
                // Nothing to clean up.
            } else if (dabDeploymentState.target === Dab.DabDeploymentTarget.Docker) {
                await extensionRpc.sendRequest(Dab.StopDeploymentRequest.type, {
                    containerName: dabDeploymentState.params.containerName,
                });
            } else {
                await discardPendingDabCliEngine();
            }
        } catch (error) {
            extensionRpc.log.error("Failed to clean up the DAB deployment before retry", error);
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
    }, [
        dabDeploymentState.params.containerName,
        dabDeploymentState.target,
        discardPendingDabCliEngine,
        extensionRpc,
    ]);

    const loadDabDeployments = useCallback(
        async (options?: { quiet?: boolean }) => {
            if (!options?.quiet) {
                setDabDeploymentsStatus(ApiStatus.Loading);
            }
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
        },
        [dabConfig, extensionRpc],
    );

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

    const stopDabDeploymentContainer = useCallback(
        (deploymentId: string) =>
            runDeploymentAction(Dab.StopDeploymentContainerRequest.type, deploymentId),
        [runDeploymentAction],
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
                discardPendingDabCliEngine,
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
                openDabDeploymentChanges,
                closeDabDeploymentDialog,
                setDabDeploymentDialogStep,
                dabDeployments,
                dabDeploymentsStatus,
                dabDeploymentsError,
                loadDabDeployments,
                deleteDabDeployment,
                stopDabDeploymentContainer,
                updateDabDeploymentParams,
                validateDabDeploymentParams,
                runDabDeploymentStep,
                resetDabDeploymentState,
                startDabDeployment,
                dabDeploymentRun,
                loadDabDeploymentRun,
                respondToDabDeploymentStep,
                retryDabDeploymentRun,
                cancelDabDeploymentRun,
                dismissDabDeploymentRun,
                getDabDeploymentChanges,
                checkDabDeploymentPort,
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
