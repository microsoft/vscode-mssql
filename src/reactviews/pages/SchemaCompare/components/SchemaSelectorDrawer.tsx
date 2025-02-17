/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DrawerBody,
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
import { Dismiss24Regular, FolderFilled } from "@fluentui/react-icons";
import { useContext, useState } from "react";
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
});

interface Props extends InputProps {}

const SchemaSelectorDrawer = (props: Props) => {
    const fileId = useId("file");
    const context = useContext(schemaCompareContext);
    const classes = useStyles();

    const handleSelectFile = () => {
        context.getFilePath(context.state.sourceEndpointInfo, "dacpac");
    };

    let drawerTitle = "";
    if (context.selectSourceDrawer.open) {
        drawerTitle = "Select Source";
    }

    const [value, setValue] = useState(0);

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
                            onClick={() =>
                                context.selectSourceDrawer.setOpen(false)
                            }
                        />
                    }
                >
                    {drawerTitle}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody>
                <Field label="Type">
                    <RadioGroup
                        value={value.toString()}
                        onChange={(_, data) => setValue(Number(data.value))}
                    >
                        <Radio value="0" label="Database" />
                        <Radio
                            value="1"
                            label="Data-tier Application File (.dacpac)"
                        />
                        <Radio value="2" label="Database Project" />
                    </RadioGroup>
                </Field>

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
                        value={context.state.filePath || ""}
                        readOnly
                    />

                    <Button
                        className={classes.buttonLeftMargin}
                        size="large"
                        icon={<FolderFilled />}
                        onClick={handleSelectFile}
                    />
                </div>
            </DrawerBody>
        </InlineDrawer>
    );
};

export default SchemaSelectorDrawer;
