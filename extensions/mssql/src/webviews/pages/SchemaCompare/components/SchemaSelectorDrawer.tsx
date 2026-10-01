/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import {
    Button,
    DrawerBody,
    DrawerFooter,
    DrawerHeader,
    DrawerHeaderTitle,
    Dropdown,
    Input,
    InputProps,
    makeStyles,
    OverlayDrawer,
    Radio,
    RadioGroup,
    useId,
    Option,
    OptionGroup,
    SelectionEvents,
    OptionOnSelectData,
    Spinner,
    Text,
    Tooltip,
    tokens,
} from "@fluentui/react-components";
import {
    Database16Regular,
    Dismiss24Regular,
    DocumentDatabase20Regular,
    ErrorCircle16Regular,
    FolderOpenRegular,
} from "@fluentui/react-icons";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { useSchemaCompareSelector } from "../schemaCompareSelector";
import { locConstants as loc } from "../../../common/locConstants";
import {
    SchemaCompareEndpointType,
    ExtractTarget,
} from "../../../../sharedInterfaces/schemaCompare";
import {
    SearchableDropdown,
    SearchableDropdownOptions,
} from "../../../common/searchableDropdown.component";
import { DatabaseProjectIcon } from "./DatabaseProjectIcon";

const useStyles = makeStyles({
    drawer: {
        width: "640px",
        maxWidth: "calc(100vw - 32px)",
        backgroundColor: "var(--vscode-editor-background)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--vscode-font-family)",
        fontSize: tokens.fontSizeBase300,
        "& input, & button": {
            fontFamily: "var(--vscode-font-family)",
        },
        "& .fui-Radio__label, & .fui-Button, & .fui-Input__input": {
            fontSize: "13px",
            lineHeight: "18px",
        },
    },
    drawerHeader: {
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
        padding: "16px 24px",
    },
    drawerBody: {
        flex: 1,
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
        backgroundColor: "var(--vscode-editor-background)",
        padding: 0,
        boxSizing: "border-box",
    },
    settingsLayout: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        padding: "0 24px 24px",
        boxSizing: "border-box",
    },
    settingsContent: {
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        height: "100%",
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        paddingTop: "24px",
        paddingBottom: "72px",
        boxSizing: "border-box",
    },
    section: {
        display: "flex",
        flexDirection: "column",
        rowGap: "14px",
        paddingBottom: "28px",
    },
    sectionWithDivider: {
        marginLeft: "-24px",
        marginRight: "-24px",
        paddingLeft: "24px",
        paddingRight: "24px",
        paddingTop: "28px",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    sectionTitle: {
        fontSize: tokens.fontSizeBase300,
        lineHeight: tokens.lineHeightBase300,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    sectionBody: {
        display: "flex",
        flexDirection: "column",
        rowGap: "14px",
    },
    fieldRow: {
        display: "grid",
        gridTemplateColumns: "140px minmax(0, 1fr)",
        columnGap: "24px",
        alignItems: "start",
        "@media (max-width: 520px)": {
            gridTemplateColumns: "1fr",
            rowGap: "6px",
        },
    },
    fieldLabel: {
        paddingTop: "5px",
        color: tokens.colorNeutralForeground1,
        fontSize: "13px",
        lineHeight: "18px",
        fontWeight: tokens.fontWeightSemibold,
    },
    fieldControl: {
        minWidth: 0,
        width: "100%",
    },
    controlWithStatus: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minWidth: 0,
    },
    fileInput: {
        minWidth: 0,
        width: "100%",
    },
    browseButton: {
        minWidth: "24px",
        width: "24px",
        height: "24px",
        padding: 0,
    },
    endpointTypeLabel: {
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
    },
    endpointTypeIcon: {
        width: "16px",
        height: "16px",
        flexShrink: 0,
    },
    drawerFooter: {
        alignSelf: "stretch",
        justifyContent: "flex-end",
        columnGap: "12px",
        padding: "12px 24px",
        marginTop: 0,
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        borderTop: "1px solid var(--vscode-editorGroup-border)",
    },
    actionButton: {
        minWidth: "112px",
        whiteSpace: "nowrap",
    },
});

function endpointTypeToString(endpointType: number | undefined): string {
    if (endpointType === undefined) {
        return "";
    }

    switch (endpointType) {
        case SchemaCompareEndpointType.Database:
            return "database";
        case SchemaCompareEndpointType.Dacpac:
            return "dacpac";
        case SchemaCompareEndpointType.Project:
            return "sqlproj";
        default:
            return "";
    }
}

function extractTargetTypeToString(extractTarget: number | undefined): string {
    if (extractTarget === undefined) {
        return "";
    }

    switch (extractTarget) {
        case ExtractTarget.file:
            return "File";
        case ExtractTarget.flat:
            return "Flat";
        case ExtractTarget.objectType:
            return "Object Type";
        case ExtractTarget.schema:
            return "Schema";
        case ExtractTarget.schemaObjectType:
        default:
            return "Schema/Object Type";
    }
}

interface Props extends InputProps {
    show: boolean;
    endpointType: "source" | "target";
    showDrawer: (show: boolean) => void;
}

const SchemaSelectorDrawer = (props: Props) => {
    const classes = useStyles();

    const context = useContext(schemaCompareContext);
    const sourceEndpointInfo = useSchemaCompareSelector((s) => s.sourceEndpointInfo);
    const targetEndpointInfo = useSchemaCompareSelector((s) => s.targetEndpointInfo);
    const auxiliaryEndpointInfo = useSchemaCompareSelector((s) => s.auxiliaryEndpointInfo);
    const connections = useSchemaCompareSelector((s) => s.connections);
    const databases = useSchemaCompareSelector((s) => s.databases);
    const databaseListConnectionId = useSchemaCompareSelector((s) => s.databaseListConnectionId);
    const isDatabaseListLoading = useSchemaCompareSelector((s) => s.isDatabaseListLoading);
    const databaseListError = useSchemaCompareSelector((s) => s.databaseListError);
    const isSqlProjectExtensionInstalled = useSchemaCompareSelector(
        (s) => s.isSqlProjectExtensionInstalled,
    );

    const currentEndpoint =
        props.endpointType === "source" ? sourceEndpointInfo : targetEndpointInfo;
    const currentServerConnectionId =
        currentEndpoint?.connectionId || currentEndpoint?.ownerUri || "";

    const [schemaType, setSchemaType] = useState(
        endpointTypeToString(currentEndpoint?.endpointType || SchemaCompareEndpointType.Database),
    );
    const [disableOkButton, setDisableOkButton] = useState(true);
    const [serverConnectionUri, setServerConnectionUri] = useState(currentServerConnectionId);
    const [serverName, setServerName] = useState(
        currentEndpoint?.connectionName || currentEndpoint?.serverName || "",
    );
    const [databaseName, setDatabaseName] = useState(currentEndpoint?.databaseName || "");
    const [folderStructure, setFolderStructure] = useState(
        extractTargetTypeToString(currentEndpoint?.extractTarget || ExtractTarget.schemaObjectType),
    );
    const databaseStateMatchesSelection = databaseListConnectionId === serverConnectionUri;
    const displayedDatabases = databaseStateMatchesSelection ? databases : [];
    const showDatabaseSpinner =
        Boolean(serverConnectionUri) && (!databaseStateMatchesSelection || isDatabaseListLoading);
    const displayedDatabaseError = databaseStateMatchesSelection ? databaseListError : "";
    const connectionOptions = Object.entries(connections)
        .map(([connectionId, connection]) => ({
            value: connectionId,
            text: connection.profileName || connection.server,
        }))
        .sort((connectionA, connectionB) =>
            connectionA.text.localeCompare(connectionB.text, undefined, {
                numeric: true,
                sensitivity: "base",
            }),
        );
    const databaseGroups = new Map<string, typeof displayedDatabases>();
    for (const database of displayedDatabases) {
        const groupName = database.groupName ?? "";
        const group = databaseGroups.get(groupName) ?? [];
        group.push(database);
        databaseGroups.set(groupName, group);
    }
    const firstDisplayedDatabase = displayedDatabases[0]?.value;

    const fileId = useId("file");
    const folderStructureId: string = useId("folderStructure");

    const options = [
        { value: "File", display: loc.schemaCompare.file },
        { value: "Flat", display: loc.schemaCompare.flat },
        { value: "Object Type", display: loc.schemaCompare.objectType },
        { value: "Schema", display: loc.schemaCompare.schema },
        {
            value: "Schema/Object Type",
            display: loc.schemaCompare.schemaObjectType,
        },
    ];

    useEffect(() => {
        context.listActiveServers();

        if (currentServerConnectionId) {
            context.listDatabasesForActiveServer(
                currentServerConnectionId,
                currentEndpoint?.databaseName,
            );
        }
    }, []);

    useEffect(() => {
        updateOkButtonState(schemaType);
    }, [
        auxiliaryEndpointInfo,
        serverConnectionUri,
        databaseName,
        showDatabaseSpinner,
        displayedDatabaseError,
    ]);

    useEffect(() => {
        if (
            schemaType === "database" &&
            databaseStateMatchesSelection &&
            !isDatabaseListLoading &&
            !databaseListError &&
            !databaseName &&
            firstDisplayedDatabase
        ) {
            setDatabaseName(firstDisplayedDatabase);
        }
    }, [
        schemaType,
        databaseStateMatchesSelection,
        isDatabaseListLoading,
        databaseListError,
        databaseName,
        firstDisplayedDatabase,
    ]);

    // Handle auto-selection of newly created connections
    useEffect(() => {
        if (currentServerConnectionId && currentEndpoint?.databaseName) {
            // Update local state when endpoint info changes (e.g., from auto-selection)
            if (serverConnectionUri !== currentServerConnectionId) {
                setServerConnectionUri(currentServerConnectionId);
                setServerName(currentEndpoint.connectionName || currentEndpoint.serverName || "");
            }
            if (databaseName !== currentEndpoint.databaseName) {
                setDatabaseName(currentEndpoint.databaseName);
            }
        }
    }, [
        currentEndpoint?.connectionId,
        currentEndpoint?.ownerUri,
        currentEndpoint?.databaseName,
        currentEndpoint?.connectionName,
        currentEndpoint?.serverName,
    ]);

    const drawerTitle =
        props.endpointType === "source"
            ? loc.schemaCompare.selectSource
            : loc.schemaCompare.selectTarget;

    const updateOkButtonState = (type: string) => {
        if (
            type === "database" &&
            serverConnectionUri &&
            databaseName &&
            !showDatabaseSpinner &&
            !displayedDatabaseError
        ) {
            setDisableOkButton(false);
        } else if (
            type === "dacpac" &&
            (auxiliaryEndpointInfo?.packageFilePath || currentEndpoint?.packageFilePath)
        ) {
            setDisableOkButton(false);
        } else if (
            type === "sqlproj" &&
            (auxiliaryEndpointInfo?.projectFilePath || currentEndpoint?.projectFilePath)
        ) {
            setDisableOkButton(false);
        } else {
            setDisableOkButton(true);
        }
    };

    const getFilePathForProjectOrDacpac = () => {
        if (schemaType === "dacpac") {
            return auxiliaryEndpointInfo?.packageFilePath || currentEndpoint?.packageFilePath || "";
        } else if (schemaType === "sqlproj") {
            return auxiliaryEndpointInfo?.projectFilePath || currentEndpoint?.projectFilePath || "";
        }
    };

    const handleSchemaTypeChange = (type: string) => {
        setSchemaType(type);

        updateOkButtonState(type);
    };

    const handleDatabaseServerSelected = (option: SearchableDropdownOptions) => {
        if (option.value) {
            const connectionDatabaseName = connections[option.value]?.database ?? "";
            setServerConnectionUri(option.value);
            setServerName(option.text ?? option.value);
            setDatabaseName(connectionDatabaseName);
            context.listDatabasesForActiveServer(option.value, connectionDatabaseName);
        }
    };

    const handleDatabaseSelected = (_: SelectionEvents, data: OptionOnSelectData) => {
        if (data.optionValue) {
            setDatabaseName(data.optionValue);
        }
    };

    const handleSelectFile = (fileType: "dacpac" | "sqlproj") => {
        const endpoint = props.endpointType === "source" ? sourceEndpointInfo : targetEndpointInfo;

        context.selectFile(endpoint, props.endpointType, fileType);
    };

    const handleFolderStructureSelected = (_: SelectionEvents, data: OptionOnSelectData) => {
        if (data.optionValue) {
            setFolderStructure(data.optionValue);
        }
    };

    const confirmSelectedEndpoint = () => {
        if (schemaType === "database") {
            context.confirmSelectedDatabase(props.endpointType, serverConnectionUri, databaseName);
        } else {
            context.confirmSelectedSchema(props.endpointType, folderStructure);
        }

        props.showDrawer(false);
    };

    let isSqlProjExtensionInstalled = isSqlProjectExtensionInstalled;
    return (
        <OverlayDrawer
            open={props.show}
            onOpenChange={(_, data) => {
                if (data.type !== "backdropClick") {
                    props.showDrawer(data.open);
                }
            }}
            position="end"
            className={classes.drawer}>
            <DrawerHeader className={classes.drawerHeader}>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label={loc.schemaCompare.close}
                            icon={<Dismiss24Regular />}
                            onClick={() => props.showDrawer(false)}
                        />
                    }>
                    {drawerTitle}
                </DrawerHeaderTitle>
            </DrawerHeader>
            <DrawerBody className={classes.drawerBody}>
                <div className={classes.settingsLayout}>
                    <div className={classes.settingsContent}>
                        <section className={classes.section}>
                            <Text className={classes.sectionTitle}>{loc.schemaCompare.type}</Text>
                            <RadioGroup
                                value={schemaType}
                                aria-label={loc.schemaCompare.type}
                                onChange={(_, data) => handleSchemaTypeChange(data.value)}>
                                <Radio
                                    value="database"
                                    label={
                                        <span className={classes.endpointTypeLabel}>
                                            <Database16Regular
                                                className={classes.endpointTypeIcon}
                                            />
                                            {loc.schemaCompare.database}
                                        </span>
                                    }
                                />
                                <Radio
                                    value="dacpac"
                                    label={
                                        <span className={classes.endpointTypeLabel}>
                                            <DocumentDatabase20Regular
                                                className={classes.endpointTypeIcon}
                                            />
                                            {loc.schemaCompare.dacpacDialogFile}
                                        </span>
                                    }
                                />
                                {isSqlProjExtensionInstalled && (
                                    <Radio
                                        value="sqlproj"
                                        label={
                                            <span className={classes.endpointTypeLabel}>
                                                <DatabaseProjectIcon
                                                    className={classes.endpointTypeIcon}
                                                />
                                                {loc.schemaCompare.databaseProject}
                                            </span>
                                        }
                                    />
                                )}
                            </RadioGroup>
                        </section>

                        {schemaType === "database" && (
                            <section className={`${classes.section} ${classes.sectionWithDivider}`}>
                                <Text className={classes.sectionTitle}>
                                    {loc.schemaCompare.database}
                                </Text>
                                <div className={classes.sectionBody}>
                                    <div className={classes.fieldRow}>
                                        <Text className={classes.fieldLabel}>
                                            {loc.schemaCompare.connection}
                                        </Text>
                                        <div className={classes.fieldControl}>
                                            <SearchableDropdown
                                                style={{ width: "100%" }}
                                                options={connectionOptions}
                                                selectedOption={{
                                                    value: serverConnectionUri,
                                                    text: serverName,
                                                }}
                                                onSelect={handleDatabaseServerSelected}
                                                ariaLabel={loc.schemaCompare.connection}
                                                placeholder={loc.common.select}
                                                showPlaceholder
                                            />
                                        </div>
                                    </div>
                                    <div className={classes.fieldRow}>
                                        <Text className={classes.fieldLabel}>
                                            {loc.schemaCompare.database}
                                        </Text>
                                        <div className={classes.controlWithStatus}>
                                            <Dropdown
                                                className={classes.fieldControl}
                                                aria-label={loc.schemaCompare.database}
                                                value={
                                                    showDatabaseSpinner && !databaseName
                                                        ? loc.common.loadingWithEllipsis
                                                        : databaseName
                                                }
                                                selectedOptions={databaseName ? [databaseName] : []}
                                                disabled={
                                                    showDatabaseSpinner ||
                                                    Boolean(displayedDatabaseError) ||
                                                    displayedDatabases.length === 0
                                                }
                                                onOptionSelect={(event, data) =>
                                                    handleDatabaseSelected(event, data)
                                                }>
                                                {Array.from(databaseGroups.entries()).map(
                                                    ([groupName, databaseOptions]) => (
                                                        <OptionGroup
                                                            key={groupName}
                                                            label={groupName}>
                                                            {databaseOptions.map((database) => (
                                                                <Option
                                                                    key={database.value}
                                                                    value={database.value}>
                                                                    {database.displayName}
                                                                </Option>
                                                            ))}
                                                        </OptionGroup>
                                                    ),
                                                )}
                                            </Dropdown>
                                            {showDatabaseSpinner && (
                                                <Spinner
                                                    size="extra-tiny"
                                                    aria-label={loc.common.loadingWithEllipsis}
                                                />
                                            )}
                                            {!showDatabaseSpinner && displayedDatabaseError && (
                                                <Tooltip
                                                    content={displayedDatabaseError}
                                                    relationship="label">
                                                    <span
                                                        tabIndex={0}
                                                        role="img"
                                                        aria-label={displayedDatabaseError}>
                                                        <ErrorCircle16Regular
                                                            style={{
                                                                color: tokens.colorPaletteRedForeground1,
                                                            }}
                                                        />
                                                    </span>
                                                </Tooltip>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </section>
                        )}

                        {(schemaType === "dacpac" || schemaType === "sqlproj") && (
                            <section className={`${classes.section} ${classes.sectionWithDivider}`}>
                                <Text className={classes.sectionTitle}>
                                    {loc.schemaCompare.file}
                                </Text>
                                <div className={classes.sectionBody}>
                                    <div className={classes.fieldRow}>
                                        <Text className={classes.fieldLabel}>
                                            {loc.schemaCompare.file}
                                        </Text>
                                        <Input
                                            id={fileId}
                                            aria-label={loc.schemaCompare.file}
                                            size={props.size}
                                            disabled={props.disabled}
                                            className={classes.fileInput}
                                            value={getFilePathForProjectOrDacpac()}
                                            readOnly
                                            contentAfter={
                                                <Button
                                                    type="button"
                                                    className={classes.browseButton}
                                                    size="small"
                                                    appearance="subtle"
                                                    aria-label={loc.dacpacDialog.browse}
                                                    icon={<FolderOpenRegular />}
                                                    onClick={() => handleSelectFile(schemaType)}
                                                />
                                            }
                                        />
                                    </div>

                                    {props.endpointType === "target" &&
                                        schemaType === "sqlproj" && (
                                            <div className={classes.fieldRow}>
                                                <Text className={classes.fieldLabel}>
                                                    {loc.schemaCompare.folderStructure}
                                                </Text>
                                                <Dropdown
                                                    id={folderStructureId}
                                                    className={classes.fieldControl}
                                                    aria-label={loc.schemaCompare.folderStructure}
                                                    value={folderStructure}
                                                    selectedOptions={[folderStructure]}
                                                    onOptionSelect={(event, data) =>
                                                        handleFolderStructureSelected(event, data)
                                                    }>
                                                    {options.map((option) => (
                                                        <Option
                                                            key={option.value}
                                                            value={option.value}>
                                                            {option.display}
                                                        </Option>
                                                    ))}
                                                </Dropdown>
                                            </div>
                                        )}
                                </div>
                            </section>
                        )}
                    </div>
                </div>
            </DrawerBody>
            <DrawerFooter className={classes.drawerFooter}>
                <Button
                    className={classes.actionButton}
                    appearance="secondary"
                    onClick={() => props.showDrawer(false)}>
                    {loc.schemaCompare.cancel}
                </Button>
                <Button
                    className={classes.actionButton}
                    disabled={disableOkButton}
                    appearance="primary"
                    onClick={() => confirmSelectedEndpoint()}>
                    {loc.schemaCompare.ok}
                </Button>
            </DrawerFooter>
        </OverlayDrawer>
    );
};

export default SchemaSelectorDrawer;
