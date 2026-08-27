/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import {
    Button,
    Drawer,
    DrawerBody,
    DrawerFooter,
    DrawerHeader,
    DrawerHeaderTitle,
    Dropdown,
    Field,
    Input,
    InputProps,
    Label,
    makeStyles,
    Radio,
    RadioGroup,
    useId,
    Option,
    OptionGroup,
    SelectionEvents,
    OptionOnSelectData,
    Spinner,
    Tooltip,
    tokens,
} from "@fluentui/react-components";
import { Dismiss24Regular, ErrorCircle16Regular, FolderFilled } from "@fluentui/react-icons";
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

const useStyles = makeStyles({
    drawerWidth: {
        width: "400px",
    },

    fileInputWidth: {
        width: "300px",
    },

    positionItemsHorizontally: {
        display: "flex",
        flexDirection: "row",
    },

    connectionSelectionRow: {
        display: "flex",
        flexDirection: "row",
        marginBottom: "8px",
    },

    databaseSelectionRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },

    buttonLeftMargin: {
        marginLeft: "8px",
    },

    footer: {
        display: "flex",
        justifyContent: "flex-end",
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
        .sort((connA, connB) => connA.text.localeCompare(connB.text));
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
        <Drawer
            separator
            open={props.show}
            onOpenChange={(_, { open: show }) => props.showDrawer(show)}
            position="end"
            size="medium">
            <DrawerHeader>
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
            <DrawerBody>
                <Field label={loc.schemaCompare.type}>
                    <RadioGroup
                        value={schemaType}
                        onChange={(_, data) => handleSchemaTypeChange(data.value)}>
                        <Radio value="database" label={loc.schemaCompare.database} />
                        <Radio value="dacpac" label={loc.schemaCompare.dacpacDialogFile} />
                        {isSqlProjExtensionInstalled && (
                            <Radio value="sqlproj" label={loc.schemaCompare.databaseProject} />
                        )}
                    </RadioGroup>
                </Field>

                {schemaType === "database" && (
                    <>
                        <Label>{loc.schemaCompare.connection}</Label>
                        <div className={classes.connectionSelectionRow}>
                            <SearchableDropdown
                                style={{ width: "300px" }}
                                options={connectionOptions}
                                selectedOption={{
                                    value: serverConnectionUri,
                                    text: serverName,
                                }}
                                onSelect={handleDatabaseServerSelected}
                                ariaLabel={loc.schemaCompare.connection}
                                showPlaceholder
                            />
                        </div>
                        <Label>{loc.schemaCompare.database}</Label>
                        <div className={classes.databaseSelectionRow}>
                            <Dropdown
                                className={classes.fileInputWidth}
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
                                        <OptionGroup key={groupName} label={groupName}>
                                            {databaseOptions.map((database) => (
                                                <Option key={database.value} value={database.value}>
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
                                <Tooltip content={displayedDatabaseError} relationship="label">
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
                    </>
                )}

                {(schemaType === "dacpac" || schemaType === "sqlproj") && (
                    <>
                        <Label htmlFor={fileId}>{loc.schemaCompare.file}</Label>
                        <div className={classes.positionItemsHorizontally}>
                            <Input
                                id={fileId}
                                size={props.size}
                                disabled={props.disabled}
                                className={classes.fileInputWidth}
                                value={getFilePathForProjectOrDacpac()}
                                readOnly
                            />

                            <Button
                                className={classes.buttonLeftMargin}
                                size="large"
                                icon={<FolderFilled />}
                                onClick={() => handleSelectFile(schemaType)}
                            />
                        </div>

                        {props.endpointType === "target" && schemaType === "sqlproj" && (
                            <>
                                <Label htmlFor={folderStructureId}>
                                    {loc.schemaCompare.folderStructure}
                                </Label>
                                <div>
                                    <Dropdown
                                        id={folderStructureId}
                                        className={classes.fileInputWidth}
                                        value={folderStructure}
                                        selectedOptions={[folderStructure]}
                                        onOptionSelect={(event, data) =>
                                            handleFolderStructureSelected(event, data)
                                        }>
                                        {options.map((option) => {
                                            return (
                                                <Option key={option.value}>{option.display}</Option>
                                            );
                                        })}
                                    </Dropdown>
                                </div>
                            </>
                        )}
                    </>
                )}
            </DrawerBody>
            <DrawerFooter>
                <Button
                    disabled={disableOkButton}
                    appearance="primary"
                    onClick={() => confirmSelectedEndpoint()}>
                    {loc.schemaCompare.ok}
                </Button>
                <Button appearance="secondary" onClick={() => props.showDrawer(false)}>
                    {loc.schemaCompare.cancel}
                </Button>
            </DrawerFooter>
        </Drawer>
    );
};

export default SchemaSelectorDrawer;
