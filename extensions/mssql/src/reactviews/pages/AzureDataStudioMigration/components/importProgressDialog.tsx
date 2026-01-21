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
    Spinner,
    Text,
    makeStyles,
} from "@fluentui/react-components";
import { CheckmarkCircle16Filled, Warning16Regular } from "@fluentui/react-icons";

import { ImportProgressDialogProps } from "../../../../sharedInterfaces/azureDataStudioMigration";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants as Loc } from "../../../common/locConstants";

const useStyles = makeStyles({
    progressSection: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    resultRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    successIcon: {
        color: "var(--vscode-testing-iconPassed)",
    },
    errorIcon: {
        color: "var(--vscode-testing-iconErrored)",
    },
});

interface ImportProgressDialogComponentProps {
    dialog: ImportProgressDialogProps;
    onDismiss: () => void;
}

export const ImportProgressDialog = ({ dialog, onDismiss }: ImportProgressDialogComponentProps) => {
    const styles = useStyles();
    const loc = Loc.azureDataStudioMigration;

    const statusIcon =
        dialog.status.status === ApiStatus.Error ? (
            <Warning16Regular className={styles.errorIcon} />
        ) : (
            <CheckmarkCircle16Filled className={styles.successIcon} />
        );

    return (
        <Dialog
            open
            modalType="modal"
            onOpenChange={(_, data) => {
                if (!data.open && !(dialog.status.status === ApiStatus.Loading)) {
                    onDismiss();
                }
            }}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{loc.importProgressDialogTitle}</DialogTitle>
                    <DialogContent>
                        {dialog.status.status === ApiStatus.Loading ? (
                            <div className={styles.progressSection}>
                                <Text>{dialog.status.message}</Text>
                                <Spinner />
                            </div>
                        ) : (
                            <div className={styles.resultRow}>
                                {statusIcon}
                                <Text>{dialog.status.message}</Text>
                            </div>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="secondary"
                            onClick={onDismiss}
                            disabled={dialog.status.status === ApiStatus.Loading}>
                            {Loc.common.close}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
