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
    MessageBar,
    MessageBarBody,
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
    ListConnectionsWebviewRequest,
    ValidateFilePathWebviewRequest,
    ListDatabasesWebviewRequest,
    ValidateDatabaseNameWebviewRequest,
    CancelDataTierApplicationWebviewNotification,
    ConfirmDeployToExistingWebviewRequest,
} from "../../../sharedInterfaces/dataTierApplication";
import { DataTierApplicationContext } from "./dataTierApplicationStateProvider";
import { useDataTierApplicationSelector } from "./dataTierApplicationSelector";
import { locConstants } from "../../common/locConstants";

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
    const [applicationVersion, setApplicationVersion] = useState("1.0.0");
    const [isOperationInProgress, setIsOperationInProgress] = useState(false);
    const [progressMessage, setProgressMessage] = useState("");
    const [errorMessage, setErrorMessage] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
    const [availableConnections, setAvailableConnections] = useState<ConnectionProfile[]>([]);
    const [selectedProfileId, setSelectedProfileId] = useState<string>(
        initialSelectedProfileId || "",
    );
    const [ownerUri, setOwnerUri] = useState<string>(initialOwnerUri || "");
    const [isConnecting, setIsConnecting] = useState(false);

    // Load available connections when component mounts
    useEffect(() => {
        void loadConnections();
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

    const loadConnections = async () => {
        try {
            const result = await context?.extensionRpc?.sendRequest(
                ListConnectionsWebviewRequest.type,
                undefined,
            );
            if (result?.connections) {
                setAvailableConnections(result.connections);

                const findMatchingConnection = (): ConnectionProfile | undefined => {
                    if (initialSelectedProfileId) {
                        const byProfileId = result.connections.find(
                            (conn) => conn.profileId === initialSelectedProfileId,
                        );
                        if (byProfileId) {
                            return byProfileId;
                        }
                    }

                    if (initialServerName) {
                        return result.connections.find((conn) => {
                            const serverMatches = conn.server === initialServerName;
                            const databaseMatches =
                                !initialDatabaseName ||
                                !conn.database ||
                                conn.database === initialDatabaseName;
                            return serverMatches && databaseMatches;
                        });
                    }

                    return undefined;
                };

                const matchingConnection = findMatchingConnection();

                if (matchingConnection) {
                    setSelectedProfileId(matchingConnection.profileId);

                    if (initialOwnerUri) {
                        // Already connected via Object Explorer
                        setOwnerUri(initialOwnerUri);
                        if (!matchingConnection.isConnected) {
                            setAvailableConnections((prev) =>
                                prev.map((conn) =>
                                    conn.profileId === matchingConnection.profileId
                                        ? { ...conn, isConnected: true }
                                        : conn,
                                ),
                            );
                        }
                    } else if (!matchingConnection.isConnected) {
                        setIsConnecting(true);
                        try {
                            const connectResult = await context?.extensionRpc?.sendRequest(
                                ConnectToServerWebviewRequest.type,
                                { profileId: matchingConnection.profileId },
                            );

                            if (connectResult?.isConnected && connectResult.ownerUri) {
                                setOwnerUri(connectResult.ownerUri);
                                setAvailableConnections((prev) =>
                                    prev.map((conn) =>
                                        conn.profileId === matchingConnection.profileId
                                            ? { ...conn, isConnected: true }
                                            : conn,
                                    ),
                                );
                            } else {
                                setErrorMessage(
                                    connectResult?.errorMessage ||
                                        locConstants.dataTierApplication.connectionFailed,
                                );
                            }
                        } catch (error) {
                            const errorMsg = error instanceof Error ? error.message : String(error);
                            setErrorMessage(
                                `${locConstants.dataTierApplication.connectionFailed}: ${errorMsg}`,
                            );
                        } finally {
                            setIsConnecting(false);
                        }
                    } else {
                        // Already connected, fetch ownerUri to ensure we have it
                        try {
                            const connectResult = await context?.extensionRpc?.sendRequest(
                                ConnectToServerWebviewRequest.type,
                                { profileId: matchingConnection.profileId },
                            );

                            if (connectResult?.ownerUri) {
                                setOwnerUri(connectResult.ownerUri);
                            }
                        } catch (error) {
                            console.error("Failed to get ownerUri:", error);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Failed to load connections:", error);
        }
    };

    const handleServerChange = async (profileId: string) => {
        setSelectedProfileId(profileId);
        setErrorMessage("");
        setSuccessMessage("");
        setValidationErrors({});

        // Find the selected connection
        const selectedConnection = availableConnections.find(
            (conn) => conn.profileId === profileId,
        );

        if (!selectedConnection) {
            return;
        }

        // If not connected, connect to the server
        if (!selectedConnection.isConnected) {
            setIsConnecting(true);
            try {
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
                    setErrorMessage(
                        result?.errorMessage || locConstants.dataTierApplication.connectionFailed,
                    );
                }
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                setErrorMessage(
                    `${locConstants.dataTierApplication.connectionFailed}: ${errorMsg}`,
                );
            } finally {
                setIsConnecting(false);
            }
        } else {
            // Already connected, just need to get the ownerUri
            // For now, we'll need to trigger a connection to get the ownerUri
            // In a future enhancement, we could store ownerUri in the connection profile
            try {
                const result = await context?.extensionRpc?.sendRequest(
                    ConnectToServerWebviewRequest.type,
                    { profileId },
                );

                if (result?.ownerUri) {
                    setOwnerUri(result.ownerUri);
                }
            } catch (error) {
                console.error("Failed to get ownerUri:", error);
            }
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
            console.error("Failed to load databases:", error);
        }
    };

    const validateFilePath = async (path: string, shouldExist: boolean): Promise<boolean> => {
        if (!path) {
            setValidationErrors((prev) => ({
                ...prev,
                filePath: locConstants.dataTierApplication.filePathRequired,
            }));
            return false;
        }

        try {
            const result = await context?.extensionRpc?.sendRequest(
                ValidateFilePathWebviewRequest.type,
                { filePath: path, shouldExist },
            );

            if (!result?.isValid) {
                setValidationErrors((prev) => ({
                    ...prev,
                    filePath: result?.errorMessage || locConstants.dataTierApplication.invalidFile,
                }));
                return false;
            }

            // Clear error or set warning for file overwrite
            if (result.errorMessage) {
                setValidationErrors((prev) => ({
                    ...prev,
                    filePath: result.errorMessage || "", // This is a warning about overwrite
                }));
            } else {
                setValidationErrors((prev) => {
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
            setValidationErrors((prev) => ({
                ...prev,
                filePath: errorMessage,
            }));
            return false;
        }
    };

    const validateDatabaseName = async (
        dbName: string,
        shouldNotExist: boolean,
    ): Promise<boolean> => {
        if (!dbName) {
            setValidationErrors((prev) => ({
                ...prev,
                databaseName: locConstants.dataTierApplication.databaseNameRequired,
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
                setValidationErrors((prev) => ({
                    ...prev,
                    databaseName:
                        result?.errorMessage || locConstants.dataTierApplication.invalidDatabase,
                }));
                return false;
            }

            // Clear validation errors if valid
            setValidationErrors((prev) => {
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
            setValidationErrors((prev) => ({
                ...prev,
                databaseName: errorMessage,
            }));
            return false;
        }
    };

    const handleSubmit = async () => {
        setErrorMessage("");
        setSuccessMessage("");
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
                    setProgressMessage(locConstants.dataTierApplication.deployingDacpac);
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
                    setProgressMessage(locConstants.dataTierApplication.extractingDacpac);
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
                    setProgressMessage(locConstants.dataTierApplication.importingBacpac);
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
                    setProgressMessage(locConstants.dataTierApplication.exportingBacpac);
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
                setSuccessMessage(getSuccessMessage(operationType));
                setProgressMessage("");
                setIsOperationInProgress(false);
            } else {
                setErrorMessage(
                    result?.errorMessage || locConstants.dataTierApplication.operationFailed,
                );
                setProgressMessage("");
                setIsOperationInProgress(false);
            }
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : locConstants.dataTierApplication.unexpectedError,
            );
            setProgressMessage("");
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
            const defaultFileName = `${initialDatabaseName || "database"}.${fileExtension}`;
            result = await context?.extensionRpc?.sendRequest(BrowseOutputFileWebviewRequest.type, {
                fileExtension,
                defaultFileName,
            });
        }

        if (result?.filePath) {
            setFilePath(result.filePath);
            // Clear validation error when file is selected
            const newErrors = { ...validationErrors };
            delete newErrors.filePath;
            setValidationErrors(newErrors);
            // Validate the selected file path
            await validateFilePath(result.filePath, requiresInputFile);
        }
    };

    const handleCancel = async () => {
        await context?.extensionRpc?.sendNotification(
            CancelDataTierApplicationWebviewNotification.type,
        );
    };

    const getSuccessMessage = (type: DataTierOperationType): string => {
        switch (type) {
            case DataTierOperationType.Deploy:
                return locConstants.dataTierApplication.deploySuccess;
            case DataTierOperationType.Extract:
                return locConstants.dataTierApplication.extractSuccess;
            case DataTierOperationType.Import:
                return locConstants.dataTierApplication.importSuccess;
            case DataTierOperationType.Export:
                return locConstants.dataTierApplication.exportSuccess;
        }
    };

    const getOperationDescription = (type: DataTierOperationType): string => {
        switch (type) {
            case DataTierOperationType.Deploy:
                return locConstants.dataTierApplication.deployDescription;
            case DataTierOperationType.Extract:
                return locConstants.dataTierApplication.extractDescription;
            case DataTierOperationType.Import:
                return locConstants.dataTierApplication.importDescription;
            case DataTierOperationType.Export:
                return locConstants.dataTierApplication.exportDescription;
        }
    };

    const isFormValid = () => {
        if (!filePath || !databaseName) return false;
        if (
            operationType === DataTierOperationType.Extract &&
            (!applicationName || !applicationVersion)
        )
            return false;
        return Object.keys(validationErrors).length === 0;
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

    return (
        <div className={classes.root}>
            <div className={classes.formContainer}>
                <div>
                    <div className={classes.title}>{locConstants.dataTierApplication.title}</div>
                    <div className={classes.description}>
                        {locConstants.dataTierApplication.subtitle}
                    </div>
                </div>

                {errorMessage && (
                    <MessageBar intent="error">
                        <MessageBarBody>{errorMessage}</MessageBarBody>
                    </MessageBar>
                )}

                {successMessage && (
                    <MessageBar intent="success">
                        <MessageBarBody>{successMessage}</MessageBarBody>
                    </MessageBar>
                )}

                {isOperationInProgress && (
                    <div className={classes.progressContainer}>
                        <Spinner size="small" label={progressMessage} />
                    </div>
                )}

                <div className={classes.section}>
                    <Field label={locConstants.dataTierApplication.operationLabel} required>
                        <Dropdown
                            placeholder={locConstants.dataTierApplication.selectOperation}
                            value={operationType}
                            selectedOptions={[operationType]}
                            onOptionSelect={(_, data) => {
                                setOperationType(data.optionValue as DataTierOperationType);
                                setErrorMessage("");
                                setSuccessMessage("");
                                setValidationErrors({});
                            }}
                            disabled={isOperationInProgress}>
                            <Option value={DataTierOperationType.Deploy}>
                                {locConstants.dataTierApplication.deployDacpac}
                            </Option>
                            <Option value={DataTierOperationType.Extract}>
                                {locConstants.dataTierApplication.extractDacpac}
                            </Option>
                            <Option value={DataTierOperationType.Import}>
                                {locConstants.dataTierApplication.importBacpac}
                            </Option>
                            <Option value={DataTierOperationType.Export}>
                                {locConstants.dataTierApplication.exportBacpac}
                            </Option>
                        </Dropdown>
                    </Field>

                    <Label>{getOperationDescription(operationType)}</Label>
                </div>

                <div className={classes.section}>
                    <Field label={locConstants.dataTierApplication.serverLabel} required>
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
                                }>
                                {availableConnections.length === 0 ? (
                                    <Option value="" disabled text="">
                                        {locConstants.dataTierApplication.noConnectionsAvailable}
                                    </Option>
                                ) : (
                                    availableConnections.map((conn) => (
                                        <Option key={conn.profileId} value={conn.profileId}>
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
                        validationMessage={validationErrors.filePath}
                        validationState={validationErrors.filePath ? "warning" : "none"}>
                        <div className={classes.fileInputGroup}>
                            <Input
                                className={classes.fileInput}
                                value={filePath}
                                onChange={(_, data) => setFilePath(data.value)}
                                placeholder={
                                    requiresInputFile
                                        ? locConstants.dataTierApplication.selectPackageFile
                                        : locConstants.dataTierApplication.selectOutputFile
                                }
                                disabled={isOperationInProgress}
                            />
                            <Button
                                icon={<FolderOpen20Regular />}
                                appearance="secondary"
                                onClick={handleBrowseFile}
                                disabled={isOperationInProgress}>
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
                            className={classes.radioGroup}>
                            <Radio
                                value="new"
                                label={locConstants.dataTierApplication.newDatabase}
                                disabled={isOperationInProgress}
                            />
                            <Radio
                                value="existing"
                                label={locConstants.dataTierApplication.existingDatabase}
                                disabled={isOperationInProgress}
                            />
                        </RadioGroup>

                        {isNewDatabase ? (
                            <Field
                                label={locConstants.dataTierApplication.databaseNameLabel}
                                required
                                validationMessage={validationErrors.databaseName}
                                validationState={validationErrors.databaseName ? "error" : "none"}>
                                <Input
                                    value={databaseName}
                                    onChange={(_, data) => setDatabaseName(data.value)}
                                    placeholder={locConstants.dataTierApplication.enterDatabaseName}
                                    disabled={isOperationInProgress}
                                />
                            </Field>
                        ) : (
                            <Field
                                label={locConstants.dataTierApplication.databaseNameLabel}
                                required
                                validationMessage={validationErrors.databaseName}
                                validationState={validationErrors.databaseName ? "error" : "none"}>
                                <Dropdown
                                    placeholder={locConstants.dataTierApplication.selectDatabase}
                                    value={databaseName}
                                    selectedOptions={[databaseName]}
                                    onOptionSelect={(_, data) =>
                                        setDatabaseName(data.optionText || "")
                                    }
                                    disabled={isOperationInProgress}>
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
                                validationMessage={validationErrors.databaseName}
                                validationState={validationErrors.databaseName ? "error" : "none"}>
                                <Dropdown
                                    placeholder={locConstants.dataTierApplication.selectDatabase}
                                    value={databaseName}
                                    selectedOptions={[databaseName]}
                                    onOptionSelect={(_, data) =>
                                        setDatabaseName(data.optionText || "")
                                    }
                                    disabled={isOperationInProgress}>
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
                                validationMessage={validationErrors.databaseName}
                                validationState={validationErrors.databaseName ? "error" : "none"}>
                                <Input
                                    value={databaseName}
                                    onChange={(_, data) => setDatabaseName(data.value)}
                                    placeholder={locConstants.dataTierApplication.enterDatabaseName}
                                    disabled={isOperationInProgress}
                                />
                            </Field>
                        )}
                    </div>
                )}

                {showApplicationInfo && (
                    <div className={classes.section}>
                        <Field
                            label={locConstants.dataTierApplication.applicationNameLabel}
                            required>
                            <Input
                                value={applicationName}
                                onChange={(_, data) => setApplicationName(data.value)}
                                placeholder={locConstants.dataTierApplication.enterApplicationName}
                                disabled={isOperationInProgress}
                            />
                        </Field>

                        <Field
                            label={locConstants.dataTierApplication.applicationVersionLabel}
                            required>
                            <Input
                                value={applicationVersion}
                                onChange={(_, data) => setApplicationVersion(data.value)}
                                placeholder="1.0.0"
                                disabled={isOperationInProgress}
                            />
                        </Field>
                    </div>
                )}

                <div className={classes.actions}>
                    <Button
                        appearance="secondary"
                        onClick={handleCancel}
                        disabled={isOperationInProgress}>
                        {locConstants.dataTierApplication.cancel}
                    </Button>
                    <Button
                        appearance="primary"
                        icon={<DatabaseArrowRight20Regular />}
                        onClick={handleSubmit}
                        disabled={!isFormValid() || isOperationInProgress}>
                        {locConstants.dataTierApplication.execute}
                    </Button>
                </div>
            </div>
        </div>
    );
};
