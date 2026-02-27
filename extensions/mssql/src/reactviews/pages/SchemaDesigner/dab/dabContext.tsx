/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Dab } from "../../../../sharedInterfaces/dab";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { registerSchemaDesignerDabToolHandlers } from "../schemaDesignerRpcHandlers";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";

interface DabContextProps {
    isInitialized: boolean;
    copyToClipboard: (text: string, copyTextType: Dab.CopyTextType) => void;
    dabConfig: Dab.DabConfig | null;
    initializeDabConfig: () => void;
    syncDabConfigWithSchema: () => void;
    updateDabApiTypes: (apiTypes: Dab.ApiType[]) => void;
    toggleDabEntity: (entityId: string, isEnabled: boolean) => void;
    toggleDabEntityAction: (entityId: string, action: Dab.EntityAction, isEnabled: boolean) => void;
    updateDabEntitySettings: (entityId: string, settings: Dab.EntityAdvancedSettings) => void;
    dabTextFilter: string;
    setDabTextFilter: (text: string) => void;
    dabConfigContent: string;
    dabConfigRequestId: number;
    generateDabConfig: () => Promise<void>;
    openDabConfigInEditor: (configContent: string) => void;
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
    retryDabDeploymentSteps: () => void;
    addDabMcpServer: (serverUrl: string) => Promise<Dab.AddMcpServerResponse>;
}

const DabContext = createContext<DabContextProps | undefined>(undefined);

interface DabProviderProps {
    children: React.ReactNode;
}

export const DabProvider: React.FC<DabProviderProps> = ({ children }) => {
    const schemaDesignerContext = useContext(SchemaDesignerContext);
    const { extensionRpc, extractSchema, isInitialized } = schemaDesignerContext;

    const [dabConfig, setDabConfig] = useState<Dab.DabConfig | null>(null);
    const [dabTextFilter, setDabTextFilter] = useState<string>("");
    const [dabConfigContent, setDabConfigContent] = useState<string>("");
    const [dabConfigRequestId, setDabConfigRequestId] = useState<number>(0);
    const [dabDeploymentState, setDabDeploymentState] = useState<Dab.DabDeploymentState>(
        Dab.createDefaultDeploymentState(),
    );

    const dabConfigRef = useRef<Dab.DabConfig | null>(dabConfig);
    const isInitializedRef = useRef<boolean>(isInitialized);
    const extractSchemaRef = useRef<() => ReturnType<typeof extractSchema>>(extractSchema);

    useEffect(() => {
        dabConfigRef.current = dabConfig;
    }, [dabConfig]);

    useEffect(() => {
        isInitializedRef.current = isInitialized;
    }, [isInitialized]);

    useEffect(() => {
        extractSchemaRef.current = extractSchema;
    }, [extractSchema]);

    useEffect(() => {
        registerSchemaDesignerDabToolHandlers({
            extensionRpc,
            isInitializedRef,
            getCurrentDabConfig: () => dabConfigRef.current,
            getCurrentSchemaTables: () => extractSchemaRef.current().tables,
            commitDabConfig: (config) => {
                setDabConfig(config);
            },
        });
    }, [extensionRpc]);

    const initializeDabConfig = useCallback(() => {
        const schema = extractSchema();
        const config = Dab.createDefaultConfig(schema.tables);
        setDabConfig(config);
    }, [extractSchema]);

    const syncDabConfigWithSchema = useCallback(() => {
        if (!dabConfig) {
            return;
        }

        const schema = extractSchema();
        const currentTableIds = new Set(schema.tables.map((t) => t.id));
        const existingEntityIds = new Set(dabConfig.entities.map((e) => e.id));

        const newTables = schema.tables.filter((t) => !existingEntityIds.has(t.id));
        const updatedEntities = dabConfig.entities.filter((e) => currentTableIds.has(e.id));
        const newEntities = newTables.map((t) => Dab.createDefaultEntityConfig(t));

        if (newEntities.length > 0 || updatedEntities.length !== dabConfig.entities.length) {
            setDabConfig({
                ...dabConfig,
                entities: [...updatedEntities, ...newEntities],
            });
        }
    }, [dabConfig, extractSchema]);

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
                return {
                    ...prev,
                    entities: prev.entities.map((e) => {
                        if (e.id !== entityId) {
                            return e;
                        }
                        const enabledActions = isEnabled
                            ? [...e.enabledActions, action]
                            : e.enabledActions.filter((a) => a !== action);
                        return { ...e, enabledActions };
                    }),
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

    const generateDabConfig = useCallback(async () => {
        if (!dabConfig) {
            return;
        }
        const response = await extensionRpc.sendRequest(Dab.GenerateConfigRequest.type, {
            config: dabConfig,
        });
        if (response.success) {
            setDabConfigContent(response.configContent);
            setDabConfigRequestId((id) => id + 1);
        }
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

    const openDabConfigInEditor = useCallback(
        (configContent: string) => {
            void extensionRpc.sendNotification(Dab.OpenConfigInEditorNotification.type, {
                configContent,
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
            fullErrorText?: string,
            errorLink?: string,
            errorLinkText?: string,
        ) => {
            setDabDeploymentState((prev) => ({
                ...prev,
                stepStatuses: prev.stepStatuses.map((s) =>
                    s.step === step
                        ? { ...s, status, message, fullErrorText, errorLink, errorLinkText }
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

    const retryDabDeploymentSteps = useCallback(() => {
        setDabDeploymentState((prev) => ({
            ...prev,
            currentDeploymentStep: Dab.DabDeploymentStepOrder.pullImage,
            stepStatuses: prev.stepStatuses.map((s) => {
                if (s.step >= Dab.DabDeploymentStepOrder.pullImage) {
                    return { ...s, status: ApiStatus.NotStarted, message: undefined };
                }
                return s;
            }),
            error: undefined,
            apiUrl: undefined,
        }));
    }, []);

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
                copyToClipboard,
                dabConfig,
                initializeDabConfig,
                syncDabConfigWithSchema,
                updateDabApiTypes,
                toggleDabEntity,
                toggleDabEntityAction,
                updateDabEntitySettings,
                dabTextFilter,
                setDabTextFilter,
                dabConfigContent,
                dabConfigRequestId,
                generateDabConfig,
                openDabConfigInEditor,
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
