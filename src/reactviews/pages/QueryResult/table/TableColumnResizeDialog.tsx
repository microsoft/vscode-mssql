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
import { locConstants } from "../../../common/locConstants";
import { MAX_COLUMN_WIDTH_PX as maxWidth, MIN_COLUMN_WIDTH as minWidth } from "../table/table";

interface TableColumnResizeDialogProps {
    open: boolean;
    columnName: string;
    initialWidth: number;
    onSubmit: (width: number) => Promise<void> | void;
    onDismiss: () => void;
}

export const TableColumnResizeDialog: React.FC<TableColumnResizeDialogProps> = ({
    open,
    columnName,
    initialWidth,
    onSubmit,
    onDismiss,
}) => {
    const [inputValue, setInputValue] = useState<string>(Math.round(initialWidth).toString());

    useEffect(() => {
        if (open) {
            setInputValue(Math.round(initialWidth).toString());
        }
    }, [initialWidth, open]);

    const isValid = (inputValue: string) => {
        const parsedWidth = parseInt(inputValue);
        const isValid = Number.isFinite(parsedWidth) && parsedWidth >= minWidth;
        return isValid;
    };

    if (!open) {
        return null;
    }

    const handleSubmit = () => {
        if (!isValid(inputValue)) {
            return;
        }
        void onSubmit(parseInt(inputValue));
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(_, data) => {
                if (!data.open) {
                    onDismiss();
                }
            }}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{locConstants.queryResult.resizeColumn(columnName)}</DialogTitle>
                    <DialogContent>
                        <Field
                            label={locConstants.queryResult.enterDesiredColumnWidth}
                            validationMessage={
                                isValid(inputValue)
                                    ? undefined
                                    : locConstants.queryResult.resizeValidationError(minWidth)
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
                                        handleSubmit();
                                    }
                                }}
                            />
                        </Field>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            onClick={handleSubmit}
                            disabled={!isValid(inputValue)}>
                            {locConstants.queryResult.resize}
                        </Button>
                        <Button appearance="secondary" onClick={onDismiss}>
                            {locConstants.common.cancel}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
