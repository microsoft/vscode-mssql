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
    makeStyles,
    Popover,
    PopoverTrigger,
    PopoverSurface,
} from "@fluentui/react-components";
import {
    ColorArea,
    ColorPicker,
    ColorPickerProps,
    ColorSlider,
} from "@fluentui/react-color-picker";
import { TinyColor } from "@ctrl/tinycolor";
import { locConstants as Loc } from "../../common/locConstants";
import {
    ConnectionGroupSpec,
    ConnectionGroupState,
} from "../../../sharedInterfaces/connectionGroup";
import { useState } from "react";

const useStyles = makeStyles({
    previewColor: {
        width: "80px",
        borderRadius: "4px",
        border: "1px solid #ccc",
        alignSelf: "stretch",
        "@media (forced-colors: active)": {
            forcedColorAdjust: "none",
        },
    },
    row: {
        display: "flex",
        gap: "10px",
    },
    sliders: {
        display: "flex",
        flexDirection: "column",
    },
    colorContainer: {
        display: "flex",
        alignItems: "center",
        gap: "15px",
    },
});

/** Generates a random Hex color */
function getRandomColor(): string {
    const letters = "0123456789ABCDEF";
    let color = "#";
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

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
    const styles = useStyles();

    const intialHsvColor = new TinyColor(state.color || getRandomColor()).toHsv();

    const [groupName, setGroupName] = useState(state.existingGroupName || "");
    const [description, setDescription] = useState(state.description || "");
    const [color, setColor] = useState(intialHsvColor);
    const [pickerColor, setPickerColor] = useState(intialHsvColor);
    const [popoverOpen, setPopoverOpen] = useState(false);

    const handleChange: ColorPickerProps["onColorChange"] = (_, data) => {
        setColor({ ...data.color, a: 1 });
    };

    return (
        <Dialog open={true /* standalone dialog always open*/}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>
                        {state.existingGroupName
                            ? `Edit Connection Group: ${state.existingGroupName}`
                            : "Create New Connection Group"}
                    </DialogTitle>
                    <DialogContent>
                        {state.message && (
                            <>
                                <MessageBar intent="error" style={{ paddingRight: "12px" }}>
                                    {state.message}
                                </MessageBar>
                                <br />
                            </>
                        )}

                        <Field className={formStyles.formComponentDiv} label="Name" required>
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
                            <div className={styles.colorContainer}>
                                <div
                                    className={styles.previewColor}
                                    style={{
                                        backgroundColor: new TinyColor(pickerColor).toRgbString(),
                                    }}
                                    onClick={() => {
                                        setPopoverOpen(true);
                                    }}
                                />
                                <Popover
                                    open={popoverOpen}
                                    trapFocus
                                    onOpenChange={(_, data) => setPopoverOpen(data.open)}>
                                    <PopoverTrigger disableButtonEnhancement>
                                        <Button style={{ minWidth: "120px" }}>Choose color</Button>
                                    </PopoverTrigger>

                                    <PopoverSurface>
                                        <ColorPicker
                                            color={new TinyColor(color).toHsv()}
                                            onColorChange={handleChange}>
                                            <ColorArea
                                                inputX={{ "aria-label": "Saturation" }}
                                                inputY={{ "aria-label": "Brightness" }}
                                            />
                                            <div className={styles.row}>
                                                <div className={styles.sliders}>
                                                    <ColorSlider aria-label="Hue" />
                                                </div>
                                                <div
                                                    className={styles.previewColor}
                                                    style={{
                                                        backgroundColor: new TinyColor(
                                                            color,
                                                        ).toRgbString(),
                                                    }}
                                                />
                                            </div>
                                        </ColorPicker>
                                        <div className={styles.row}>
                                            <Button
                                                appearance="primary"
                                                onClick={() => {
                                                    setPickerColor(color);
                                                    setPopoverOpen(false);
                                                }}>
                                                Ok
                                            </Button>
                                            <Button
                                                onClick={() => {
                                                    setPopoverOpen(false);
                                                }}>
                                                Cancel
                                            </Button>
                                        </div>
                                    </PopoverSurface>
                                </Popover>
                            </div>
                        </Field>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            style={{ width: "auto", whiteSpace: "nowrap" }}
                            onClick={() => {
                                saveConnectionGroup({
                                    name: groupName,
                                    description: description || undefined,
                                    color:
                                        new TinyColor(color).toHexString(false /* allow3Char */) ||
                                        undefined,
                                });
                            }}
                            disabled={groupName.length === 0}>
                            Save Connection Group
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
