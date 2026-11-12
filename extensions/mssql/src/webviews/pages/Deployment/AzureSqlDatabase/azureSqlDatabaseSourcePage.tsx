/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Text } from "@fluentui/react-components";
import {
    ArrowLeft20Regular,
    ArrowRight20Regular,
    ArrowClockwise20Regular,
} from "@fluentui/react-icons";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { DatabaseSelector } from "../../../common/databaseSelector";
import { ErrorMessageDetails } from "../../../common/errorMessageDetails";
import {
    AzureSqlDatabaseRequests,
    LocalDatabaseSource,
    LocalDatabaseCompatibilityRequest,
    LocalDatabaseCompatibilityResult,
    LocalDatabaseDeploymentContent,
    LocalDatabaseDeploymentRequest,
    LocalDatabaseDeploymentResult,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import {
    DeploymentReducers,
    DeploymentType,
    DeploymentWebviewState,
} from "../../../../sharedInterfaces/deployment";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { TelemetryActions, TelemetryViews } from "../../../../sharedInterfaces/telemetry";
import { WizardPageShell } from "../../../common/wizardPageShell";
import { AzureSqlDatabaseUploadIcon } from "../../../common/icons/azureSqlDatabaseUpload";
import { locConstants } from "../../../common/locConstants";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { DeploymentContext } from "../deploymentStateProvider";
import { useDeploymentSelector } from "../deploymentSelector";
import { AzureSqlDatabaseSourceDetails } from "./azureSqlDatabaseSourceDetails";
import { AzureSqlDatabaseCompatibilityPage } from "./azureSqlDatabaseCompatibilityPage";
import { AzureSqlDatabaseFormPage } from "./azureSqlDatabaseFormPage";
import {
    hasDuplicateTagKeys,
    isAzureSqlFormValid,
    type TagEntry,
} from "./azureSqlDatabaseDeploymentWizard";
import { AzureSqlDatabaseReviewPage } from "./azureSqlDatabaseReviewPage";
import { AzureSqlDatabaseDeployPage } from "./azureSqlDatabaseDeployPage";

const useStyles = makeStyles({
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        maxWidth: "840px",
    },
    introduction: {
        display: "flex",
        flexDirection: "column",
        gap: "24px",
    },
    heading: { margin: 0 },
    description: {
        color: "var(--vscode-descriptionForeground)",
        lineHeight: "24px",
    },
    selector: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        width: "100%",
        maxWidth: "680px",
    },
    footer: { display: "flex", alignItems: "center", gap: "8px" },
});

interface LocalDatabaseList {
    connectionId: string;
    loading: boolean;
    databases: string[];
    error?: string;
}

export const AzureSqlDatabaseSourcePage = ({
    onBack,
    initialSource,
}: {
    onBack: () => void;
    initialSource?: LocalDatabaseSource;
}) => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const { extensionRpc } = useVscodeWebview<DeploymentWebviewState, DeploymentReducers>();
    const [sources, setSources] = useState<LocalDatabaseSource[]>([]);
    const [selectedConnectionId, setSelectedConnectionId] = useState("");
    const [selectedSource, setSelectedSource] = useState<LocalDatabaseSource>();
    const [databaseList, setDatabaseList] = useState<LocalDatabaseList>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>();
    const [sourceConnectionError, setSourceConnectionError] = useState<string>();
    const [refresh, setRefresh] = useState(0);
    // Consume Object Explorer preselection once, not again after Refresh or Change.
    const initialSourceRef = useRef(initialSource);
    const [connectedSource, setConnectedSource] = useState<LocalDatabaseSource>();
    const [deploymentContent, setDeploymentContent] =
        useState<LocalDatabaseDeploymentContent>("schemaAndData");
    const [validationRequest, setValidationRequest] = useState<LocalDatabaseCompatibilityRequest>();
    const [validationResult, setValidationResult] = useState<LocalDatabaseCompatibilityResult>();
    const [cloudPage, setCloudPage] = useState<"azure" | "review" | "deploy">();
    const showAzureForm = cloudPage === "azure";
    const showReview = cloudPage === "review";
    const showDeployment = cloudPage === "deploy";
    const [deploymentRequest, setDeploymentRequest] = useState<LocalDatabaseDeploymentRequest>();
    const [deploymentResult, setDeploymentResult] = useState<LocalDatabaseDeploymentResult>();
    const [cancelling, setCancelling] = useState(false);
    const [tags, setTags] = useState<TagEntry[]>([]);
    const azureState = useDeploymentSelector((state) =>
        state.deploymentType === DeploymentType.AzureSqlDatabase &&
        "azureComponentStatuses" in state.deploymentTypeState
            ? state.deploymentTypeState
            : undefined,
    );
    const isAzureFormReady =
        azureState?.loadState === ApiStatus.Loaded &&
        !!azureState.formState &&
        !!azureState.formComponents &&
        "accountId" in azureState.formComponents;
    const connectionTriggerRef = useRef<HTMLButtonElement>(null);
    const selectedConnection = sources.find((source) => source.id === selectedConnectionId);
    const databaseStateMatchesSelection = databaseList?.connectionId === selectedConnectionId;
    const displayedDatabases = databaseStateMatchesSelection ? databaseList.databases : [];
    const showDatabaseSpinner =
        !!selectedConnectionId && (!databaseStateMatchesSelection || databaseList.loading);
    const databaseListError = databaseStateMatchesSelection ? databaseList.error : "";
    const strings = locConstants.azureSqlDatabase;
    const currentStep = showDeployment
        ? 4
        : showReview
          ? 3
          : showAzureForm
            ? 2
            : validationRequest
              ? 1
              : 0;
    useEffect(() => {
        extensionRpc.sendActionEvent({
            telemetryView: TelemetryViews.LocalToCloudDeployment,
            telemetryAction: TelemetryActions.LocalToCloudWizardStep,
            additionalProps: {
                step: ["source", "compatibility", "azure", "review", "deploy"][currentStep],
            },
        });
    }, [extensionRpc, currentStep]);
    const canContinueToAzure =
        !!validationRequest &&
        validationResult?.validationId === validationRequest.validationId &&
        (validationResult.status === "passed" || validationResult.status === "warnings");
    const canContinueToReview =
        canContinueToAzure &&
        isAzureFormReady &&
        !!azureState.formState.accountId &&
        !azureState.formState.dataSource &&
        azureState.formValidationLoadState !== ApiStatus.Loading &&
        isAzureSqlFormValid(
            azureState.loadState,
            azureState.formState,
            azureState.formComponents,
            azureState.serverCreatedWithAuth,
            azureState,
        ) &&
        !hasDuplicateTagKeys(tags);
    const cancelOrClose = () => {
        if (!showDeployment || deploymentResult || !deploymentRequest) {
            context?.dispose();
            return;
        }
        setCancelling(true);
        setError(undefined);
        void extensionRpc
            .sendRequest(AzureSqlDatabaseRequests.CancelLocalDatabaseDeployment, {
                deploymentId: deploymentRequest.deploymentId,
            })
            .catch((failure) => {
                extensionRpc.log.error("Failed to cancel database deployment", failure);
                setError(failure instanceof Error ? failure.message : String(failure));
            })
            .finally(() => setCancelling(false));
    };
    const continueToAzure = () => {
        if (!canContinueToAzure || !context) {
            return;
        }
        setCloudPage("azure");
        if (!isAzureFormReady && azureState?.loadState !== ApiStatus.Loading) {
            context.initializeDeploymentSpecifics(DeploymentType.AzureSqlDatabase);
        }
    };
    const startCompatibility = () => {
        if (selectedSource && connectedSource?.isConnected) {
            setValidationResult(undefined);
            setValidationRequest({
                validationId: crypto.randomUUID(),
                sourceId: connectedSource.id,
                deploymentContent,
            });
        }
    };

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(undefined);
        void extensionRpc
            .sendRequest(AzureSqlDatabaseRequests.GetLocalDatabaseSources)
            .then((connections) => {
                if (!cancelled) {
                    const initial = initialSourceRef.current;
                    if (initial) {
                        initialSourceRef.current = undefined;
                        setSources([
                            ...connections.filter((connection) => connection.id !== initial.id),
                            {
                                ...initial,
                                ...connections.find((connection) => connection.id === initial.id),
                                database: initial.database,
                            },
                        ]);
                        setSelectedConnectionId(initial.id);
                    } else {
                        setSources(connections);
                    }
                }
            })
            .catch((loadError) => {
                extensionRpc.log.error("Failed to load local database sources", loadError);
                if (!cancelled) {
                    setError(loadError instanceof Error ? loadError.message : String(loadError));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [extensionRpc, refresh]);

    useEffect(() => {
        if (!selectedConnection) {
            setDatabaseList(undefined);
            return;
        }
        let cancelled = false;
        setDatabaseList({ connectionId: selectedConnection.id, loading: true, databases: [] });
        void extensionRpc
            .sendRequest(AzureSqlDatabaseRequests.GetLocalServerDatabases, {
                id: selectedConnection.id,
            })
            .then((databases) => {
                if (!cancelled) {
                    const names = [
                        ...new Set([
                            ...databases,
                            ...(selectedConnection.database ? [selectedConnection.database] : []),
                        ]),
                    ].sort((left, right) =>
                        left.localeCompare(right, undefined, { sensitivity: "base" }),
                    );
                    setDatabaseList({
                        connectionId: selectedConnection.id,
                        loading: false,
                        databases: names,
                    });
                    const database = selectedConnection.database || names[0];
                    if (database) {
                        setSelectedSource({ ...selectedConnection, database });
                    }
                }
            })
            .catch((failure) => {
                extensionRpc.log.error("Failed to load local server databases", failure);
                if (!cancelled) {
                    setDatabaseList({
                        connectionId: selectedConnection.id,
                        loading: false,
                        databases: [],
                        error: failure instanceof Error ? failure.message : String(failure),
                    });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [extensionRpc, selectedConnection]);

    const connectionOptions = useMemo(
        () =>
            sources.map((source) => ({
                value: source.id,
                text: source.profileName || source.server,
            })),
        [sources],
    );
    const clearSource = () => {
        setSelectedConnectionId("");
        setSelectedSource(undefined);
        setConnectedSource(undefined);
        setSourceConnectionError(undefined);
    };
    const steps = [
        strings.sourceStep,
        strings.compatibilityStep,
        strings.azureStep,
        strings.reviewStep,
        strings.deployStep,
    ];

    return (
        <WizardPageShell
            icon={<AzureSqlDatabaseUploadIcon aria-hidden="true" />}
            title={
                validationRequest && selectedSource
                    ? strings.deployDatabaseToAzure(selectedSource.database)
                    : strings.deployToAzureSql
            }
            subtitle={steps[currentStep]}
            currentStep={currentStep + 1}
            totalSteps={steps.length}
            maxContentWidth="wide"
            errorMessage={
                showDeployment
                    ? error
                    : showAzureForm
                      ? azureState?.errorMessage
                      : !validationRequest && error
                        ? strings.localConnectionsLoadFailed(error)
                        : undefined
            }
            loadingMessage={
                showAzureForm && !isAzureFormReady && azureState?.loadState !== ApiStatus.Error
                    ? strings.loadingAzureSqlDatabase
                    : undefined
            }
            footerStart={
                <Button onClick={cancelOrClose} disabled={cancelling}>
                    {showDeployment && deploymentResult
                        ? deploymentResult.status === "succeeded"
                            ? locConstants.common.finish
                            : locConstants.common.close
                        : cancelling
                          ? strings.deploymentCancelling
                          : locConstants.common.cancel}
                </Button>
            }
            footerEnd={
                showDeployment ? (
                    deploymentResult && deploymentResult.status !== "succeeded" ? (
                        <Button
                            icon={<ArrowLeft20Regular />}
                            onClick={() => {
                                setCloudPage("azure");
                                setDeploymentRequest(undefined);
                                setDeploymentResult(undefined);
                                setError(undefined);
                            }}>
                            {locConstants.common.previous}
                        </Button>
                    ) : undefined
                ) : (
                    <div className={classes.footer}>
                        <Button
                            icon={<ArrowLeft20Regular />}
                            onClick={() => {
                                if (showReview) {
                                    setCloudPage("azure");
                                } else if (showAzureForm) {
                                    setCloudPage(undefined);
                                } else if (validationRequest) {
                                    setValidationRequest(undefined);
                                    setValidationResult(undefined);
                                } else {
                                    onBack();
                                }
                            }}>
                            {locConstants.common.previous}
                        </Button>
                        <span
                            title={
                                validationRequest && !canContinueToAzure
                                    ? strings.compatibilityContinueBlocked
                                    : undefined
                            }>
                            <Button
                                appearance="primary"
                                disabled={
                                    showReview || showAzureForm
                                        ? !canContinueToReview
                                        : validationRequest
                                          ? !canContinueToAzure
                                          : !connectedSource?.isConnected
                                }
                                onClick={() => {
                                    if (showReview && canContinueToReview && validationRequest) {
                                        setDeploymentResult(undefined);
                                        setError(undefined);
                                        setDeploymentRequest({
                                            ...validationRequest,
                                            deploymentId: crypto.randomUUID(),
                                            target: {
                                                subscriptionId: azureState.formState.subscriptionId,
                                                resourceGroup: azureState.formState.resourceGroup,
                                                serverName: azureState.formState.serverName,
                                                databaseName: azureState.formState.databaseName,
                                            },
                                            tags: Object.fromEntries(
                                                tags
                                                    .filter((tag) => tag.key.trim())
                                                    .map((tag) => [tag.key.trim(), tag.value]),
                                            ),
                                        });
                                        setCloudPage("deploy");
                                    } else if (showAzureForm) {
                                        if (canContinueToReview) {
                                            setCloudPage("review");
                                        }
                                    } else if (validationRequest) {
                                        continueToAzure();
                                    } else {
                                        startCompatibility();
                                    }
                                }}
                                icon={<ArrowRight20Regular />}
                                iconPosition="after">
                                {showReview
                                    ? strings.createAndDeploy
                                    : showAzureForm
                                      ? locConstants.common.next
                                      : validationRequest
                                        ? strings.continueToAzure
                                        : strings.continueDeployment}
                            </Button>
                        </span>
                    </div>
                )
            }>
            {validationRequest && selectedSource ? (
                <>
                    {/* Keep validation mounted so navigating to Azure retains its package. */}
                    <div hidden={cloudPage !== undefined}>
                        <AzureSqlDatabaseCompatibilityPage
                            source={selectedSource}
                            request={validationRequest}
                            onResult={setValidationResult}
                            onRetry={startCompatibility}
                        />
                    </div>
                    {showAzureForm && isAzureFormReady && (
                        <AzureSqlDatabaseFormPage
                            tags={tags}
                            onTagsChange={setTags}
                            isLocalToCloud
                        />
                    )}
                    {showReview && azureState && validationResult && connectedSource && (
                        <AzureSqlDatabaseReviewPage
                            source={connectedSource}
                            result={validationResult}
                            azureState={azureState}
                        />
                    )}
                    {showDeployment && deploymentRequest && azureState && connectedSource && (
                        <AzureSqlDatabaseDeployPage
                            key={deploymentRequest.deploymentId}
                            request={deploymentRequest}
                            sourceDatabase={connectedSource.database}
                            onResult={setDeploymentResult}
                        />
                    )}
                </>
            ) : (
                <div className={classes.content}>
                    <div className={classes.introduction}>
                        <Text className={classes.description}>
                            {strings.deployToAzureSqlDescription}
                        </Text>
                        <Text as="h3" size={400} weight="semibold" className={classes.heading}>
                            {strings.selectLocalDatabase}
                        </Text>
                    </div>
                    <div className={classes.selector}>
                        <DatabaseSelector
                            connectionAction={
                                <Button
                                    icon={<ArrowClockwise20Regular />}
                                    aria-label={locConstants.common.refresh}
                                    disabled={loading}
                                    onClick={() => {
                                        clearSource();
                                        setRefresh((value) => value + 1);
                                    }}
                                />
                            }
                            connections={connectionOptions}
                            selectedConnection={{
                                value: selectedConnectionId,
                                text:
                                    selectedConnection?.profileName ||
                                    selectedConnection?.server ||
                                    "",
                            }}
                            databases={displayedDatabases.map((database) => ({
                                value: database,
                                displayName: database,
                            }))}
                            selectedDatabase={
                                selectedSource?.database || selectedConnection?.database || ""
                            }
                            isConnectionListLoading={loading || (!error && showDatabaseSpinner)}
                            connectionListError={error}
                            connectionListLoadingMessage={
                                loading
                                    ? strings.loadingLocalConnections
                                    : locConstants.dacpacDialog.loadingDatabases
                            }
                            isDatabaseListLoading={showDatabaseSpinner}
                            databaseListError={
                                databaseListError
                                    ? strings.localServerDatabasesLoadFailed(databaseListError)
                                    : ""
                            }
                            connectionTriggerRef={connectionTriggerRef}
                            onConnectionSelected={(option) => {
                                if (option.value === selectedConnectionId) {
                                    return;
                                }
                                setSelectedSource(undefined);
                                setConnectedSource(undefined);
                                setSourceConnectionError(undefined);
                                setDeploymentContent("schemaAndData");
                                setSelectedConnectionId(option.value);
                            }}
                            onDatabaseSelected={(database) => {
                                if (selectedConnection) {
                                    if (selectedSource?.database === database) {
                                        return;
                                    }
                                    setConnectedSource(undefined);
                                    setSourceConnectionError(undefined);
                                    setDeploymentContent("schemaAndData");
                                    setSelectedSource({ ...selectedConnection, database });
                                }
                            }}
                        />
                        {sourceConnectionError && (
                            <ErrorMessageDetails message={sourceConnectionError} />
                        )}
                    </div>
                    {!loading && !error && sources.length === 0 ? (
                        <Text role="status">{strings.noLocalConnections}</Text>
                    ) : !loading &&
                      !showDatabaseSpinner &&
                      !databaseListError &&
                      selectedConnection &&
                      displayedDatabases.length === 0 ? (
                        <Text role="status">{strings.noLocalServerDatabases}</Text>
                    ) : undefined}
                    {selectedSource && (
                        <AzureSqlDatabaseSourceDetails
                            key={JSON.stringify([selectedSource.id, selectedSource.database])}
                            source={selectedSource}
                            deploymentContent={deploymentContent}
                            onDeploymentContentChange={setDeploymentContent}
                            onConnectionChange={setConnectedSource}
                            onConnectionError={setSourceConnectionError}
                            onChange={() => {
                                clearSource();
                                requestAnimationFrame(() => connectionTriggerRef.current?.focus());
                            }}
                        />
                    )}
                </div>
            )}
        </WizardPageShell>
    );
};
