/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Link, makeStyles, tokens } from "@fluentui/react-components";
import { DatabaseArrowRight20Regular } from "@fluentui/react-icons";
import { useState, useEffect, useContext } from "react";
import * as dacpacDialog from "../../../sharedInterfaces/dacpacDialog";
import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { locConstants } from "../../common/locConstants";
import { ApplicationInfoSection } from "./ApplicationInfoSection";
import { DacpacDialogContext } from "./dacpacDialogStateProvider";
import { useDacpacDialogSelector } from "./dacpacDialogSelector";
import { FilePathSection } from "./FilePathSection";
import { OperationTypeSection } from "./OperationTypeSection";
import { ServerSelectionSection } from "./ServerSelectionSection";
import { SourceDatabaseSection } from "./SourceDatabaseSection";
import { TargetDatabaseSection } from "./TargetDatabaseSection";

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

export const DacpacDialogForm = () => {
    const classes = useStyles();
    const context = useContext(DacpacDialogContext);

    // State from the controller
    const initialOperationType = useDacpacDialogSelector((state) => state.operationType);
    const initialOwnerUri = useDacpacDialogSelector((state) => state.ownerUri);
    const initialServerName = useDacpacDialogSelector((state) => state.serverName);
    const initialDatabaseName = useDacpacDialogSelector((state) => state.databaseName);
    const initialSelectedProfileId = useDacpacDialogSelector((state) => state.selectedProfileId);

    // Local state
    const [operationType, setOperationType] = useState<dacpacDialog.DacPacDialogOperationType>(
        initialOperationType || dacpacDialog.DacPacDialogOperationType.Deploy,
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
    const [availableConnections, setAvailableConnections] = useState<IConnectionDialogProfile[]>(
        [],
    );
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
                void context?.cancel();
            }
        };
    }, []);

    // Load available databases when server or operation changes
    useEffect(() => {
        if (
            ownerUri &&
            (operationType === dacpacDialog.DacPacDialogOperationType.Deploy ||
                operationType === dacpacDialog.DacPacDialogOperationType.Extract ||
                operationType === dacpacDialog.DacPacDialogOperationType.Export)
        ) {
            void loadDatabases();
        }
    }, [operationType, ownerUri]);

    // Update file path suggestion when database or operation type changes for Export/Extract
    useEffect(() => {
        const updateSuggestedPath = async () => {
            if (
                databaseName &&
                (operationType === dacpacDialog.DacPacDialogOperationType.Extract ||
                    operationType === dacpacDialog.DacPacDialogOperationType.Export) &&
                context?.getSuggestedOutputPath
            ) {
                // Get the suggested full path from the controller
                const result = await context.getSuggestedOutputPath({
                    databaseName,
                    operationType,
                });

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

            const result = await context?.initializeConnection({
                initialServerName,
                initialDatabaseName,
                initialOwnerUri,
                initialProfileId: initialSelectedProfileId,
            });

            if (result) {
                // Set all available connections
                setAvailableConnections(result.connections);

                // If a connection was selected/matched
                if (result.selectedConnection) {
                    setSelectedProfileId(result.selectedConnection.id!);

                    // If we have an ownerUri (either provided or from auto-connect)
                    if (result.ownerUri) {
                        setOwnerUri(result.ownerUri);
                    }

                    // Show error if auto-connect failed
                    if (result.errorMessage && !result.autoConnected) {
                        setValidationMessages((prev) => ({
                            ...prev,
                            connection: {
                                message: `${locConstants.dacpacDialog.connectionFailed}: ${result.errorMessage}`,
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
                    message: `${locConstants.dacpacDialog.connectionFailed}: ${errorMsg}`,
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
        const selectedConnection = availableConnections.find((conn) => conn.id === profileId);

        if (!selectedConnection) {
            return;
        }

        setIsConnecting(true);

        try {
            // Connect to the server
            const result = await context?.connectToServer({ profileId });

            if (result?.isConnected && result.ownerUri) {
                setOwnerUri(result.ownerUri);
                // Databases will be loaded automatically via useEffect
            } else {
                // Connection failed - clear state
                setOwnerUri("");
                setAvailableDatabases([]);
                setDatabaseName("");
                // Show error message to user
                const errorMsg = result?.errorMessage || locConstants.dacpacDialog.connectionFailed;
                setValidationMessages({
                    connection: {
                        message: errorMsg,
                        severity: "error",
                    },
                });
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            setValidationMessages({
                connection: {
                    message: `${locConstants.dacpacDialog.connectionFailed}: ${errorMsg}`,
                    severity: "error",
                },
            });
        } finally {
            setIsConnecting(false);
        }
    };

    const loadDatabases = async () => {
        try {
            const result = await context?.listDatabases({ ownerUri: ownerUri || "" });
            if (result?.databases) {
                setAvailableDatabases(result.databases);
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            setValidationMessages((prev) => ({
                ...prev,
                database: {
                    message: `${locConstants.dacpacDialog.failedToLoadDatabases}: ${errorMsg}`,
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
                    message: locConstants.dacpacDialog.filePathRequired,
                    severity: "error",
                },
            }));
            return false;
        }

        try {
            const result = await context?.validateFilePath({ filePath: path, shouldExist });

            if (!result?.isValid) {
                setValidationMessages((prev) => ({
                    ...prev,
                    filePath: {
                        message: result?.errorMessage || locConstants.dacpacDialog.invalidFile,
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
                error instanceof Error ? error.message : locConstants.dacpacDialog.validationFailed;
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
                    message: locConstants.dacpacDialog.databaseNameRequired,
                    severity: "error",
                },
            }));
            return false;
        }

        try {
            const result = await context?.validateDatabaseName({
                databaseName: dbName,
                ownerUri: ownerUri || "",
                shouldNotExist: shouldNotExist,
                operationType: operationType,
            });

            if (!result?.isValid) {
                setValidationMessages((prev) => ({
                    ...prev,
                    databaseName: {
                        message: result?.errorMessage || locConstants.dacpacDialog.invalidDatabase,
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
                operationType === dacpacDialog.DacPacDialogOperationType.Deploy &&
                result.errorMessage === locConstants.dacpacDialog.databaseAlreadyExists
            ) {
                const confirmResult = await context?.confirmDeployToExisting();

                return confirmResult?.confirmed === true;
            }

            return true;
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : locConstants.dacpacDialog.validationFailed;
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

    /**
     * Validates application version format (n.n.n.n where n is a number)
     * @returns true if validation passes, false otherwise
     */
    const validateApplicationVersion = (version: string): boolean => {
        if (!version) {
            setValidationMessages((prev) => ({
                ...prev,
                applicationVersion: {
                    message: locConstants.dacpacDialog.invalidApplicationVersion,
                    severity: "error",
                },
            }));
            return false;
        }

        // Regex to match n.n.n.n format where n is one or more digits
        // Allows 3 or 4 parts (1.0.0 or 1.0.0.0)
        const versionRegex = /^\d+\.\d+\.\d+(\.\d+)?$/;

        if (!versionRegex.test(version)) {
            setValidationMessages((prev) => ({
                ...prev,
                applicationVersion: {
                    message: locConstants.dacpacDialog.invalidApplicationVersion,
                    severity: "error",
                },
            }));
            return false;
        }

        // Clear validation error if valid
        setValidationMessages((prev) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { applicationVersion: _av, ...rest } = prev;
            return rest;
        });
        return true;
    };

    /**
     * Helper to determine validation requirements based on operation type
     */
    const getValidationRequirements = (opType: dacpacDialog.DacPacDialogOperationType) => {
        switch (opType) {
            case dacpacDialog.DacPacDialogOperationType.Deploy:
                return { filePathShouldExist: true, databaseShouldNotExist: isNewDatabase };
            case dacpacDialog.DacPacDialogOperationType.Extract:
                return { filePathShouldExist: false, databaseShouldNotExist: false };
            case dacpacDialog.DacPacDialogOperationType.Import:
                return { filePathShouldExist: true, databaseShouldNotExist: true };
            case dacpacDialog.DacPacDialogOperationType.Export:
                return { filePathShouldExist: false, databaseShouldNotExist: false };
        }
    };

    /**
     * Validates file path and database name based on operation requirements
     * @returns true if validation passes, false otherwise
     */
    const validateOperationInputs = async (
        opType: dacpacDialog.DacPacDialogOperationType,
    ): Promise<boolean> => {
        const requirements = getValidationRequirements(opType);

        const filePathValid = await validateFilePath(filePath, requirements.filePathShouldExist);
        const databaseValid = await validateDatabaseName(
            databaseName,
            requirements.databaseShouldNotExist,
        );

        // For Extract operation, also validate application version
        let versionValid = true;
        if (opType === dacpacDialog.DacFxOperationType.Extract) {
            versionValid = validateApplicationVersion(applicationVersion);
        }

        return filePathValid && databaseValid && versionValid;
    };

    const handleSubmit = async () => {
        setIsOperationInProgress(true);

        try {
            // Validate inputs before proceeding
            if (!(await validateOperationInputs(operationType))) {
                setIsOperationInProgress(false);
                return;
            }

            let result;

            switch (operationType) {
                case dacpacDialog.DacPacDialogOperationType.Deploy:
                    result = await context?.deployDacpac({
                        packageFilePath: filePath,
                        databaseName,
                        isNewDatabase,
                        ownerUri: ownerUri || "",
                    });
                    break;

                case dacpacDialog.DacPacDialogOperationType.Extract:
                    result = await context?.extractDacpac({
                        databaseName,
                        packageFilePath: filePath,
                        applicationName,
                        applicationVersion,
                        ownerUri: ownerUri || "",
                    });
                    break;

                case dacpacDialog.DacPacDialogOperationType.Import:
                    result = await context?.importBacpac({
                        packageFilePath: filePath,
                        databaseName,
                        ownerUri: ownerUri || "",
                    });
                    break;

                case dacpacDialog.DacPacDialogOperationType.Export:
                    result = await context?.exportBacpac({
                        databaseName,
                        packageFilePath: filePath,
                        ownerUri: ownerUri || "",
                    });
                    break;
            }

            if (result?.success) {
                setIsOperationInProgress(false);
                clearForm();
            } else {
                console.error(result?.errorMessage || locConstants.dacpacDialog.operationFailed);
                setIsOperationInProgress(false);
            }
        } catch (error) {
            console.error(
                error instanceof Error ? error.message : locConstants.dacpacDialog.unexpectedError,
            );
            setIsOperationInProgress(false);
        }
    };

    const handleBrowseFile = async () => {
        const fileExtension =
            operationType === dacpacDialog.DacPacDialogOperationType.Deploy ||
            operationType === dacpacDialog.DacPacDialogOperationType.Extract
                ? "dacpac"
                : "bacpac";

        let result: { filePath?: string } | undefined;

        if (requiresInputFile) {
            // Browse for input file (Deploy or Import)
            result = await context?.browseInputFile({
                fileExtension,
            });
        } else {
            // Browse for output file (Extract or Export)
            // Use the suggested filename from state, or get from backend
            let defaultFileName = filePath;

            if (!defaultFileName && context) {
                // Get suggested filename with timestamp from backend
                const filenameResult = await context.getSuggestedFilename({
                    databaseName: databaseName || "database",
                    fileExtension,
                });

                if (filenameResult?.filename) {
                    defaultFileName = filenameResult.filename;
                }
            }

            result = await context?.browseOutputFile({
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

            // For Deploy/Import operations, suggest database name from the selected file
            // Only auto-suggest if the dialog was NOT launched with a specific database context
            if (
                requiresInputFile &&
                context &&
                (operationType === dacpacDialog.DacPacDialogOperationType.Deploy ||
                    operationType === dacpacDialog.DacPacDialogOperationType.Import)
            ) {
                const nameResult = await context.getSuggestedDatabaseName({
                    filePath: result.filePath,
                });

                if (nameResult?.databaseName) {
                    setDatabaseName(nameResult.databaseName);
                    // Clear any existing database name validation errors
                    const updatedMessages = { ...validationMessages };
                    delete updatedMessages.databaseName;
                    setValidationMessages(updatedMessages);
                }
            }
        }
    };

    const handleCancel = async () => {
        await context?.cancel();
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
        operationType === dacpacDialog.DacPacDialogOperationType.Deploy ||
        operationType === dacpacDialog.DacPacDialogOperationType.Import;
    const showDatabaseTarget = operationType === dacpacDialog.DacPacDialogOperationType.Deploy;
    const showDatabaseSource =
        operationType === dacpacDialog.DacPacDialogOperationType.Extract ||
        operationType === dacpacDialog.DacPacDialogOperationType.Export;
    const showNewDatabase = operationType === dacpacDialog.DacPacDialogOperationType.Import;
    const showApplicationInfo = operationType === dacpacDialog.DacPacDialogOperationType.Extract;

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
                    <div className={classes.title}>{locConstants.dacpacDialog.title}</div>
                    <div className={classes.description}>
                        {locConstants.dacpacDialog.subtitle}{" "}
                        <Link href="https://learn.microsoft.com/en-us/sql/tools/sql-database-projects/concepts/data-tier-applications/overview?view=sql-server-ver17">
                            {locConstants.dacpacDialog.learnMore}
                        </Link>
                    </div>
                </div>

                <OperationTypeSection
                    operationType={operationType}
                    setOperationType={setOperationType}
                    isOperationInProgress={isOperationInProgress}
                    onOperationTypeChange={() => {
                        setValidationMessages({});
                        // Reset file path when switching operation types
                        // Import/Deploy need empty (browse for existing file)
                        // Export/Extract will be set when database name changes
                        setFilePath("");
                    }}
                />

                <ServerSelectionSection
                    selectedProfileId={selectedProfileId}
                    availableConnections={availableConnections}
                    isConnecting={isConnecting}
                    isOperationInProgress={isOperationInProgress}
                    validationMessages={validationMessages}
                    onServerChange={(profileId) => void handleServerChange(profileId)}
                />

                {/* For Extract/Export: Show database selection BEFORE file path */}
                {showDatabaseSource && (
                    <SourceDatabaseSection
                        databaseName={databaseName}
                        setDatabaseName={setDatabaseName}
                        availableDatabases={availableDatabases}
                        isOperationInProgress={isOperationInProgress}
                        ownerUri={ownerUri}
                        validationMessages={validationMessages}
                        showDatabaseSource={showDatabaseSource}
                        showNewDatabase={false}
                    />
                )}

                <FilePathSection
                    filePath={filePath}
                    setFilePath={setFilePath}
                    requiresInputFile={requiresInputFile}
                    isOperationInProgress={isOperationInProgress}
                    validationMessages={validationMessages}
                    onBrowseFile={handleBrowseFile}
                    onFilePathChange={handleFilePathChange}
                />

                {/* For Deploy: Show target database AFTER file path */}
                {showDatabaseTarget && (
                    <TargetDatabaseSection
                        databaseName={databaseName}
                        setDatabaseName={setDatabaseName}
                        isNewDatabase={isNewDatabase}
                        setIsNewDatabase={setIsNewDatabase}
                        availableDatabases={availableDatabases}
                        isOperationInProgress={isOperationInProgress}
                        ownerUri={ownerUri}
                        validationMessages={validationMessages}
                    />
                )}

                {/* For Import: Show new database name AFTER file path */}
                {showNewDatabase && (
                    <SourceDatabaseSection
                        databaseName={databaseName}
                        setDatabaseName={setDatabaseName}
                        availableDatabases={availableDatabases}
                        isOperationInProgress={isOperationInProgress}
                        ownerUri={ownerUri}
                        validationMessages={validationMessages}
                        showDatabaseSource={false}
                        showNewDatabase={showNewDatabase}
                    />
                )}

                {showApplicationInfo && (
                    <ApplicationInfoSection
                        applicationName={applicationName}
                        setApplicationName={setApplicationName}
                        applicationVersion={applicationVersion}
                        setApplicationVersion={setApplicationVersion}
                        isOperationInProgress={isOperationInProgress}
                        validationMessages={validationMessages}
                        onApplicationVersionChange={async (value) => {
                            validateApplicationVersion(value);
                        }}
                    />
                )}

                <div className={classes.actions}>
                    <Button
                        appearance="secondary"
                        onClick={handleCancel}
                        disabled={isOperationInProgress}
                        aria-label={locConstants.dacpacDialog.cancel}>
                        {locConstants.dacpacDialog.cancel}
                    </Button>
                    <Button
                        appearance="primary"
                        icon={<DatabaseArrowRight20Regular />}
                        onClick={handleSubmit}
                        disabled={!isFormValid() || isOperationInProgress || isConnecting}
                        aria-label={locConstants.dacpacDialog.execute}>
                        {locConstants.dacpacDialog.execute}
                    </Button>
                </div>
            </div>
        </div>
    );
};

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
    actions: {
        display: "flex",
        gap: "8px",
        justifyContent: "flex-end",
        marginTop: "16px",
        paddingTop: "16px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
});
