/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Copy24Regular, Eye24Regular, EyeOff24Regular } from "@fluentui/react-icons";
import { useState, useEffect } from "react";
import { LocConstants } from "../../../common/locConstants";
import { PublishProjectContextProps } from "../publishProjectStateProvider";
import { MaskMode } from "../../../../sharedInterfaces/publishDialog";
import { TextViewDialog } from "../../../common/textViewDialog";
import { getErrorMessage } from "../../../common/utils";

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
    const [errorMessage, setErrorMessage] = useState<string>("");

    // Clear cache when dialog closes
    useEffect(() => {
        if (!isOpen) {
            setMaskedCommand("");
            setUnmaskedCommand("");
            setIsShowingMasked(true);
            setErrorMessage("");
        }
    }, [isOpen]);

    // Fetch masked command when dialog opens
    useEffect(() => {
        if (isOpen && !maskedCommand && !errorMessage) {
            publishContext
                .generateSqlPackageCommand(MaskMode.Masked)
                .then((result) => {
                    if (!result.success) {
                        setErrorMessage(result.errorMessage);
                        setMaskedCommand("");
                    } else {
                        setMaskedCommand(result.command || "");
                        setErrorMessage("");
                    }
                })
                .catch((err) => {
                    console.error("Error fetching masked command:", err);
                    setErrorMessage(getErrorMessage(err));
                });
        }
    }, [isOpen, maskedCommand, errorMessage, publishContext]);

    const handleCopySqlPackageCommand = async () => {
        const command = isShowingMasked ? maskedCommand : unmaskedCommand;
        try {
            await navigator.clipboard.writeText(command);
        } catch (error) {
            console.error("Failed to copy SqlPackage command:", error);
        }
    };

    const handleToggleMaskMode = async () => {
        const newShowMasked = !isShowingMasked;
        setIsShowingMasked(newShowMasked);

        // Fetch unmasked if not already fetched
        if (!newShowMasked && !unmaskedCommand) {
            publishContext
                .generateSqlPackageCommand(MaskMode.Unmasked)
                .then((result) => {
                    if (!result.success) {
                        setErrorMessage(result.errorMessage);
                        setUnmaskedCommand("");
                    } else {
                        setUnmaskedCommand(result.command || "");
                        // Clear any previous errors when successfully fetching
                        setErrorMessage("");
                    }
                })
                .catch((err) => {
                    console.error("Error fetching unmasked command:", err);
                    setErrorMessage(getErrorMessage(err));
                });
        }
    };

    const currentCommand = isShowingMasked ? maskedCommand : unmaskedCommand;
    const eyeIcon = isShowingMasked ? <EyeOff24Regular /> : <Eye24Regular />;
    const eyeTooltip = isShowingMasked ? loc.showUnmaskedCommand : loc.showMaskedCommand;

    return (
        <TextViewDialog
            isOpen={isOpen}
            onClose={onClose}
            title={loc.SqlPackageCommandTitle}
            text={currentCommand}
            readOnly={true}
            textareaHeight="300px"
            autoFocus={true}
            ariaLabel={loc.SqlPackageCommandTitle}
            errorMessage={errorMessage}
            headerButtons={[
                {
                    icon: eyeIcon,
                    title: eyeTooltip,
                    onClick: handleToggleMaskMode,
                },
                {
                    icon: <Copy24Regular />,
                    title: loc.copySqlPackageCommandToClipboard,
                    onClick: handleCopySqlPackageCommand,
                },
            ]}
            actions={[
                {
                    label: commonLoc.close,
                    appearance: "secondary",
                    onClick: onClose,
                },
            ]}
        />
    );
};
