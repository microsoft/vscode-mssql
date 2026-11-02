/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
    Button,
    Link,
    makeStyles,
    mergeClasses,
    Spinner,
    Text,
    tokens,
} from "@fluentui/react-components";
import {
    CheckmarkCircle24Regular,
    DismissCircle24Regular,
    Warning24Regular,
    Checkmark20Regular,
    Circle20Regular,
} from "@fluentui/react-icons";
import {
    AzureSqlDatabaseRequests,
    LocalDatabaseCompatibilityRequest,
    LocalDatabaseCompatibilityResult,
    LocalDatabaseCompatibilityStage,
    LocalDatabaseSource,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import {
    DeploymentReducers,
    DeploymentWebviewState,
} from "../../../../sharedInterfaces/deployment";
import { locConstants } from "../../../common/locConstants";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { AzureSqlDatabaseCompatibilityDiagnosticsGrid } from "./azureSqlDatabaseCompatibilityDiagnosticsGrid";

const useStyles = makeStyles({
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        maxWidth: "840px",
        minWidth: 0,
        width: "100%",
    },
    heading: { margin: 0 },
    secondary: { color: "var(--vscode-descriptionForeground)", lineHeight: "24px" },
    databaseName: {
        fontFamily: "var(--vscode-editor-font-family), monospace",
        fontWeight: tokens.fontWeightBold,
    },
    card: {
        width: "100%",
        maxWidth: "640px",
        minWidth: 0,
        boxSizing: "border-box",
        border: "1px solid color-mix(in srgb, var(--vscode-testing-iconPassed) 40%, var(--vscode-editor-background))",
        borderRadius: "12px",
        padding: "16px",
        backgroundColor:
            "color-mix(in srgb, var(--vscode-testing-iconPassed) 8%, var(--vscode-editor-background))",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    warning: {
        border: "1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground) 40%, var(--vscode-editor-background))",
        backgroundColor:
            "color-mix(in srgb, var(--vscode-editorWarning-foreground) 8%, var(--vscode-editor-background))",
    },
    failure: {
        maxWidth: "760px",
        padding: "20px",
        gap: "12px",
        border: "1px solid color-mix(in srgb, var(--vscode-errorForeground) 40%, var(--vscode-editor-background))",
        backgroundColor:
            "color-mix(in srgb, var(--vscode-errorForeground) 8%, var(--vscode-editor-background))",
    },
    title: { display: "flex", alignItems: "flex-start", gap: "16px" },
    statusIcon: { flexShrink: 0 },
    cardBody: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        marginLeft: "40px",
        minWidth: 0,
        color: tokens.colorNeutralForeground2,
        lineHeight: "24px",
    },
    passedIcon: { color: "var(--vscode-testing-iconPassed)" },
    successCardBody: { gap: "12px" },
    warningIcon: { color: "var(--vscode-editorWarning-foreground)" },
    failedIcon: { color: "var(--vscode-errorForeground)" },
    fields: {
        display: "grid",
        gridTemplateColumns: "minmax(110px, 160px) minmax(0, 1fr)",
        gap: "8px 12px",
        margin: 0,
        "& dt": { color: "var(--vscode-descriptionForeground)" },
        "& dd": { margin: 0 },
    },
    validationFields: {
        display: "grid",
        gridTemplateColumns: "minmax(110px, 160px) minmax(0, 1fr)",
        gap: "6px 16px",
        margin: 0,
        "& dt": { color: "var(--vscode-descriptionForeground)" },
        "& dd": { margin: 0, minWidth: 0, overflowWrap: "anywhere" },
    },
    validationDetailsCard: {
        width: "100%",
        maxWidth: "640px",
        minWidth: 0,
        boxSizing: "border-box",
        padding: "16px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "12px",
        backgroundColor:
            "color-mix(in srgb, var(--vscode-editor-foreground) 4%, var(--vscode-editor-background))",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        lineHeight: "24px",
    },
    validationDetailsTitle: {
        margin: 0,
        color: "var(--vscode-descriptionForeground)",
        textTransform: "uppercase",
    },
    detailsToggle: {
        alignSelf: "flex-start",
    },
    actions: { display: "flex", gap: "18px", flexWrap: "wrap" },
    loadingCard: {
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        width: "100%",
        maxWidth: "690px",
        boxSizing: "border-box",
        padding: "24px 28px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "8px",
        backgroundColor: tokens.colorNeutralBackground2,
    },
    progressSteps: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        listStyleType: "none",
        margin: 0,
        padding: 0,
    },
    progressStep: { display: "flex", alignItems: "center", gap: "16px" },
    progressIcon: { width: "20px", height: "20px", flexShrink: 0 },
    pendingStep: { color: tokens.colorNeutralForegroundDisabled },
    activeStep: { fontWeight: tokens.fontWeightSemibold },
});

export const AzureSqlDatabaseCompatibilityPage = ({
    source,
    request,
    onResult,
    onRetry,
}: {
    source: LocalDatabaseSource;
    request: LocalDatabaseCompatibilityRequest;
    onResult: (result: LocalDatabaseCompatibilityResult | undefined) => void;
    onRetry: () => void;
}) => {
    const classes = useStyles();
    const strings = locConstants.azureSqlDatabase;
    const { extensionRpc } = useVscodeWebview<DeploymentWebviewState, DeploymentReducers>();
    const [result, setResult] = useState<LocalDatabaseCompatibilityResult>();
    const [error, setError] = useState<string>();
    const [showDetails, setShowDetails] = useState(false);
    const detailsId = useId();
    const [stage, setStage] = useState<LocalDatabaseCompatibilityStage>("extractingSchema");
    const heading = useRef<HTMLHeadingElement>(null);
    const diagnostics = result?.diagnostics ?? [];
    const warningDiagnostics = useMemo(
        () => result?.diagnostics.filter((diagnostic) => diagnostic.severity === "warning") ?? [],
        [result],
    );
    const success = result?.status === "passed" || result?.status === "warnings";
    const blocked = result?.status === "blocked";

    useEffect(() => {
        let cancelled = false;
        heading.current?.focus({ preventScroll: true });
        setResult(undefined);
        setError(undefined);
        setShowDetails(false);
        setStage("extractingSchema");
        onResult(undefined);
        const progressSubscription = extensionRpc.onNotification(
            AzureSqlDatabaseRequests.LocalDatabaseCompatibilityProgress,
            (progress) => {
                if (!cancelled && progress.validationId === request.validationId) {
                    setStage(progress.stage);
                }
            },
        );
        void extensionRpc
            .sendRequest(AzureSqlDatabaseRequests.ValidateLocalDatabaseCompatibility, request)
            .then((validation) => {
                if (!cancelled) {
                    setResult(validation);
                    onResult(validation);
                }
            })
            .catch((failure) => {
                extensionRpc.log.error("Azure SQL compatibility request failed", failure);
                if (!cancelled) {
                    setError(failure instanceof Error ? failure.message : String(failure));
                }
            });
        return () => {
            cancelled = true;
            progressSubscription.dispose();
            void extensionRpc
                .sendRequest(AzureSqlDatabaseRequests.CancelLocalDatabaseCompatibility, {
                    validationId: request.validationId,
                })
                .catch((failure) =>
                    extensionRpc.log.error("Failed to cancel compatibility validation", failure),
                );
        };
    }, [extensionRpc, request, onResult]);

    const warning = result?.status === "warnings";
    const loading = !result && !error;
    const progressSteps: { stage: LocalDatabaseCompatibilityStage; label: string }[] = [
        { stage: "extractingSchema", label: strings.compatibilityExtractingSchema },
        { stage: "validatingSchema", label: strings.compatibilityValidatingSchema },
        { stage: "checkingPackage", label: strings.compatibilityCheckingPackage },
    ];
    const currentStage = progressSteps.findIndex((step) => step.stage === stage);
    const title = success
        ? warning
            ? strings.compatibilityWarnings(warningDiagnostics.length)
            : strings.compatibilityPassed
        : result?.status === "blocked"
          ? strings.compatibilityBlocked
          : result?.status === "cancelled"
            ? strings.compatibilityCancelled
            : strings.compatibilityFailed;
    const openOutput = () => {
        void extensionRpc
            .sendRequest(AzureSqlDatabaseRequests.ShowLocalDatabaseCompatibilityOutput)
            .catch((failure) =>
                extensionRpc.log.error("Failed to open compatibility output", failure),
            );
    };
    const renderDatabaseName = (message: string) =>
        message.split(/(\{0\})/g).map((part, index) =>
            part === "{0}" ? (
                <strong key={index} className={classes.databaseName}>
                    {source.database}
                </strong>
            ) : (
                part
            ),
        );

    return (
        <div className={classes.content}>
            <Text
                as="h2"
                size={400}
                weight="semibold"
                className={classes.heading}
                ref={heading}
                tabIndex={-1}>
                {strings.checkAzureCompatibility}
            </Text>
            <Text className={classes.secondary}>
                {renderDatabaseName(strings.compatibilityDescription("{0}"))}
            </Text>
            {loading ? (
                <div className={classes.loadingCard} role="status" aria-live="polite">
                    <Text weight="semibold">{strings.compatibilityChecking}</Text>
                    <ol
                        className={classes.progressSteps}
                        aria-label={strings.compatibilityChecking}>
                        {progressSteps.map((step, index) => (
                            <li
                                key={step.stage}
                                aria-current={index === currentStage ? "step" : undefined}
                                className={mergeClasses(
                                    classes.progressStep,
                                    index > currentStage && classes.pendingStep,
                                    index === currentStage && classes.activeStep,
                                )}>
                                {index < currentStage ? (
                                    <Checkmark20Regular
                                        className={mergeClasses(
                                            classes.progressIcon,
                                            classes.passedIcon,
                                        )}
                                        aria-hidden
                                    />
                                ) : index === currentStage ? (
                                    <Spinner
                                        size="tiny"
                                        className={classes.progressIcon}
                                        aria-hidden
                                    />
                                ) : (
                                    <Circle20Regular className={classes.progressIcon} aria-hidden />
                                )}
                                <span>{step.label}</span>
                            </li>
                        ))}
                    </ol>
                    <Text size={200} className={classes.secondary}>
                        {strings.compatibilityPrerequisites}
                    </Text>
                </div>
            ) : (
                <section
                    aria-label={strings.compatibilityResult}
                    className={mergeClasses(
                        classes.card,
                        warning && classes.warning,
                        !success && classes.failure,
                    )}>
                    <div className={classes.title} role="status">
                        {success ? (
                            warning ? (
                                <Warning24Regular
                                    className={mergeClasses(
                                        classes.statusIcon,
                                        classes.warningIcon,
                                    )}
                                    aria-hidden
                                />
                            ) : (
                                <CheckmarkCircle24Regular
                                    className={mergeClasses(classes.statusIcon, classes.passedIcon)}
                                    aria-hidden
                                />
                            )
                        ) : (
                            <DismissCircle24Regular
                                className={mergeClasses(classes.statusIcon, classes.failedIcon)}
                                aria-hidden
                            />
                        )}
                        <Text size={400} weight="semibold">
                            {title}
                        </Text>
                    </div>
                    <div
                        className={mergeClasses(
                            classes.cardBody,
                            success && classes.successCardBody,
                        )}>
                        <Text>
                            {warning
                                ? renderDatabaseName(
                                      strings.compatibilityWarningDescription(
                                          "{0}",
                                          warningDiagnostics.length,
                                      ),
                                  )
                                : success
                                  ? renderDatabaseName(
                                        strings.compatibilitySuccessDescription("{0}"),
                                    )
                                  : blocked
                                    ? strings.compatibilityBlockedDescription(source.database)
                                    : error ||
                                      result?.errorMessage ||
                                      strings.compatibilityRetryDescription}
                        </Text>
                        {success && !warning && (
                            <dl className={classes.fields}>
                                <dt>{strings.compatibilitySchemaPackage}</dt>
                                <dd>{strings.compatibilityPackagePassed}</dd>
                                <dt>{strings.compatibilityTarget}</dt>
                                <dd>{strings.compatibilitySupported}</dd>
                                <dt>{strings.compatibilityObjects}</dt>
                                <dd>
                                    {result?.objectsValidated ?? strings.sourceVersionUnavailable}
                                </dd>
                            </dl>
                        )}
                        {!success && diagnostics.length > 0 && (
                            <AzureSqlDatabaseCompatibilityDiagnosticsGrid
                                diagnostics={diagnostics}
                            />
                        )}
                        {warning && warningDiagnostics.length > 0 && (
                            <AzureSqlDatabaseCompatibilityDiagnosticsGrid
                                diagnostics={warningDiagnostics}
                                variant="warning"
                            />
                        )}
                        {success ? (
                            <Link
                                as="button"
                                className={classes.detailsToggle}
                                onClick={() => setShowDetails((shown) => !shown)}
                                aria-controls={detailsId}
                                aria-expanded={showDetails}>
                                {showDetails
                                    ? strings.hideCompatibilityDetails
                                    : strings.viewCompatibilityDetails}
                            </Link>
                        ) : (
                            <div className={classes.actions}>
                                <Button appearance="outline" onClick={openOutput}>
                                    {strings.openCompatibilityOutput}
                                </Button>
                                <Button appearance="outline" onClick={onRetry}>
                                    {strings.retryCompatibility}
                                </Button>
                            </div>
                        )}
                    </div>
                </section>
            )}
            {success && showDetails && result && (
                <section
                    id={detailsId}
                    aria-label={strings.compatibilityValidationDetails}
                    className={classes.validationDetailsCard}>
                    <Text as="h3" weight="semibold" className={classes.validationDetailsTitle}>
                        {strings.compatibilityValidationDetails}
                    </Text>
                    <dl className={classes.validationFields}>
                        <dt>{strings.compatibilitySource}</dt>
                        <dd className={classes.databaseName}>
                            {strings.compatibilityCurrentSchema}
                        </dd>
                        <dt>{strings.compatibilityPackage}</dt>
                        <dd>{strings.compatibilityPackageSucceeded}</dd>
                        <dt>{strings.compatibilityTargetPlatform}</dt>
                        <dd>{strings.compatibilityAzureSqlDatabase}</dd>
                        <dt>{strings.compatibilityDacpac}</dt>
                        <dd className={classes.databaseName}>
                            {result.packageFileName ?? strings.sourceVersionUnavailable}
                        </dd>
                        <dt>{strings.compatibilityObjects}</dt>
                        <dd>
                            {result.objectsValidated?.toLocaleString() ??
                                strings.sourceVersionUnavailable}
                        </dd>
                        <dt>{strings.compatibilityReferences}</dt>
                        <dd>
                            {diagnostics.some((diagnostic) => diagnostic.category === "dependency")
                                ? strings.compatibilityReferencesUnresolved
                                : strings.compatibilityReferencesResolved}
                        </dd>
                        <dt>{strings.compatibilitySqlCodeAnalysis}</dt>
                        <dd>
                            {warning
                                ? strings.compatibilityWarningCount(warningDiagnostics.length)
                                : strings.compatibilityCodeCompatible}
                        </dd>
                    </dl>
                    <div className={classes.actions}>
                        <Button appearance="outline" onClick={openOutput}>
                            {strings.openCompatibilityOutput}
                        </Button>
                    </div>
                </section>
            )}
            {!loading && blocked && (
                <Text className={classes.secondary}>{strings.compatibilityUpdateSource}</Text>
            )}
        </div>
    );
};
