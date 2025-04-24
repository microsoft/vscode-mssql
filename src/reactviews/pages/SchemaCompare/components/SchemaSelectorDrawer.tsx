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
    SelectionEvents,
    OptionOnSelectData,
} from "@fluentui/react-components";
import { Dismiss24Regular, FolderFilled, PlugDisconnectedRegular } from "@fluentui/react-icons";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { locConstants as loc } from "../../../common/locConstants";
import {
    SchemaCompareEndpointType,
    SharedExtractTarget,
} from "../../../../sharedInterfaces/schemaCompare";

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
        case SharedExtractTarget.file:
            return "File";
        case SharedExtractTarget.flat:
            return "Flat";
        case SharedExtractTarget.objectType:
            return "Object Type";
        case SharedExtractTarget.schema:
            return "Schema";
        case SharedExtractTarget.schemaObjectType:
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

    const currentEndpoint =
        props.endpointType === "source"
            ? context.state.sourceEndpointInfo
            : context.state.targetEndpointInfo;

    const [schemaType, setSchemaType] = useState(
        endpointTypeToString(currentEndpoint?.endpointType || SchemaCompareEndpointType.Database),
    );
    const [disableOkButton, setDisableOkButton] = useState(true);
    const [serverConnectionUri, setServerConnectionUri] = useState(currentEndpoint?.ownerUri || "");
    const [serverName, setServerName] = useState(
        currentEndpoint?.connectionName || currentEndpoint?.serverName || "",
    );
    const [databaseName, setDatabaseName] = useState(currentEndpoint?.databaseName || "");
    const [folderStructure, setFolderStructure] = useState(
        extractTargetTypeToString(
            currentEndpoint?.extractTarget || SharedExtractTarget.schemaObjectType,
        ),
    );

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

        if (currentEndpoint?.ownerUri) {
            context.listDatabasesForActiveServer(currentEndpoint?.ownerUri);
        }
    }, []);

    useEffect(() => {
        updateOkButtonState(schemaType);
    }, [context.state.auxiliaryEndpointInfo, serverConnectionUri, databaseName]);

    const drawerTitle =
        props.endpointType === "source"
            ? loc.schemaCompare.selectSource
            : loc.schemaCompare.selectTarget;

    const updateOkButtonState = (type: string) => {
        if (type === "database" && serverConnectionUri && databaseName) {
            setDisableOkButton(false);
        } else if (
            type === "dacpac" &&
            (context.state.auxiliaryEndpointInfo?.packageFilePath ||
                currentEndpoint?.packageFilePath)
        ) {
            setDisableOkButton(false);
        } else if (
            type === "sqlproj" &&
            (context.state.auxiliaryEndpointInfo?.projectFilePath ||
                currentEndpoint?.projectFilePath)
        ) {
            setDisableOkButton(false);
        } else {
            setDisableOkButton(true);
        }
    };

    const getFilePathForProjectOrDacpac = () => {
        if (schemaType === "dacpac") {
            return (
                context.state.auxiliaryEndpointInfo?.packageFilePath ||
                currentEndpoint?.packageFilePath ||
                ""
            );
        } else if (schemaType === "sqlproj") {
            return (
                context.state.auxiliaryEndpointInfo?.projectFilePath ||
                currentEndpoint?.projectFilePath ||
                ""
            );
        }
    };

    const handleSchemaTypeChange = (type: string) => {
        setSchemaType(type);

        updateOkButtonState(type);
    };

    const handleDatabaseServerSelected = (_: SelectionEvents, data: OptionOnSelectData) => {
        if (data.optionValue) {
            setServerConnectionUri(data.optionValue);
            setServerName(data.optionText ?? "");
            setDatabaseName("");
            context.listDatabasesForActiveServer(data.optionValue);
        }
    };

    const handleDatabaseSelected = (_: SelectionEvents, data: OptionOnSelectData) => {
        if (data.optionValue) {
            setDatabaseName(data.optionValue);
        }
    };

    const handleSelectFile = (fileType: "dacpac" | "sqlproj") => {
        const endpoint =
            props.endpointType === "source"
                ? context.state.sourceEndpointInfo
                : context.state.targetEndpointInfo;

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

    let isSqlProjExtensionInstalled = context.state.isSqlProjectExtensionInstalled;

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
                        <Radio value="dacpac" label={loc.schemaCompare.dataTierApplicationFile} />
                        {isSqlProjExtensionInstalled && (
                            <Radio value="sqlproj" label={loc.schemaCompare.databaseProject} />
                        )}
                    </RadioGroup>
                </Field>

                {schemaType === "database" && (
                    <>
                        <Label>{loc.schemaCompare.server}</Label>
                        <div className={classes.positionItemsHorizontally}>
                            <Dropdown
                                className={classes.fileInputWidth}
                                value={serverName}
                                selectedOptions={[serverConnectionUri]}
                                onOptionSelect={(event, data) =>
                                    handleDatabaseServerSelected(event, data)
                                }>
                                {Object.keys(context.state.activeServers).map((connUri) => {
                                    return (
                                        <Option key={connUri} value={connUri}>
                                            {context.state.activeServers[connUri].profileName ||
                                                context.state.activeServers[connUri].server}
                                        </Option>
                                    );
                                })}
                            </Dropdown>
                            <Button
                                className={classes.buttonLeftMargin}
                                size="large"
                                icon={<PlugDisconnectedRegular />}
                                onClick={() => {
                                    context.openAddNewConnectionDialog();
                                }}
                            />
                        </div>
                        <Label>{loc.schemaCompare.database}</Label>
                        <div>
                            <Dropdown
                                className={classes.fileInputWidth}
                                value={databaseName}
                                selectedOptions={[databaseName]}
                                onOptionSelect={(event, data) =>
                                    handleDatabaseSelected(event, data)
                                }>
                                {context.state.databases.map((db) => {
                                    return (
                                        <Option key={db} value={db}>
                                            {db}
                                        </Option>
                                    );
                                })}
                            </Dropdown>
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
