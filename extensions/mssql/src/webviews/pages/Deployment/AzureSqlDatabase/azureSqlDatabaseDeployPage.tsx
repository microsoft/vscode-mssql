/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from "react";
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
    Checkmark20Regular,
    Circle20Regular,
    DismissCircle20Regular,
    CopyRegular,
    OpenRegular,
} from "@fluentui/react-icons";
import {
    AzureSqlDatabaseRequests,
    LocalDatabaseDeploymentProgress,
    LocalDatabaseDeploymentRequest,
    LocalDatabaseDeploymentResult,
    LocalDatabaseDeploymentStage,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import {
    DeploymentReducers,
    DeploymentWebviewState,
} from "../../../../sharedInterfaces/deployment";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { locConstants } from "../../../common/locConstants";
import { DeploymentScriptsCard } from "../deploymentScriptsCard";
import {
    generateAzureSqlDatabaseArm,
    generateAzureSqlDatabaseBicep,
    generateAzureSqlDatabaseTerraform,
} from "../deploymentScripts";

const useStyles = makeStyles({
    content: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "760px" },
    heading: { margin: 0, lineHeight: "28px" },
    secondary: { color: "var(--vscode-descriptionForeground)", lineHeight: "20px" },
    card: {
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "8px",
        padding: "16px",
        backgroundColor: "var(--vscode-editor-background)",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
    },
    success: {
        backgroundColor:
            "color-mix(in srgb, var(--vscode-editorGutter-addedBackground) 15%, var(--vscode-editor-background))",
    },
    successHeading: { display: "flex", alignItems: "center", gap: "10px" },
    passed: { color: "var(--vscode-testing-iconPassed)" },
    error: {
        color: "var(--vscode-errorForeground)",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
    },
    steps: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        listStyleType: "none",
        padding: 0,
        margin: 0,
    },
    step: { display: "flex", alignItems: "center", gap: "12px", minHeight: "24px" },
    active: { fontWeight: tokens.fontWeightSemibold },
    pending: { color: "var(--vscode-descriptionForeground)" },
    icon: { flexShrink: 0, width: "24px" },
    metadata: { margin: 0, display: "flex", flexDirection: "column" },
    row: {
        display: "grid",
        gridTemplateColumns: "120px minmax(0, 1fr)",
        gap: "12px",
        padding: "8px 0",
        "@media (max-width: 480px)": { gridTemplateColumns: "minmax(0, 1fr)", gap: "4px" },
    },
    value: { margin: 0, overflowWrap: "anywhere" },
    sql: { fontFamily: "var(--vscode-editor-font-family), monospace" },
    actions: { display: "flex", flexWrap: "wrap", gap: "12px" },
});

export const AzureSqlDatabaseDeployPage = ({
    request,
    sourceDatabase,
    onResult,
}: {
    request: LocalDatabaseDeploymentRequest;
    sourceDatabase: string;
    onResult: (result: LocalDatabaseDeploymentResult) => void;
}) => {
    const classes = useStyles();
    const strings = locConstants.azureSqlDatabase;
    const databaseName = request.target.databaseName;
    const { extensionRpc } = useVscodeWebview<DeploymentWebviewState, DeploymentReducers>();
    const [progress, setProgress] = useState<LocalDatabaseDeploymentProgress>({
        deploymentId: request.deploymentId,
        stage: "authenticating",
        completedStages: [],
    });
    const [result, setResult] = useState<LocalDatabaseDeploymentResult>();
    const [actionPending, setActionPending] = useState(false);
    const [actionError, setActionError] = useState<string>();
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        let disposed = false;
        const frame = requestAnimationFrame(() => heading.current?.focus());
        const subscription = extensionRpc.onNotification(
            AzureSqlDatabaseRequests.LocalDatabaseDeploymentProgress,
            (value) => {
                if (!disposed && value.deploymentId === request.deploymentId) {
                    setProgress(value);
                }
            },
        );
        const finish = (value: LocalDatabaseDeploymentResult) => {
            if (!disposed && value.deploymentId === request.deploymentId) {
                setResult(value);
                onResult(value);
            }
        };
        void extensionRpc
            .sendRequest(AzureSqlDatabaseRequests.DeployLocalDatabase, request)
            .then(finish)
            .catch((error) => {
                extensionRpc.log.error("Local database deployment request failed", error);
                finish({
                    deploymentId: request.deploymentId,
                    status: "error",
                    database: databaseName,
                    sourceDatabase,
                    server: "",
                    resourcesMayRemain: true,
                    errorMessage: error instanceof Error ? error.message : String(error),
                });
            });
        return () => {
            disposed = true;
            cancelAnimationFrame(frame);
            subscription.dispose();
            void extensionRpc
                .sendRequest(AzureSqlDatabaseRequests.CancelLocalDatabaseDeployment, {
                    deploymentId: request.deploymentId,
                })
                .catch((error) =>
                    extensionRpc.log.error("Failed to cancel database deployment", error),
                );
        };
    }, [extensionRpc, request, databaseName, sourceDatabase, onResult]);

    const withData = request.deploymentContent === "schemaAndData";
    const steps: LocalDatabaseDeploymentStage[] = [
        "authenticating",
        "validatingSettings",
        ...(withData ? ["exportingData" as const] : []),
        "creatingDatabase",
        "connecting",
        withData ? "importingData" : "publishingSchema",
        "verifying",
        "savingConnection",
    ];
    const succeeded = result?.status === "succeeded";
    const performAction = async (action: "copyConnectionString" | "openPortal") => {
        setActionPending(true);
        setActionError(undefined);
        try {
            await extensionRpc.sendRequest(AzureSqlDatabaseRequests.LocalDatabaseDeploymentAction, {
                deploymentId: request.deploymentId,
                action,
            });
        } catch (error) {
            extensionRpc.log.error("Post-deployment action failed", error);
            setActionError(error instanceof Error ? error.message : String(error));
        } finally {
            setActionPending(false);
        }
    };
    const settings = succeeded ? result.scriptSettings : undefined;
    const scriptBaseName = (result?.database || "database").replace(/[^a-zA-Z0-9-_]/g, "_");
    const scripts = settings
        ? [
              {
                  id: "arm",
                  label: locConstants.deploymentScripts.armTemplate,
                  content: generateAzureSqlDatabaseArm(settings),
                  fileName: `${scriptBaseName}.json`,
              },
              {
                  id: "bicep",
                  label: locConstants.deploymentScripts.bicep,
                  content: generateAzureSqlDatabaseBicep(settings),
                  fileName: `${scriptBaseName}.bicep`,
              },
              {
                  id: "terraform",
                  label: locConstants.deploymentScripts.terraform,
                  content: generateAzureSqlDatabaseTerraform(settings),
                  fileName: `${scriptBaseName}.tf`,
              },
          ]
        : [];
    const title = succeeded
        ? strings.deploymentReady
        : result?.status === "cancelled"
          ? strings.deploymentCancelled
          : result
            ? strings.deploymentFailed
            : strings.deployingDatabase(databaseName);
    const metadata = succeeded
        ? [
              { label: strings.deploymentName, value: result.database, sql: true },
              { label: strings.server, value: result.server, sql: true },
              ...(result.objectsDeployed !== undefined
                  ? [
                        {
                            label: strings.deploymentSchema,
                            value: strings.deploymentObjects(result.objectsDeployed),
                            sql: false,
                        },
                    ]
                  : []),
              {
                  label: strings.deploymentConnection,
                  value: strings.deploymentConnected,
                  sql: false,
              },
              { label: strings.deploymentSource, value: result.sourceDatabase, sql: true },
          ]
        : [];

    return (
        <section className={classes.content} aria-label={strings.deploymentProgress}>
            <Text
                as="h2"
                size={500}
                weight="semibold"
                className={classes.heading}
                aria-live="polite"
                tabIndex={-1}
                ref={heading}>
                {title}
            </Text>
            <Text className={classes.secondary}>
                {succeeded
                    ? withData
                        ? strings.deploymentDataReady
                        : strings.deploymentSchemaReady
                    : strings.deploymentDescription}
            </Text>
            <div className={mergeClasses(classes.card, succeeded && classes.success)}>
                {succeeded ? (
                    <>
                        <div className={classes.successHeading} role="status">
                            <CheckmarkCircle24Regular className={classes.passed} aria-hidden />
                            <Text weight="semibold">{result.database}</Text>
                        </div>
                        <dl className={classes.metadata}>
                            {metadata.map(({ label, value, sql }) => (
                                <div key={label} className={classes.row}>
                                    <dt className={classes.secondary}>{label}</dt>
                                    <dd className={mergeClasses(classes.value, sql && classes.sql)}>
                                        {value}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </>
                ) : (
                    <ol className={classes.steps} aria-label={strings.deploymentProgress}>
                        {steps.map((stage) => {
                            const completed = progress.completedStages.includes(stage);
                            const current = progress.stage === stage;
                            return (
                                <li
                                    key={stage}
                                    aria-current={current && !result ? "step" : undefined}
                                    className={mergeClasses(
                                        classes.step,
                                        completed && classes.passed,
                                        current && classes.active,
                                        !completed && !current && classes.pending,
                                    )}>
                                    {completed ? (
                                        <Checkmark20Regular className={classes.icon} aria-hidden />
                                    ) : current && !result ? (
                                        <Spinner size="tiny" className={classes.icon} aria-hidden />
                                    ) : current && result?.status === "error" ? (
                                        <DismissCircle20Regular
                                            className={mergeClasses(classes.icon, classes.error)}
                                            aria-hidden
                                        />
                                    ) : (
                                        <Circle20Regular className={classes.icon} aria-hidden />
                                    )}
                                    {strings.deploymentStageLabels[stage]}
                                </li>
                            );
                        })}
                    </ol>
                )}
                {!succeeded && result?.errorMessage && (
                    <Text role="alert" className={classes.error}>
                        {result.errorMessage}
                    </Text>
                )}
                {!succeeded && result?.resourcesMayRemain && (
                    <Text className={classes.secondary}>{strings.deploymentResourcesRemain}</Text>
                )}
                <Link
                    as="button"
                    onClick={() => {
                        void extensionRpc
                            .sendRequest(
                                AzureSqlDatabaseRequests.ShowLocalDatabaseCompatibilityOutput,
                            )
                            .catch((error) =>
                                extensionRpc.log.error("Failed to show deployment output", error),
                            );
                    }}>
                    {strings.deploymentLog}
                </Link>
            </div>
            {succeeded && (
                <>
                    <div className={classes.actions}>
                        <Button
                            icon={<CopyRegular />}
                            disabled={actionPending}
                            onClick={() => void performAction("copyConnectionString")}>
                            {locConstants.connectToDatabase.copyConnectionString}
                        </Button>
                        <Button
                            icon={<OpenRegular />}
                            disabled={actionPending}
                            onClick={() => void performAction("openPortal")}>
                            {strings.openInAzurePortal}
                        </Button>
                    </div>
                    {actionError && (
                        <Text role="alert" className={classes.error}>
                            {actionError}
                        </Text>
                    )}
                    {settings && (
                        <DeploymentScriptsCard
                            expanded
                            scripts={scripts}
                            description={strings.deploymentScriptsDescription}
                            onDownload={(content, fileName) =>
                                extensionRpc.action("downloadDeploymentScript", {
                                    content,
                                    fileName,
                                })
                            }
                            onAddToWorkspace={(content, fileName) =>
                                extensionRpc.action("addDeploymentScriptToWorkspace", {
                                    content,
                                    fileName,
                                })
                            }
                        />
                    )}
                </>
            )}
        </section>
    );
};
