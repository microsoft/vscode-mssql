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
    Field,
    Input,
    InputProps,
    Label,
    makeStyles,
    Radio,
    RadioGroup,
    useId,
} from "@fluentui/react-components";
import { Dismiss24Regular, FolderFilled } from "@fluentui/react-icons";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { locConstants as loc } from "../../../common/locConstants";

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

interface Props extends InputProps {
    show: boolean;
    endpointType: "source" | "target";
    showDrawer: (show: boolean) => void;
}

const SchemaSelectorDrawer = (props: Props) => {
    const classes = useStyles();

    const context = useContext(schemaCompareContext);
    const [schemaType, setSchemaType] = useState("database");
    const [disableOkButton, setDisableOkButton] = useState(true);

    const fileId = useId("file");

    useEffect(() => {
        updateOkButtonState(schemaType);
    }, [context.state.auxiliaryEndpointInfo]);

    const drawerTitle =
        props.endpointType === "source"
            ? loc.schemaCompare.selectSource
            : loc.schemaCompare.selectTarget;

    const currentEndpoint =
        props.endpointType === "source"
            ? context.state.sourceEndpointInfo
            : context.state.targetEndpointInfo;

    const updateOkButtonState = (type: string) => {
        if (
            type === "dacpac" &&
            context.state.auxiliaryEndpointInfo?.packageFilePath
        ) {
            setDisableOkButton(false);
        } else if (
            type === "sqlproj" &&
            context.state.auxiliaryEndpointInfo?.projectFilePath
        ) {
            setDisableOkButton(false);
        } else {
            setDisableOkButton(true);
        }
    };

    const handleSchemaTypeChange = (type: string) => {
        setSchemaType(type);

        updateOkButtonState(type);
    };

    const handleSelectFile = (fileType: "dacpac" | "sqlproj") => {
        const endpoint =
            props.endpointType === "source"
                ? context.state.sourceEndpointInfo
                : context.state.targetEndpointInfo;

        context.selectFile(endpoint, props.endpointType, fileType);
    };

    const confirmSelectedEndpoint = () => {
        context.confirmSelectedSchema(props.endpointType);

        props.showDrawer(false);
    };

    return (
        <Drawer
            separator
            open={props.show}
            onOpenChange={(_, { open: show }) => props.showDrawer(show)}
            position="end"
            size="medium"
        >
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label={loc.schemaCompare.close}
                            icon={<Dismiss24Regular />}
                            onClick={() => props.showDrawer(false)}
                        />
                    }
                >
                    {drawerTitle}
                </DrawerHeaderTitle>
            </DrawerHeader>
            <DrawerBody>
                <Field label={loc.schemaCompare.type}>
                    <RadioGroup
                        value={schemaType}
                        onChange={(_, data) =>
                            handleSchemaTypeChange(data.value)
                        }
                    >
                        <Radio
                            value="database"
                            label={loc.schemaCompare.database}
                        />
                        <Radio
                            value="dacpac"
                            label={loc.schemaCompare.dataTierApplicationFile}
                        />
                        <Radio
                            value="sqlproj"
                            label={loc.schemaCompare.databaseProject}
                        />
                    </RadioGroup>

                    {(schemaType === "dacpac" || schemaType === "sqlproj") && (
                        <>
                            <Label htmlFor={fileId}>
                                {loc.schemaCompare.file}
                            </Label>
                            <div className={classes.positionItemsHorizontally}>
                                <Input
                                    id={fileId}
                                    size={props.size}
                                    disabled={props.disabled}
                                    className={classes.fileInputWidth}
                                    value={
                                        context.state.auxiliaryEndpointInfo
                                            ?.projectFilePath ||
                                        currentEndpoint?.projectFilePath ||
                                        ""
                                    }
                                    readOnly
                                />

                                <Button
                                    className={classes.buttonLeftMargin}
                                    size="large"
                                    icon={<FolderFilled />}
                                    onClick={() => handleSelectFile(schemaType)}
                                />
                            </div>
                        </>
                    )}
                </Field>
            </DrawerBody>
            <DrawerFooter>
                <Button
                    disabled={disableOkButton}
                    appearance="primary"
                    onClick={() => confirmSelectedEndpoint()}
                >
                    {loc.schemaCompare.ok}
                </Button>
                <Button
                    appearance="secondary"
                    onClick={() => props.showDrawer(false)}
                >
                    {loc.schemaCompare.cancel}
                </Button>
            </DrawerFooter>
        </Drawer>
    );
};

export default SchemaSelectorDrawer;
