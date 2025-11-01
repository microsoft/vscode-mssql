/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dropdown,
    Field,
    Input,
    Label,
    makeStyles,
    Option,
    Radio,
    RadioGroup,
    Spinner,
    tokens,
} from "@fluentui/react-components";
import { FolderOpen20Regular, DatabaseArrowRight20Regular } from "@fluentui/react-icons";
import { useState, useEffect, useContext } from "react";
import {
    BrowseInputFileWebviewRequest,
    BrowseOutputFileWebviewRequest,
    ConnectionProfile,
    ConnectToServerWebviewRequest,
    DataTierOperationType,
    DeployDacpacWebviewRequest,
    ExtractDacpacWebviewRequest,
    ImportBacpacWebviewRequest,
    ExportBacpacWebviewRequest,
    GetSuggestedOutputPathWebviewRequest,
    InitializeConnectionWebviewRequest,
    ValidateFilePathWebviewRequest,
    ListDatabasesWebviewRequest,
    ValidateDatabaseNameWebviewRequest,
    CancelDataTierApplicationWebviewNotification,
    ConfirmDeployToExistingWebviewRequest,
} from "../../../sharedInterfaces/dataTierApplication";
import { DataTierApplicationContext } from "./dataTierApplicationStateProvider";
import { useDataTierApplicationSelector } from "./dataTierApplicationSelector";
import { locConstants } from "../../common/locConstants";

/**
 * Validation message with severity level
 */
interface ValidationMessage {
    message: string;
    severity: "error" | "warning";
}

/**
 * Default application version for DACPAC extraction
 */
const DEFAULT_APPLICATION_VERSION = "1.0.0";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        maxHeight: "100vh",
        overflowY: "auto",
        padding: "10px",
    },
    formContainer: {
        display: "flex",
        flexDirection: "column",
        width: "700px",
        maxWidth: "calc(100% - 20px)",
        gap: "16px",
    },
    title: {
        fontSize: tokens.fontSizeBase500,
        fontWeight: tokens.fontWeightSemibold,
        marginBottom: "8px",
    },
    description: {
        fontSize: tokens.fontSizeBase300,
        color: tokens.colorNeutralForeground2,
        marginBottom: "16px",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    fileInputGroup: {
        display: "flex",
        gap: "8px",
        alignItems: "flex-end",
    },
    fileInput: {
        flexGrow: 1,
    },
    radioGroup: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
    actions: {
        display: "flex",
        gap: "8px",
        justifyContent: "flex-end",
        marginTop: "16px",
        paddingTop: "16px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    progressContainer: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "12px",
        backgroundColor: tokens.colorNeutralBackground3,
        borderRadius: tokens.borderRadiusMedium,
    },
    warningMessage: {
        marginTop: "8px",
    },
});

export const DataTierApplicationForm = () => {
    const classes = useStyles();
    const context = useContext(DataTierApplicationContext);

    // State from the controller
    const initialOperationType = useDataTierApplicationSelector((state) => state.operationType);
    const initialOwnerUri = useDataTierApplicationSelector((state) => state.ownerUri);
    const initialServerName = useDataTierApplicationSelector((state) => state.serverName);
    const initialDatabaseName = useDataTierApplicationSelector((state) => state.databaseName);
    const initialSelectedProfileId = useDataTierApplicationSelector(
        (state) => state.selectedProfileId,
    );

    // Local state
    const [operationType, setOperationType] = useState<DataTierOperationType>(
        initialOperationType || DataTierOperationType.Deploy,
    );
    const [filePath, setFilePath] = useState("");
    const [databaseName, setDatabaseName] = useState(initialDatabaseName || "");
    const [isNewDatabase, setIsNewDatabase] = useState(!initialDatabaseName);
    const [availableDatabases, setAvailableDatabases] = useState<string[]>(
        initialDatabaseName ? [initialDatabaseName] : [],
    );
    const [applicationName, setApplicationName] = useState("");
    const [applicationVersion, setApplicationVersion] = useState(DEFAULT_APPLICATION_VERSION);
    const [isOperationInProgress, setIsOperationInProgress] = useState(false);
    const [validationMessages, setValidationMessages] = useState<Record<string, ValidationMessage>>(
        {},
    );
    const [availableConnections, setAvailableConnections] = useState<ConnectionProfile[]>([]);
    const [selectedProfileId, setSelectedProfileId] = useState<string>(
        initialSelectedProfileId || "",
    );
    const [ownerUri, setOwnerUri] = useState<string>(initialOwnerUri || "");
    const [isConnecting, setIsConnecting] = useState(false);

    // Load available connections when component mounts
    useEffect(() => {
        void loadConnections();

        // Cleanup function - cancel ongoing operations when component unmounts
        return () => {
            if (isConnecting || isOperationInProgress) {
                void context?.extensionRpc?.sendNotification(
                    CancelDataTierApplicationWebviewNotification.type,
                );
            }
        };
    }, []);

    // Load available databases when server or operation changes
    useEffect(() => {
        if (
            ownerUri &&
            (operationType === DataTierOperationType.Deploy ||
                operationType === DataTierOperationType.Extract ||
                operationType === DataTierOperationType.Export)
        ) {
            void loadDatabases();
        }
    }, [operationType, ownerUri]);

    // Update file path suggestion when database or operation type changes for Export/Extract
    useEffect(() => {
        const updateSuggestedPath = async () => {
            if (
                databaseName &&
                (operationType === DataTierOperationType.Extract ||
                    operationType === DataTierOperationType.Export) &&
                context?.extensionRpc
            ) {
                // Get the suggested full path from the controller
                const result = await context.extensionRpc.sendRequest(
                    GetSuggestedOutputPathWebviewRequest.type,
                    {
                        databaseName,
                        operationType,
                    },
                );

                if (result?.fullPath) {
                    setFilePath(result.fullPath);
                }
            }
        };

        void updateSuggestedPath();
    }, [databaseName, operationType, context]);

    const loadConnections = async () => {
        try {
            setIsConnecting(true);

            const result = await context?.extensionRpc?.sendRequest(
                InitializeConnectionWebviewRequest.type,
                {
                    initialServerName,
                    initialDatabaseName,
                    initialOwnerUri,
                    initialProfileId: initialSelectedProfileId,
                },
            );

            if (result) {
                // Set all available connections
                setAvailableConnections(result.connections);

                // If a connection was selected/matched
                if (result.selectedConnection) {
                    setSelectedProfileId(result.selectedConnection.profileId);

                    // If we have an ownerUri (either provided or from auto-connect)
                    if (result.ownerUri) {
                        setOwnerUri(result.ownerUri);
                    }

                    // Show error if auto-connect failed
                    if (result.errorMessage && !result.autoConnected) {
                        setValidationMessages((prev) => ({
                            ...prev,
                            connection: {
                                message: `${locConstants.dataTierApplication.connectionFailed}: ${result.errorMessage}`,
                                severity: "error",
                            },
                        }));
                    }
                }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            setValidationMessages({
                connection: {
                    message: `${locConstants.dataTierApplication.connectionFailed}: ${errorMsg}`,
                    severity: "error",
                },
            });
        } finally {
            setIsConnecting(false);
        }
    };

    const handleServerChange = async (profileId: string) => {
        setSelectedProfileId(profileId);
        setValidationMessages({});

        // Find the selected connection
        const selectedConnection = availableConnections.find(
            (conn) => conn.profileId === profileId,
        );

        if (!selectedConnection) {
            return;
        }

        setIsConnecting(true);

        try {
            // If not connected, connect to the server
            if (!selectedConnection.isConnected) {
                const result = await context?.extensionRpc?.sendRequest(
                    ConnectToServerWebviewRequest.type,
                    { profileId },
                );

                if (result?.isConnected && result.ownerUri) {
                    setOwnerUri(result.ownerUri);
                    // Update the connection status in our list
                    setAvailableConnections((prev) =>
                        prev.map((conn) =>
                            conn.profileId === profileId ? { ...conn, isConnected: true } : conn,
                        ),
                    );
                    // Databases will be loaded automatically via useEffect
                } else {
                    // Connection failed - clear state
                    setOwnerUri("");
                    setAvailableDatabases([]);
                    setDatabaseName("");
                    // Ensure connection is marked as not connected
                    setAvailableConnections((prev) =>
                        prev.map((conn) =>
                            conn.profileId === profileId ? { ...conn, isConnected: false } : conn,
                        ),
                    );
                    // Show error message to user
                    const errorMsg =
                        result?.errorMessage || locConstants.dataTierApplication.connectionFailed;
                    setValidationMessages({
                        connection: {
                            message: errorMsg,
                            severity: "error",
                        },
                    });
                }
            } else {
                // Already connected, verify connection state and get the ownerUri
                const result = await context?.extensionRpc?.sendRequest(
                    ConnectToServerWebviewRequest.type,
                    { profileId },
                );

                if (result?.isConnected && result.ownerUri) {
                    setOwnerUri(result.ownerUri);
                    // Databases will be loaded automatically via useEffect
                } else {
                    // Connection is no longer valid - clear state
                    setOwnerUri("");
                    setAvailableDatabases([]);
                    setDatabaseName("");
                    // Mark connection as not connected
                    setAvailableConnections((prev) =>
                        prev.map((conn) =>
                            conn.profileId === profileId ? { ...conn, isConnected: false } : conn,
                        ),
                    );
                    // Show error message to user
                    const errorMsg =
                        result?.errorMessage || locConstants.dataTierApplication.connectionFailed;
                    setValidationMessages({
                        connection: {
                            message: errorMsg,
                            severity: "error",
                        },
                    });
                }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            setValidationMessages({
                connection: {
                    message: `${locConstants.dataTierApplication.connectionFailed}: ${errorMsg}`,
                    severity: "error",
                },
            });
        } finally {
            setIsConnecting(false);
        }
    };

    const loadDatabases = async () => {
        try {
            const result = await context?.extensionRpc?.sendRequest(
                ListDatabasesWebviewRequest.type,
                { ownerUri: ownerUri || "" },
            );
            if (result?.databases) {
                setAvailableDatabases(result.databases);
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            setValidationMessages((prev) => ({
                ...prev,
                database: {
                    message: `${locConstants.dataTierApplication.failedToLoadDatabases}: ${errorMsg}`,
                    severity: "error",
                },
            }));
        }
    };

    const validateFilePath = async (path: string, shouldExist: boolean): Promise<boolean> => {
        if (!path) {
            setValidationMessages((prev) => ({
                ...prev,
                filePath: {
                    message: locConstants.dataTierApplication.filePathRequired,
                    severity: "error",
                },
            }));
            return false;
        }

        try {
            const result = await context?.extensionRpc?.sendRequest(
                ValidateFilePathWebviewRequest.type,
                { filePath: path, shouldExist },
            );

            if (!result?.isValid) {
                setValidationMessages((prev) => ({
                    ...prev,
                    filePath: {
                        message:
                            result?.errorMessage || locConstants.dataTierApplication.invalidFile,
                        severity: "error",
                    },
                }));
                return false;
            }

            // Clear error or set warning for file overwrite
            if (result.errorMessage) {
                setValidationMessages((prev) => ({
                    ...prev,
                    filePath: {
                        message: result.errorMessage || "",
                        severity: "warning", // This is a warning about overwrite
                    },
                }));
            } else {
                setValidationMessages((prev) => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { filePath: _fp, ...rest } = prev;
                    return rest;
                });
            }
            return true;
        } catch (error) {
            const errorMessage =
                error instanceof Error
                    ? error.message
                    : locConstants.dataTierApplication.validationFailed;
            setValidationMessages((prev) => ({
                ...prev,
                filePath: {
                    message: errorMessage,
                    severity: "error",
                },
            }));
            return false;
        }
    };

    const validateDatabaseName = async (
        dbName: string,
        shouldNotExist: boolean,
    ): Promise<boolean> => {
        if (!dbName) {
            setValidationMessages((prev) => ({
                ...prev,
                databaseName: {
                    message: locConstants.dataTierApplication.databaseNameRequired,
                    severity: "error",
                },
            }));
            return false;
        }

        try {
            const result = await context?.extensionRpc?.sendRequest(
                ValidateDatabaseNameWebviewRequest.type,
                {
                    databaseName: dbName,
                    ownerUri: ownerUri || "",
                    shouldNotExist: shouldNotExist,
                    operationType: operationType,
                },
            );

            if (!result?.isValid) {
                setValidationMessages((prev) => ({
                    ...prev,
                    databaseName: {
                        message:
                            result?.errorMessage ||
                            locConstants.dataTierApplication.invalidDatabase,
                        severity: "error",
                    },
                }));
                return false;
            }

            // Clear validation errors if valid
            setValidationMessages((prev) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { databaseName: _dn, ...rest } = prev;
                return rest;
            });

            // If deploying to an existing database, show confirmation dialog
            // This can happen in two cases:
            // 1. User checked "New Database" but database already exists (shouldNotExist=true)
            // 2. User unchecked "New Database" to deploy to existing (shouldNotExist=false)
            if (
                operationType === DataTierOperationType.Deploy &&
                result.errorMessage === locConstants.dataTierApplication.databaseAlreadyExists
            ) {
                const confirmResult = await context?.extensionRpc?.sendRequest(
                    ConfirmDeployToExistingWebviewRequest.type,
                    undefined,
                );

                return confirmResult?.confirmed === true;
            }

            return true;
        } catch (error) {
            const errorMessage =
                error instanceof Error
                    ? error.message
                    : locConstants.dataTierApplication.validationFailed;
            setValidationMessages((prev) => ({
                ...prev,
                databaseName: {
                    message: errorMessage,
                    severity: "error",
                },
            }));
            return false;
        }
    };

    const clearForm = () => {
        setFilePath("");
        setDatabaseName("");
        setApplicationName("");
        setApplicationVersion(DEFAULT_APPLICATION_VERSION);
        setValidationMessages({});
        setIsNewDatabase(true);
    };

    const handleSubmit = async () => {
        setIsOperationInProgress(true);

        try {
            let result;

            switch (operationType) {
                case DataTierOperationType.Deploy:
                    if (
                        !(await validateFilePath(filePath, true)) ||
                        !(await validateDatabaseName(databaseName, isNewDatabase))
                    ) {
                        setIsOperationInProgress(false);
                        return;
                    }
                    result = await context?.extensionRpc?.sendRequest(
                        DeployDacpacWebviewRequest.type,
                        {
                            packageFilePath: filePath,
                            databaseName,
                            isNewDatabase,
                            ownerUri: ownerUri || "",
                        },
                    );
                    break;

                case DataTierOperationType.Extract:
                    if (
                        !(await validateFilePath(filePath, false)) ||
                        !(await validateDatabaseName(databaseName, false))
                    ) {
                        setIsOperationInProgress(false);
                        return;
                    }
                    result = await context?.extensionRpc?.sendRequest(
                        ExtractDacpacWebviewRequest.type,
                        {
                            databaseName,
                            packageFilePath: filePath,
                            applicationName,
                            applicationVersion,
                            ownerUri: ownerUri || "",
                        },
                    );
                    break;

                case DataTierOperationType.Import:
                    if (
                        !(await validateFilePath(filePath, true)) ||
                        !(await validateDatabaseName(databaseName, true))
                    ) {
                        setIsOperationInProgress(false);
                        return;
                    }
                    result = await context?.extensionRpc?.sendRequest(
                        ImportBacpacWebviewRequest.type,
                        {
                            packageFilePath: filePath,
                            databaseName,
                            ownerUri: ownerUri || "",
                        },
                    );
                    break;

                case DataTierOperationType.Export:
                    if (
                        !(await validateFilePath(filePath, false)) ||
                        !(await validateDatabaseName(databaseName, false))
                    ) {
                        setIsOperationInProgress(false);
                        return;
                    }
                    result = await context?.extensionRpc?.sendRequest(
                        ExportBacpacWebviewRequest.type,
                        {
                            databaseName,
                            packageFilePath: filePath,
                            ownerUri: ownerUri || "",
                        },
                    );
                    break;
            }

            if (result?.success) {
                setIsOperationInProgress(false);
                clearForm();
            } else {
                console.error(
                    result?.errorMessage || locConstants.dataTierApplication.operationFailed,
                );
                setIsOperationInProgress(false);
            }
        } catch (error) {
            console.error(
                error instanceof Error
                    ? error.message
                    : locConstants.dataTierApplication.unexpectedError,
            );
            setIsOperationInProgress(false);
        }
    };

    const handleBrowseFile = async () => {
        const fileExtension =
            operationType === DataTierOperationType.Deploy ||
            operationType === DataTierOperationType.Extract
                ? "dacpac"
                : "bacpac";

        let result: { filePath?: string } | undefined;

        if (requiresInputFile) {
            // Browse for input file (Deploy or Import)
            result = await context?.extensionRpc?.sendRequest(BrowseInputFileWebviewRequest.type, {
                fileExtension,
            });
        } else {
            // Browse for output file (Extract or Export)
            // Use the suggested filename from state, or fallback to a default
            let defaultFileName = filePath;

            if (!defaultFileName) {
                // Generate default filename with timestamp using Intl.DateTimeFormat
                const now = new Date();
                const dateFormatter = new Intl.DateTimeFormat("en-US", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                });
                const timeFormatter = new Intl.DateTimeFormat("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                });

                const datePart = dateFormatter.format(now); // yyyy-MM-dd
                const timePart = timeFormatter.format(now).replace(/:/g, "-"); // HH-mm
                const timestamp = `${datePart}-${timePart}`;

                defaultFileName = `${databaseName || "database"}-${timestamp}.${fileExtension}`;
            }

            result = await context?.extensionRpc?.sendRequest(BrowseOutputFileWebviewRequest.type, {
                fileExtension,
                defaultFileName,
            });
        }

        if (result?.filePath) {
            setFilePath(result.filePath);
            // Clear validation error when file is selected
            const newMessages = { ...validationMessages };
            delete newMessages.filePath;
            setValidationMessages(newMessages);
            // Validate the selected file path
            await validateFilePath(result.filePath, requiresInputFile);
        }
    };

    const handleCancel = async () => {
        await context?.extensionRpc?.sendNotification(
            CancelDataTierApplicationWebviewNotification.type,
        );
    };

    const isFormValid = () => {
        if (!filePath || !databaseName) return false;
        // Only check for errors, not warnings
        const hasErrors = Object.values(validationMessages).some((msg) => msg.severity === "error");
        Object.values(validationMessages).forEach((msg) => {
            console.log(msg.message);
        });
        return !hasErrors;
    };

    const requiresInputFile =
        operationType === DataTierOperationType.Deploy ||
        operationType === DataTierOperationType.Import;
    const showDatabaseTarget = operationType === DataTierOperationType.Deploy;
    const showDatabaseSource =
        operationType === DataTierOperationType.Extract ||
        operationType === DataTierOperationType.Export;
    const showNewDatabase = operationType === DataTierOperationType.Import;
    const showApplicationInfo = operationType === DataTierOperationType.Extract;

    async function handleFilePathChange(value: string): Promise<void> {
        setFilePath(value);
        // Clear validation error when user types
        const newMessages = { ...validationMessages };
        delete newMessages.filePath;
        setValidationMessages(newMessages);
        await validateFilePath(value, requiresInputFile);
    }

    return (
        <div className={classes.root}>
            <div className={classes.formContainer}>
                <div>
                    <div className={classes.title}>{locConstants.dataTierApplication.title}</div>
                    <div className={classes.description}>
                        {locConstants.dataTierApplication.subtitle}
                    </div>
                </div>

                <div className={classes.section}>
                    <Field label={locConstants.dataTierApplication.operationLabel} required>
                        <RadioGroup
                            value={operationType}
                            onChange={(_, data) => {
                                setOperationType(data.value as DataTierOperationType);
                                setValidationMessages({});
                            }}
                            disabled={isOperationInProgress}
                            aria-label={locConstants.dataTierApplication.operationLabel}>
                            <Radio
                                value={DataTierOperationType.Deploy}
                                label={
                                    locConstants.dataTierApplication.deployDescription +
                                    " (" +
                                    locConstants.dataTierApplication.deployDacpac +
                                    ")"
                                }
                                aria-label={locConstants.dataTierApplication.deployDacpac}
                            />
                            <Radio
                                value={DataTierOperationType.Extract}
                                label={
                                    locConstants.dataTierApplication.extractDescription +
                                    " (" +
                                    locConstants.dataTierApplication.extractDacpac +
                                    ")"
                                }
                                aria-label={locConstants.dataTierApplication.extractDacpac}
                            />
                            <Radio
                                value={DataTierOperationType.Import}
                                label={
                                    locConstants.dataTierApplication.importDescription +
                                    " (" +
                                    locConstants.dataTierApplication.importBacpac +
                                    ")"
                                }
                                aria-label={locConstants.dataTierApplication.importBacpac}
                            />
                            <Radio
                                value={DataTierOperationType.Export}
                                label={
                                    locConstants.dataTierApplication.exportDescription +
                                    " (" +
                                    locConstants.dataTierApplication.exportBacpac +
                                    ")"
                                }
                                aria-label={locConstants.dataTierApplication.exportBacpac}
                            />
                        </RadioGroup>
                    </Field>
                </div>

                <div className={classes.section}>
                    <Field
                        label={locConstants.dataTierApplication.serverLabel}
                        required
                        validationMessage={validationMessages.connection?.message}
                        validationState={
                            validationMessages.connection?.severity === "error" ? "error" : "none"
                        }>
                        {isConnecting ? (
                            <Spinner
                                size="tiny"
                                label={locConstants.dataTierApplication.connectingToServer}
                            />
                        ) : (
                            <Dropdown
                                placeholder={locConstants.dataTierApplication.selectServer}
                                value={
                                    selectedProfileId
                                        ? availableConnections.find(
                                              (conn) => conn.profileId === selectedProfileId,
                                          )?.displayName || ""
                                        : ""
                                }
                                selectedOptions={selectedProfileId ? [selectedProfileId] : []}
                                onOptionSelect={(_, data) => {
                                    void handleServerChange(data.optionValue as string);
                                }}
                                disabled={
                                    isOperationInProgress || availableConnections.length === 0
                                }
                                aria-label={locConstants.dataTierApplication.serverLabel}>
                                {availableConnections.length === 0 ? (
                                    <Option value="" disabled text="">
                                        {locConstants.dataTierApplication.noConnectionsAvailable}
                                    </Option>
                                ) : (
                                    availableConnections.map((conn) => (
                                        <Option
                                            key={conn.profileId}
                                            value={conn.profileId}
                                            text={`${conn.displayName}${conn.isConnected ? " ●" : ""}`}>
                                            {conn.displayName}
                                            {conn.isConnected && " ●"}
                                        </Option>
                                    ))
                                )}
                            </Dropdown>
                        )}
                    </Field>
                </div>

                <div className={classes.section}>
                    <Field
                        label={
                            requiresInputFile
                                ? locConstants.dataTierApplication.packageFileLabel
                                : locConstants.dataTierApplication.outputFileLabel
                        }
                        required
                        validationMessage={validationMessages.filePath?.message}
                        validationState={
                            validationMessages.filePath
                                ? validationMessages.filePath.severity === "error"
                                    ? "error"
                                    : "warning"
                                : "none"
                        }>
                        <div className={classes.fileInputGroup}>
                            <Input
                                className={classes.fileInput}
                                value={filePath}
                                onChange={(_, data) => handleFilePathChange(data.value)}
                                placeholder={
                                    requiresInputFile
                                        ? locConstants.dataTierApplication.selectPackageFile
                                        : locConstants.dataTierApplication.selectOutputFile
                                }
                                disabled={isOperationInProgress}
                                aria-label={
                                    requiresInputFile
                                        ? locConstants.dataTierApplication.packageFileLabel
                                        : locConstants.dataTierApplication.outputFileLabel
                                }
                            />
                            <Button
                                icon={<FolderOpen20Regular />}
                                appearance="secondary"
                                onClick={handleBrowseFile}
                                disabled={isOperationInProgress}
                                aria-label={locConstants.dataTierApplication.browse}>
                                {locConstants.dataTierApplication.browse}
                            </Button>
                        </div>
                    </Field>
                </div>

                {showDatabaseTarget && (
                    <div className={classes.section}>
                        <Label>{locConstants.dataTierApplication.targetDatabaseLabel}</Label>
                        <RadioGroup
                            value={isNewDatabase ? "new" : "existing"}
                            onChange={(_, data) => setIsNewDatabase(data.value === "new")}
                            className={classes.radioGroup}
                            aria-label={locConstants.dataTierApplication.targetDatabaseLabel}>
                            <Radio
                                value="new"
                                label={locConstants.dataTierApplication.newDatabase}
                                disabled={isOperationInProgress}
                                aria-label={locConstants.dataTierApplication.newDatabase}
                            />
                            <Radio
                                value="existing"
                                label={locConstants.dataTierApplication.existingDatabase}
                                disabled={isOperationInProgress}
                                aria-label={locConstants.dataTierApplication.existingDatabase}
                            />
                        </RadioGroup>

                        {isNewDatabase ? (
                            <Field
                                label={locConstants.dataTierApplication.databaseNameLabel}
                                required
                                validationMessage={validationMessages.databaseName?.message}
                                validationState={
                                    validationMessages.databaseName?.severity === "error"
                                        ? "error"
                                        : "none"
                                }>
                                <Input
                                    value={databaseName}
                                    onChange={(_, data) => setDatabaseName(data.value)}
                                    placeholder={locConstants.dataTierApplication.enterDatabaseName}
                                    disabled={isOperationInProgress}
                                    aria-label={locConstants.dataTierApplication.databaseNameLabel}
                                />
                            </Field>
                        ) : (
                            <Field
                                label={locConstants.dataTierApplication.databaseNameLabel}
                                required
                                validationMessage={
                                    validationMessages.databaseName?.message ||
                                    validationMessages.database?.message
                                }
                                validationState={
                                    validationMessages.databaseName?.severity === "error" ||
                                    validationMessages.database?.severity === "error"
                                        ? "error"
                                        : "none"
                                }>
                                <Dropdown
                                    placeholder={locConstants.dataTierApplication.selectDatabase}
                                    value={databaseName}
                                    selectedOptions={[databaseName]}
                                    onOptionSelect={(_, data) =>
                                        setDatabaseName(data.optionText || "")
                                    }
                                    disabled={isOperationInProgress || !ownerUri}
                                    aria-label={locConstants.dataTierApplication.databaseNameLabel}>
                                    {availableDatabases.map((db) => (
                                        <Option key={db} value={db}>
                                            {db}
                                        </Option>
                                    ))}
                                </Dropdown>
                            </Field>
                        )}
                    </div>
                )}

                {(showDatabaseSource || showNewDatabase) && (
                    <div className={classes.section}>
                        {showDatabaseSource ? (
                            <Field
                                label={locConstants.dataTierApplication.sourceDatabaseLabel}
                                required
                                validationMessage={
                                    validationMessages.databaseName?.message ||
                                    validationMessages.database?.message
                                }
                                validationState={
                                    validationMessages.databaseName?.severity === "error" ||
                                    validationMessages.database?.severity === "error"
                                        ? "error"
                                        : "none"
                                }>
                                <Dropdown
                                    placeholder={locConstants.dataTierApplication.selectDatabase}
                                    value={databaseName}
                                    selectedOptions={[databaseName]}
                                    onOptionSelect={(_, data) =>
                                        setDatabaseName(data.optionText || "")
                                    }
                                    disabled={isOperationInProgress || !ownerUri}
                                    aria-label={
                                        locConstants.dataTierApplication.sourceDatabaseLabel
                                    }>
                                    {availableDatabases.map((db) => (
                                        <Option key={db} value={db}>
                                            {db}
                                        </Option>
                                    ))}
                                </Dropdown>
                            </Field>
                        ) : (
                            <Field
                                label={locConstants.dataTierApplication.databaseNameLabel}
                                required
                                validationMessage={validationMessages.databaseName?.message}
                                validationState={
                                    validationMessages.databaseName?.severity === "error"
                                        ? "error"
                                        : "none"
                                }>
                                <Input
                                    value={databaseName}
                                    onChange={(_, data) => setDatabaseName(data.value)}
                                    placeholder={locConstants.dataTierApplication.enterDatabaseName}
                                    disabled={isOperationInProgress}
                                    aria-label={locConstants.dataTierApplication.databaseNameLabel}
                                />
                            </Field>
                        )}
                    </div>
                )}

                {showApplicationInfo && (
                    <div className={classes.section}>
                        <Field label={locConstants.dataTierApplication.applicationNameLabel}>
                            <Input
                                value={applicationName}
                                onChange={(_, data) => setApplicationName(data.value)}
                                placeholder={locConstants.dataTierApplication.enterApplicationName}
                                disabled={isOperationInProgress}
                                aria-label={locConstants.dataTierApplication.applicationNameLabel}
                            />
                        </Field>

                        <Field label={locConstants.dataTierApplication.applicationVersionLabel}>
                            <Input
                                value={applicationVersion}
                                onChange={(_, data) => setApplicationVersion(data.value)}
                                placeholder={DEFAULT_APPLICATION_VERSION}
                                disabled={isOperationInProgress}
                                aria-label={
                                    locConstants.dataTierApplication.applicationVersionLabel
                                }
                            />
                        </Field>
                    </div>
                )}

                <div className={classes.actions}>
                    <Button
                        appearance="secondary"
                        onClick={handleCancel}
                        disabled={isOperationInProgress}
                        aria-label={locConstants.dataTierApplication.cancel}>
                        {locConstants.dataTierApplication.cancel}
                    </Button>
                    <Button
                        appearance="primary"
                        icon={<DatabaseArrowRight20Regular />}
                        onClick={handleSubmit}
                        disabled={!isFormValid() || isOperationInProgress || isConnecting}
                        aria-label={locConstants.dataTierApplication.execute}>
                        {locConstants.dataTierApplication.execute}
                    </Button>
                </div>
            </div>
        </div>
    );
};
