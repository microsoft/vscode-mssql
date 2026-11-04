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
    ChevronRight16Regular,
    ChevronDown16Regular,
    Database20Regular,
    Server20Regular,
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
import { WizardPageShell } from "../../../common/wizardPageShell";
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
        maxWidth: "680px",
    },
    search: { flexGrow: 1, maxWidth: "unset" },
    list: {
        width: "100%",
        maxWidth: "680px",
        height: "min(360px, 42vh)",
        overflowY: "auto",
        scrollbarGutter: "stable",
        position: "relative",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "6px",
        padding: "4px",
        boxSizing: "border-box",
    },
    card: {
        width: "100%",
        height: "48px",
        padding: "6px 10px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        textAlign: "left",
        backgroundColor: "transparent",
        color: tokens.colorNeutralForeground1,
        border: "none",
        borderRadius: "4px",
        cursor: "pointer",
        boxSizing: "border-box",
        ":hover": { backgroundColor: tokens.colorNeutralBackground2Hover },
        ":focus-visible": { outline: "2px solid var(--vscode-focusBorder)", outlineOffset: "-2px" },
    },
    databaseIcon: { color: tokens.colorBrandForeground1, flexShrink: 0 },
    cardText: { display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1 },
    cardTitle: { fontSize: "13px", lineHeight: "18px" },
    cardSubtitle: { fontSize: "12px", lineHeight: "16px" },
    expander: {
        display: "flex",
        alignItems: "center",
        width: "16px",
        flexShrink: 0,
        color: tokens.colorNeutralForeground3,
    },
    childCard: { marginLeft: "32px", width: "calc(100% - 32px)", height: "32px" },
    childRow: {
        "::before": {
            content: '""',
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "18px",
            borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
        },
    },
    serverStatus: { display: "block", padding: "6px 10px 6px 64px" },
    ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    secondary: { color: "var(--vscode-descriptionForeground)" },
    footer: { display: "flex", alignItems: "center", gap: "8px" },
});

interface LocalServerDatabases {
    expanded: boolean;
    loading: boolean;
    databases?: string[];
    error?: string;
}

interface LocalSourceRow {
    key: string;
    source: LocalDatabaseSource;
    isChild: boolean;
}

export const AzureSqlDatabaseSourcePage = ({ onBack }: { onBack: () => void }) => {
    const classes = useStyles();
    const context = useContext(DeploymentContext);
    const { extensionRpc } = useVscodeWebview<DeploymentWebviewState, DeploymentReducers>();
    const [sources, setSources] = useState<LocalDatabaseSource[]>([]);
    const [search, setSearch] = useState("");
    const [selectedSource, setSelectedSource] = useState<LocalDatabaseSource>();
    const [serverDatabases, setServerDatabases] = useState<Record<string, LocalServerDatabases>>(
        {},
    );
    const sourcesGeneration = useRef(0);
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
                sourceId: connectedSource.id,
                deploymentContent,
            });
        }
    };

    useEffect(() => {
        let cancelled = false;
        sourcesGeneration.current++;
        setServerDatabases({});
        setLoading(true);
        setError(undefined);
        void extensionRpc
            .sendRequest(AzureSqlDatabaseRequests.GetLocalDatabaseSources)
            .then((connections) => {
                if (!cancelled) {
                    setSources(connections);
                    setSelectedSource((source) =>
                        connections.some((connection) => connection.id === source?.id)
                            ? source
                            : undefined,
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
            sourcesGeneration.current++;
        };
    }, [extensionRpc, refresh]);

    const toggleServer = (source: LocalDatabaseSource) => {
        const current = serverDatabases[source.id];
        setServerDatabases((previous) => ({
            ...previous,
            [source.id]: {
                ...previous[source.id],
                expanded: !current?.expanded,
                loading: current?.loading ?? false,
            },
        }));
        if (current?.expanded || current?.loading || current?.databases) {
            return;
        }
        const generation = sourcesGeneration.current;
        setServerDatabases((previous) => ({
            ...previous,
            [source.id]: { expanded: true, loading: true },
        }));
        void extensionRpc
            .sendRequest(AzureSqlDatabaseRequests.GetLocalServerDatabases, { id: source.id })
            .then((databases) => {
                if (sourcesGeneration.current === generation) {
                    setServerDatabases((previous) => ({
                        ...previous,
                        [source.id]: { ...previous[source.id], loading: false, databases },
                    }));
                }
            })
            .catch((failure) => {
                extensionRpc.log.error("Failed to load local server databases", failure);
                if (sourcesGeneration.current === generation) {
                    setServerDatabases((previous) => ({
                        ...previous,
                        [source.id]: {
                            ...previous[source.id],
                            loading: false,
                            error: failure instanceof Error ? failure.message : String(failure),
                        },
                    }));
                }
            });
    };

    const filtered = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        const rows: LocalSourceRow[] = [];
        for (const source of sources) {
            const matches = [source.database, source.profileName, source.server].some((value) =>
                value.toLocaleLowerCase().includes(query),
            );
            const server = !source.database ? serverDatabases[source.id] : undefined;
            const databases = (server?.databases ?? []).filter(
                (database) => matches || database.toLocaleLowerCase().includes(query),
            );
            if (!matches && databases.length === 0) {
                continue;
            }
            rows.push({ key: source.id, source, isChild: false });
            if (server?.expanded) {
                for (const database of databases) {
                    rows.push({
                        key: JSON.stringify([source.id, database]),
                        source: { ...source, database },
                        isChild: true,
                    });
                }
            }
        }
        return rows;
    }, [sources, search, serverDatabases]);
    const virtualizer = useVirtualizer({
        count: filtered.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: (index) => (filtered[index].isChild ? 34 : 50),
        getItemKey: (index) => filtered[index].key,
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
        <WizardPageShell
            icon={<AzureSqlDatabaseIcon aria-hidden="true" />}
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
                            key={JSON.stringify([selectedSource.id, selectedSource.database])}
                            source={selectedSource}
                            deploymentContent={deploymentContent}
                            onDeploymentContentChange={setDeploymentContent}
                            onConnectionChange={setConnectedSource}
                            onChange={() => {
                                setSelectedSource(undefined);
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
                                            const row = filtered[item.index];
                                            const { source } = row;
                                            const server = !source.database
                                                ? serverDatabases[source.id]
                                                : undefined;
                                            return (
                                                <div
                                                    key={row.key}
                                                    ref={virtualizer.measureElement}
                                                    data-index={item.index}
                                                    className={
                                                        row.isChild ? classes.childRow : undefined
                                                    }
                                                    style={{
                                                        position: "absolute",
                                                        top: 0,
                                                        left: 0,
                                                        width: "100%",
                                                        paddingBottom: "2px",
                                                        boxSizing: "border-box",
                                                        transform: `translateY(${item.start}px)`,
                                                    }}>
                                                    <button
                                                        type="button"
                                                        data-index={item.index}
                                                        className={mergeClasses(
                                                            classes.card,
                                                            row.isChild && classes.childCard,
                                                        )}
                                                        aria-expanded={
                                                            !source.database
                                                                ? (server?.expanded ?? false)
                                                                : undefined
                                                        }
                                                        onClick={() => {
                                                            if (!source.database) {
                                                                toggleServer(source);
                                                                return;
                                                            }
                                                            setConnectedSource(undefined);
                                                            setDeploymentContent("schemaAndData");
                                                            setSelectedSource(source);
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
                                                        <span
                                                            className={classes.expander}
                                                            aria-hidden="true">
                                                            {!source.database &&
                                                                (server?.expanded ? (
                                                                    <ChevronDown16Regular />
                                                                ) : (
                                                                    <ChevronRight16Regular />
                                                                ))}
                                                        </span>
                                                        {source.database ? (
                                                            <Database20Regular
                                                                className={classes.databaseIcon}
                                                                aria-hidden="true"
                                                            />
                                                        ) : (
                                                            <Server20Regular
                                                                className={classes.databaseIcon}
                                                                aria-hidden="true"
                                                            />
                                                        )}
                                                        <span className={classes.cardText}>
                                                            <Text
                                                                weight={
                                                                    row.isChild
                                                                        ? "regular"
                                                                        : "semibold"
                                                                }
                                                                className={mergeClasses(
                                                                    classes.ellipsis,
                                                                    classes.cardTitle,
                                                                )}>
                                                                {source.database ||
                                                                    source.profileName ||
                                                                    source.server}
                                                            </Text>
                                                            {!row.isChild && (
                                                                <Text
                                                                    className={mergeClasses(
                                                                        classes.ellipsis,
                                                                        classes.secondary,
                                                                        classes.cardSubtitle,
                                                                    )}>
                                                                    {source.database &&
                                                                    source.profileName
                                                                        ? strings.localConnectionDetails(
                                                                              source.profileName,
                                                                              source.server.replace(
                                                                                  /,\s*/,
                                                                                  ", ",
                                                                              ),
                                                                          )
                                                                        : source.server}
                                                                </Text>
                                                            )}
                                                        </span>
                                                        {source.database && (
                                                            <ChevronRight16Regular
                                                                className={classes.secondary}
                                                                aria-hidden="true"
                                                            />
                                                        )}
                                                    </button>
                                                    {server?.expanded &&
                                                        (server.loading ? (
                                                            <Spinner
                                                                size="tiny"
                                                                label={
                                                                    strings.loadingLocalServerDatabases
                                                                }
                                                                className={classes.serverStatus}
                                                            />
                                                        ) : server.error ? (
                                                            <Text
                                                                role="alert"
                                                                className={classes.serverStatus}>
                                                                {strings.localServerDatabasesLoadFailed(
                                                                    server.error,
                                                                )}
                                                            </Text>
                                                        ) : server.databases?.length === 0 ? (
                                                            <Text
                                                                role="status"
                                                                className={classes.serverStatus}>
                                                                {strings.noLocalServerDatabases}
                                                            </Text>
                                                        ) : undefined)}
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
        </WizardPageShell>
    );
};
