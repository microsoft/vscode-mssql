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
    Textarea,
} from "@fluentui/react-components";
import { Copy24Regular } from "@fluentui/react-icons";
import React, { useCallback } from "react";
import { LocConstants } from "../../../common/locConstants";

interface SqlPackageCommandDialogProps {
    isOpen: boolean;
    onClose: () => void;
    sqlPackageCommand: string;
}

export const SqlPackageCommandDialog: React.FC<SqlPackageCommandDialogProps> = ({
    isOpen,
    onClose,
    sqlPackageCommand,
}) => {
    const loc = LocConstants.getInstance().publishProject;
    const commonLoc = LocConstants.getInstance().common;

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(sqlPackageCommand);
        } catch (error) {
            console.error("Failed to copy sqlpackage command: ", error);
        }
    }, [sqlPackageCommand]);

    return (
        <Dialog open={isOpen}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                        }}>
                        <span>{loc.SqlPackageCommandTitle}</span>
                    </DialogTitle>
                    <DialogContent>
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                marginTop: "10px",
                            }}>
                            <Textarea
                                value={sqlPackageCommand}
                                readOnly
                                resize="none"
                                style={{
                                    height: "200px",
                                    fontFamily: "var(--vscode-editor-font-family, monospace)",
                                    fontSize: "var(--vscode-editor-font-size, 13px)",
                                }}
                                aria-label={loc.SqlPackageCommandTitle}
                            />
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onClose}>
                            {commonLoc.close}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
