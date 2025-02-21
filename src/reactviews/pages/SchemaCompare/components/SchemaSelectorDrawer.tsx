/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DrawerBody,
    DrawerFooter,
    DrawerHeader,
    DrawerHeaderTitle,
    Field,
    InlineDrawer,
    Input,
    InputProps,
    Label,
    makeStyles,
    Radio,
    RadioGroup,
    useId,
} from "@fluentui/react-components";
import {
    Dismiss24Regular,
    FolderFilled,
    PlugDisconnectedFilled,
} from "@fluentui/react-icons";
import { useContext, useState, useEffect } from "react";
import { schemaCompareContext } from "../SchemaCompareStateProvider";

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
        marginLeft: "2px",
    },

    footer: {
        display: "flex",
        justifyContent: "flex-end",
    },
});

interface Props extends InputProps {}

const SchemaSelectorDrawer = (props: Props) => {
    const classes = useStyles();
    const context = useContext(schemaCompareContext);

    const fileId = useId("file");
    const serverId = useId("server");
    const databaseId = useId("database");

    const [schemaType, setSchemaType] = useState("database");
    const [disableOkButton, setDisableOkButton] = useState(true);

    useEffect(() => {
        context.state.dacpacPath = "";
        context.state.sqlProjPath = "";
    }, []);

    useEffect(() => {
        updateOkButtonState(schemaType);
    }, [context.state.dacpacPath, context.state.sqlProjPath]);

    let drawerTitle = "";
    if (context.selectSourceDrawer.open) {
        drawerTitle = "Select Source";
    }

    const closeDrawer = () => {
        context.selectSourceDrawer.setOpen(false);
    };

    const updateOkButtonState = (type: string) => {
        if (type === "dacpac") {
            setDisableOkButton(
                context.state.dacpacPath === "" ||
                    context.state.dacpacPath === undefined,
            );
        } else if (type === "sqlproj") {
            setDisableOkButton(
                context.state.sqlProjPath === "" ||
                    context.state.sqlProjPath === undefined,
            );
        }
    };

    const handleSchemaTypeChange = (type: string) => {
        setSchemaType(type);

        updateOkButtonState(type);
    };

    const handleSelectFile = () => {
        context.getFilePath(context.state.sourceEndpointInfo, schemaType);
    };

    const handleConfirmSelectedSchema = () => {
        context.updateSelectedSchema(
            "source",
            schemaType,
            schemaType === "dacpac"
                ? context.state.dacpacPath
                : context.state.sqlProjPath,
        );
    };

    return (
        <InlineDrawer
            separator
            position="end"
            open={context.selectSourceDrawer.open}
            className={classes.drawerWidth}
        >
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label="Close"
                            icon={<Dismiss24Regular />}
                            onClick={closeDrawer}
                        />
                    }
                >
                    {drawerTitle}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody>
                <Field label="Type">
                    <RadioGroup
                        value={schemaType}
                        onChange={(_, data) =>
                            handleSchemaTypeChange(data.value)
                        }
                    >
                        <Radio value="database" label="Database" />
                        <Radio
                            value="dacpac"
                            label="Data-tier Application File (.dacpac)"
                        />
                        <Radio value="sqlproj" label="Database Project" />
                    </RadioGroup>
                </Field>

                {schemaType === "dacpac" && (
                    <>
                        <Label
                            htmlFor={fileId}
                            size={props.size}
                            disabled={props.disabled}
                        >
                            File
                        </Label>
                        <div className={classes.positionItemsHorizontally}>
                            <Input
                                id={fileId}
                                className={classes.fileInputWidth}
                                {...props}
                                value={context.state.dacpacPath || ""}
                                readOnly
                            />

                            <Button
                                className={classes.buttonLeftMargin}
                                size="large"
                                icon={<FolderFilled />}
                                onClick={handleSelectFile}
                            />
                        </div>
                    </>
                )}

                {schemaType === "sqlproj" && (
                    <>
                        <Label
                            htmlFor={fileId}
                            size={props.size}
                            disabled={props.disabled}
                        >
                            File
                        </Label>
                        <div className={classes.positionItemsHorizontally}>
                            <Input
                                id={fileId}
                                className={classes.fileInputWidth}
                                {...props}
                                value={context.state.sqlProjPath || ""}
                                readOnly
                            />

                            <Button
                                className={classes.buttonLeftMargin}
                                size="large"
                                icon={<FolderFilled />}
                                onClick={handleSelectFile}
                            />
                        </div>
                    </>
                )}

                {schemaType === "database" && (
                    <>
                        <Label
                            htmlFor={serverId}
                            size={props.size}
                            disabled={props.disabled}
                        >
                            Server
                        </Label>
                        <div className={classes.positionItemsHorizontally}>
                            <Input
                                id={serverId}
                                className={classes.fileInputWidth}
                                {...props}
                                value={""}
                                readOnly
                            />

                            <Button
                                className={classes.buttonLeftMargin}
                                size="large"
                                icon={<PlugDisconnectedFilled />}
                            />
                        </div>
                        <Label
                            htmlFor={databaseId}
                            size={props.size}
                            disabled={props.disabled}
                        >
                            Database
                        </Label>
                        <Input
                            id={databaseId}
                            className={classes.fileInputWidth}
                            {...props}
                            value={""}
                            readOnly
                        />
                    </>
                )}
            </DrawerBody>
            <DrawerFooter className={classes.footer}>
                <Button
                    disabled={disableOkButton}
                    appearance="primary"
                    onClick={handleConfirmSelectedSchema}
                >
                    OK
                </Button>
                <Button appearance="secondary" onClick={closeDrawer}>
                    Cancel
                </Button>
            </DrawerFooter>
        </InlineDrawer>
    );
};

export default SchemaSelectorDrawer;
