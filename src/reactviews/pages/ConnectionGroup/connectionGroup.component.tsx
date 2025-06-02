/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useFormStyles } from "../../common/forms/form.component";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Input,
    Textarea,
    MessageBar,
    Field,
} from "@fluentui/react-components";

import { locConstants as Loc } from "../../common/locConstants";
import {
    ConnectionGroupSpec,
    ConnectionGroupState,
} from "../../../sharedInterfaces/connectionGroup";
import { useState } from "react";

export const ConnectionGroupDialog = ({
    state,
    saveConnectionGroup,
    closeDialog,
}: {
    state: ConnectionGroupState;
    saveConnectionGroup: (connectionGroupSpec: ConnectionGroupSpec) => void;
    closeDialog: () => void;
}) => {
    const formStyles = useFormStyles();

    const [groupName, setGroupName] = useState(state.existingGroupName || "");
    const [description, setDescription] = useState(state.description || "");
    const [color, setColor] = useState(state.color || "");

    return (
        <Dialog open={true /* standalone dialog always open*/}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>
                        {state.existingGroupName
                            ? `Edit Connection Group - ${state.existingGroupName}`
                            : "Create New Connection Group"}
                    </DialogTitle>
                    <DialogContent>
                        <MessageBar intent="error" style={{ paddingRight: "12px" }}>
                            {state.message}
                        </MessageBar>
                        <br />

                        <Field className={formStyles.formComponentDiv} label="Name">
                            <Input
                                value={groupName}
                                onChange={(_e, data) => {
                                    setGroupName(data.value);
                                }}
                                required
                                placeholder="Enter connection group name"
                            />
                        </Field>

                        <Field className={formStyles.formComponentDiv} label="Description">
                            <Textarea
                                value={description}
                                onChange={(_e, data) => {
                                    setDescription(data.value);
                                }}
                                placeholder="Enter description (optional)"
                            />
                        </Field>

                        <Field className={formStyles.formComponentDiv} label="Color">
                            <Input
                                type="text"
                                value={color}
                                onChange={(_e, data) => {
                                    setColor(data.value);
                                }}
                                placeholder="Enter color (e.g., #FF5733)"
                            />
                        </Field>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            onClick={() => {
                                saveConnectionGroup({
                                    name: groupName,
                                    description: description,
                                    color: color,
                                });
                            }}
                            disabled={false}>
                            "Create Connection Group"
                        </Button>
                        <Button
                            appearance="secondary"
                            onClick={() => {
                                closeDialog();
                            }}>
                            {Loc.common.cancel}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
