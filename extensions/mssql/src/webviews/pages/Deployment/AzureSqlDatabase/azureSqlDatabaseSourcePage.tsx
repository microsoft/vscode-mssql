/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    makeStyles,
    mergeClasses,
    SearchBox,
    Spinner,
    Text,
    tokens,
} from "@fluentui/react-components";
import {
    ArrowLeft20Regular,
    ArrowRight20Regular,
    ArrowClockwise20Regular,
    ChevronRight20Regular,
    Database20Regular,
    Checkmark20Regular,
} from "@fluentui/react-icons";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
import { DialogPageShell } from "../../../common/dialogPageShell";
import { AzureSqlDatabaseIcon } from "../../../common/icons/azureSqlDatabase";
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
    steps: {
        display: "flex",
        alignItems: "center",
        gap: "16px",
        listStyleType: "none",
        padding: "24px 0",
        margin: 0,
        overflowX: "auto",
    },
    step: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        whiteSpace: "nowrap",
        color: "var(--vscode-descriptionForeground)",
        flex: "1 0 auto",
        "::after": {
            content: '""',
            height: "1px",
            minWidth: "24px",
            flexGrow: 1,
            backgroundColor: tokens.colorNeutralStroke2,
        },
        ":last-child": {
            flexGrow: 0,
            "::after": { display: "none" },
        },
    },
    currentStep: {
        color: tokens.colorNeutralForeground1,
        fontWeight: tokens.fontWeightSemibold,
    },
    completedStep: {
        "::after": { backgroundColor: "var(--vscode-testing-iconPassed)" },
    },
    number: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "28px",
        height: "28px",
        borderRadius: "50%",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        boxSizing: "border-box",
        flexShrink: 0,
    },
    currentNumber: {
        backgroundColor: "var(--vscode-button-background)",
        color: "var(--vscode-button-foreground)",
        border: "1px solid var(--vscode-button-background)",
    },
    completedNumber: {
        color: "var(--vscode-testing-iconPassed)",
        border: "1px solid var(--vscode-testing-iconPassed)",
    },
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        maxWidth: "840px",
    },
    introduction: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    heading: { margin: 0 },
    description: {
        color: "var(--vscode-descriptionForeground)",
        lineHeight: "24px",
    },
    searchRow: {
        display: "flex",
        gap: "8px",
        width: "100%",
        maxWidth: "540px",
    },
    search: { flexGrow: 1, maxWidth: "unset" },
    list: {
        width: "100%",
        maxWidth: "680px",
        height: "min(360px, 42vh)",
        overflowY: "auto",
        scrollbarGutter: "stable",
        position: "relative",
    },
    card: {
        width: "100%",
        height: "64px",
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        gap: "16px",
        textAlign: "left",
        backgroundColor: tokens.colorNeutralBackground2,
        color: tokens.colorNeutralForeground1,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "8px",
        cursor: "pointer",
        boxSizing: "border-box",
        ":hover": { backgroundColor: tokens.colorNeutralBackground2Hover },
        ":focus-visible": { outline: "2px solid var(--vscode-focusBorder)", outlineOffset: "-2px" },
    },
    databaseIcon: { color: tokens.colorBrandForeground1, flexShrink: 0 },
    cardText: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, flexGrow: 1 },
    ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    secondary: { color: "var(--vscode-descriptionForeground)" },
    footer: { display: "flex", alignItems: "center", gap: "8px" },
});

export const AzureSqlDatabaseSourcePage = ({ onBack }: { onBack: () => void }) => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const { extensionRpc } = useVscodeWebview<DeploymentWebviewState, DeploymentReducers>();
    const [sources, setSources] = useState<LocalDatabaseSource[]>([]);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<string>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>();
    const [refresh, setRefresh] = useState(0);
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
    const scrollRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const strings = locConstants.azureSqlDatabase;
    const selectedSource = sources.find((source) => source.id === selectedId);
    const currentStep = showDeployment
        ? 4
        : showReview
          ? 3
          : showAzureForm
            ? 2
            : validationRequest
              ? 1
              : 0;
    const deploymentSucceeded = showDeployment && deploymentResult?.status === "succeeded";
    useEffect(() => {
        extensionRpc.sendActionEvent({
            telemetryView: TelemetryViews.LocalToCloudDeployment,
            telemetryAction: TelemetryActions.LocalToCloudWizardStep,
            additionalProps: {
                step: ["source", "compatibility", "azure", "review", "deploy"][currentStep],
            },
        });
    }, [extensionRpc, currentStep]);
    const lastCompletedStep = deploymentSucceeded ? currentStep : currentStep - 1;
    const canContinueToAzure =
        !!validationRequest &&
        validationResult?.validationId === validationRequest.validationId &&
        (validationResult.status === "passed" || validationResult.status === "warnings");
    const canContinueToReview =
        canContinueToAzure &&
        isAzureFormReady &&
        !!azureState.formState.accountId &&
        azureState.formValidationLoadState !== ApiStatus.Loading &&
        isAzureSqlFormValid(
            azureState.loadState,
            azureState.formState,
            azureState.formComponents,
            azureState.serverCreatedWithAuth,
            azureState,
        ) &&
        !hasDuplicateTagKeys(tags);
    const canDeploy = canContinueToReview;
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
                sourceId: selectedSource.id,
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
                    setSources(connections);
                    setSelectedId((id) =>
                        connections.some((connection) => connection.id === id) ? id : undefined,
                    );
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

    const filtered = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        return sources.filter((source) =>
            [source.database, source.profileName, source.server].some((value) =>
                value.toLocaleLowerCase().includes(query),
            ),
        );
    }, [sources, search]);
    const virtualizer = useVirtualizer({
        count: filtered.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 76,
        getItemKey: (index) => filtered[index].id,
        overscan: 4,
    });
    const steps = [
        strings.sourceStep,
        strings.compatibilityStep,
        strings.azureStep,
        strings.reviewStep,
        strings.deployStep,
    ];

    return (
        <DialogPageShell
            spacious
            stickyHeader
            icon={<AzureSqlDatabaseIcon aria-hidden="true" />}
            title={
                validationRequest && selectedSource
                    ? strings.deployDatabaseToAzure(selectedSource.database)
                    : strings.deployToAzureSql
            }
            subtitle={<span className={classes.secondary}>{strings.deployToAzureSqlSubtitle}</span>}
            showHeaderDivider={false}
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
            headerBottom={
                <ol className={classes.steps} aria-label={strings.deploymentSteps}>
                    {steps.map((step, index) => (
                        <li
                            key={step}
                            className={mergeClasses(
                                classes.step,
                                index <= lastCompletedStep && classes.completedStep,
                                index === currentStep &&
                                    !deploymentSucceeded &&
                                    classes.currentStep,
                            )}
                            aria-current={
                                index === currentStep && !deploymentSucceeded ? "step" : undefined
                            }>
                            <span
                                className={mergeClasses(
                                    classes.number,
                                    index === currentStep &&
                                        !deploymentSucceeded &&
                                        classes.currentNumber,
                                    index <= lastCompletedStep && classes.completedNumber,
                                )}>
                                {index <= lastCompletedStep ? (
                                    <Checkmark20Regular aria-hidden />
                                ) : (
                                    index + 1
                                )}
                            </span>
                            {step}
                        </li>
                    ))}
                </ol>
            }
            footerStart={
                <Button onClick={cancelOrClose} disabled={cancelling}>
                    {cancelling ? strings.deploymentCancelling : locConstants.common.cancel}
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
                                    showReview
                                        ? !canDeploy
                                        : showAzureForm
                                          ? !canContinueToReview
                                          : validationRequest
                                            ? !canContinueToAzure
                                            : !connectedSource?.isConnected
                                }
                                onClick={() => {
                                    if (showReview && canDeploy && validationRequest) {
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
                        <AzureSqlDatabaseFormPage tags={tags} onTagsChange={setTags} />
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
                        <Text as="h2" size={400} weight="semibold" className={classes.heading}>
                            {strings.deployToAzureSql}
                        </Text>
                        <Text className={classes.description}>
                            {strings.deployToAzureSqlDescription}
                        </Text>
                        {!selectedSource && (
                            <Text
                                as="h3"
                                size={300}
                                weight="semibold"
                                id="local-database-heading"
                                className={classes.heading}>
                                {strings.selectLocalDatabase}
                            </Text>
                        )}
                    </div>
                    {selectedSource ? (
                        <AzureSqlDatabaseSourceDetails
                            key={selectedSource.id}
                            source={selectedSource}
                            deploymentContent={deploymentContent}
                            onDeploymentContentChange={setDeploymentContent}
                            onConnectionChange={setConnectedSource}
                            onChange={() => {
                                setSelectedId(undefined);
                                setConnectedSource(undefined);
                                requestAnimationFrame(() => searchInputRef.current?.focus());
                            }}
                        />
                    ) : (
                        <>
                            <div className={classes.searchRow}>
                                <SearchBox
                                    input={{ ref: searchInputRef }}
                                    className={classes.search}
                                    aria-label={strings.searchLocalConnections}
                                    placeholder={strings.searchLocalConnections}
                                    value={search}
                                    onChange={(_, data) => {
                                        setSearch(data.value);
                                        virtualizer.scrollToOffset(0);
                                    }}
                                />
                                <Button
                                    icon={<ArrowClockwise20Regular />}
                                    aria-label={locConstants.common.refresh}
                                    disabled={loading}
                                    onClick={() => setRefresh((value) => value + 1)}
                                />
                            </div>
                            {loading ? (
                                <Spinner label={strings.loadingLocalConnections} size="small" />
                            ) : !error && filtered.length === 0 ? (
                                <Text role="status">
                                    {sources.length === 0
                                        ? strings.noLocalConnections
                                        : strings.noMatchingLocalConnections}
                                </Text>
                            ) : !error ? (
                                <div
                                    ref={scrollRef}
                                    className={classes.list}
                                    role="group"
                                    aria-labelledby="local-database-heading">
                                    <div
                                        style={{
                                            height: virtualizer.getTotalSize(),
                                            position: "relative",
                                        }}>
                                        {virtualizer.getVirtualItems().map((item) => {
                                            const source = filtered[item.index];
                                            return (
                                                <div
                                                    key={source.id}
                                                    style={{
                                                        position: "absolute",
                                                        top: 0,
                                                        left: 0,
                                                        width: "100%",
                                                        transform: `translateY(${item.start}px)`,
                                                    }}>
                                                    <button
                                                        type="button"
                                                        data-index={item.index}
                                                        className={classes.card}
                                                        onClick={() => {
                                                            setConnectedSource(undefined);
                                                            setDeploymentContent("schemaAndData");
                                                            setSelectedId(source.id);
                                                        }}
                                                        onKeyDown={(event) => {
                                                            const nextIndex =
                                                                event.key === "ArrowDown"
                                                                    ? Math.min(
                                                                          item.index + 1,
                                                                          filtered.length - 1,
                                                                      )
                                                                    : event.key === "ArrowUp"
                                                                      ? Math.max(item.index - 1, 0)
                                                                      : event.key === "Home"
                                                                        ? 0
                                                                        : event.key === "End"
                                                                          ? filtered.length - 1
                                                                          : undefined;
                                                            if (nextIndex === undefined) {
                                                                return;
                                                            }
                                                            event.preventDefault();
                                                            virtualizer.scrollToIndex(nextIndex);
                                                            requestAnimationFrame(() => {
                                                                scrollRef.current
                                                                    ?.querySelector<HTMLButtonElement>(
                                                                        `[data-index="${nextIndex}"]`,
                                                                    )
                                                                    ?.focus();
                                                            });
                                                        }}>
                                                        <Database20Regular
                                                            className={classes.databaseIcon}
                                                        />
                                                        <span className={classes.cardText}>
                                                            <Text
                                                                weight="semibold"
                                                                className={classes.ellipsis}>
                                                                {source.database}
                                                            </Text>
                                                            <Text
                                                                className={mergeClasses(
                                                                    classes.ellipsis,
                                                                    classes.secondary,
                                                                )}>
                                                                {source.profileName
                                                                    ? strings.localConnectionDetails(
                                                                          source.profileName,
                                                                          source.server.replace(
                                                                              /,\s*/,
                                                                              ", ",
                                                                          ),
                                                                      )
                                                                    : source.server}
                                                            </Text>
                                                        </span>
                                                        <ChevronRight20Regular aria-hidden="true" />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : undefined}
                        </>
                    )}
                </div>
            )}
        </DialogPageShell>
    );
};
