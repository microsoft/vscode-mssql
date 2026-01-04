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
import { Copy24Regular, Eye24Regular, EyeOff24Regular } from "@fluentui/react-icons";
import { useState, useEffect } from "react";
import { LocConstants } from "../../../common/locConstants";
import { PublishProjectContextProps } from "../publishProjectStateProvider";
import { MaskMode } from "../../../../sharedInterfaces/publishDialog";

interface SqlPackageCommandDialogProps {
    isOpen: boolean;
    onClose: () => void;
    publishContext: PublishProjectContextProps;
}

export const SqlPackageCommandDialog: React.FC<SqlPackageCommandDialogProps> = ({
    isOpen,
    onClose,
    publishContext,
}) => {
    const loc = LocConstants.getInstance().publishProject;
    const commonLoc = LocConstants.getInstance().common;

    const [maskedCommand, setMaskedCommand] = useState<string>("");
    const [unmaskedCommand, setUnmaskedCommand] = useState<string>("");
    const [isShowingMasked, setIsShowingMasked] = useState(true);

    // Clear cache when dialog closes
    useEffect(() => {
        if (!isOpen) {
            setMaskedCommand("");
            setUnmaskedCommand("");
            setIsShowingMasked(true);
        }
    }, [isOpen]);

    // Fetch masked command when dialog opens
    useEffect(() => {
        if (isOpen && !maskedCommand) {
            publishContext
                .generateSqlPackageCommand(MaskMode.Masked)
                .then((cmd) => setMaskedCommand(cmd))
                .catch((err) => console.error("Error fetching masked command:", err));
        }
    }, [isOpen, maskedCommand, publishContext]);

    const handleCopySqlPackageCommand = async () => {
        const command = isShowingMasked ? maskedCommand : unmaskedCommand;
        await navigator.clipboard.writeText(command);
    };

    const handleToggleMaskMode = async () => {
        const newShowMasked = !isShowingMasked;
        setIsShowingMasked(newShowMasked);

        // Fetch unmasked if not already fetched
        if (!newShowMasked && !unmaskedCommand) {
            publishContext
                .generateSqlPackageCommand(MaskMode.Unmasked)
                .then((cmd) => setUnmaskedCommand(cmd))
                .catch((err) => console.error("Error fetching unmasked command:", err));
        }
    };

    const currentCommand = isShowingMasked ? maskedCommand : unmaskedCommand;
    const eyeIcon = isShowingMasked ? <EyeOff24Regular /> : <Eye24Regular />;
    const eyeTooltip = isShowingMasked ? loc.showUnmaskedCommand : loc.showMaskedCommand;

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
                        <div style={{ display: "flex", gap: "4px" }}>
                            <Button
                                appearance="transparent"
                                size="small"
                                icon={eyeIcon}
                                onClick={handleToggleMaskMode}
                                title={eyeTooltip}
                            />
                            <Button
                                appearance="transparent"
                                size="small"
                                icon={<Copy24Regular />}
                                onClick={handleCopySqlPackageCommand}
                                title={loc.copySqlPackageCommandToClipboard}
                            />
                        </div>
                    </DialogTitle>
                    <DialogContent style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
                        <Textarea
                            value={currentCommand}
                            readOnly
                            resize="none"
                            style={{
                                height: "100%",
                                minHeight: "300px",
                                fontFamily: "var(--vscode-editor-font-family, monospace)",
                                fontSize: "var(--vscode-editor-font-size, 13px)",
                            }}
                            aria-label={loc.SqlPackageCommandTitle}
                        />
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
