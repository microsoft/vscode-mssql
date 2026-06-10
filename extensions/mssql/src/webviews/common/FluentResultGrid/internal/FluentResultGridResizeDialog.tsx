/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    Input,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
import type { FluentResultGridCloseOverlayOptions } from "./fluentResultGridProviderTypes";
import type { FluentResultGridResizeDialogOverlayState } from "./fluentResultGridOverlays";
import type { FluentResultGridStrings } from "../types/fluentResultGridStrings";

const defaultMinColumnWidth = 50;
const defaultMaxColumnWidth = 400;

export interface FluentResultGridResizeDialogProps {
    overlay: FluentResultGridResizeDialogOverlayState;
    strings: FluentResultGridStrings;
    closeOverlay: (options?: FluentResultGridCloseOverlayOptions) => void;
}

function parseColumnWidth(value: string): number {
    return Number.parseInt(value, 10);
}

function isColumnWidthValid(value: string, minWidth: number, maxWidth: number): boolean {
    const parsedWidth = parseColumnWidth(value);
    return Number.isFinite(parsedWidth) && parsedWidth >= minWidth && parsedWidth <= maxWidth;
}

export function FluentResultGridResizeDialog({
    overlay,
    strings,
    closeOverlay,
}: FluentResultGridResizeDialogProps) {
    const minWidth = overlay.minWidth ?? defaultMinColumnWidth;
    const maxWidth = overlay.maxWidth ?? defaultMaxColumnWidth;
    const [inputValue, setInputValue] = useState<string>(
        Math.round(overlay.initialWidth).toString(),
    );
    const isValid = isColumnWidthValid(inputValue, minWidth, maxWidth);

    useEffect(() => {
        setInputValue(Math.round(overlay.initialWidth).toString());
    }, [overlay.initialWidth]);

    const handleSubmit = async () => {
        if (!isValid) {
            return;
        }

        await overlay.onSubmit(parseColumnWidth(inputValue));
        closeOverlay({ notifyDismiss: false });
    };

    return (
        <Dialog
            open={true}
            onOpenChange={(_, data) => {
                if (!data.open) {
                    closeOverlay();
                }
            }}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{strings.resizeDialog.title(overlay.columnName)}</DialogTitle>
                    <DialogContent>
                        <Field
                            label={strings.resizeDialog.widthLabel}
                            validationMessage={
                                isValid
                                    ? undefined
                                    : strings.resizeDialog.validationError(minWidth, maxWidth)
                            }>
                            <Input
                                type="number"
                                value={inputValue}
                                min={minWidth}
                                max={maxWidth}
                                onChange={(_, data) => setInputValue(data.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        void handleSubmit();
                                    }
                                }}
                            />
                        </Field>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="primary" onClick={handleSubmit} disabled={!isValid}>
                            {strings.resizeDialog.submit}
                        </Button>
                        <Button appearance="secondary" onClick={() => closeOverlay()}>
                            {strings.resizeDialog.cancel}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
