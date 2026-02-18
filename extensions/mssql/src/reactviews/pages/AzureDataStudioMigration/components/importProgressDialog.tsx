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
    resultSection: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
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

    const renderSuccessContent = () => {
        const counts = dialog.importedCounts;
        if (!counts) {
            return (
                <div className={styles.resultRow}>
                    <CheckmarkCircle16Filled className={styles.successIcon} />
                    <Text>{dialog.status.message}</Text>
                </div>
            );
        }

        const lines: { label: string }[] = [];

        if (counts.connectionGroups > 0) {
            lines.push({
                label: loc.importedConnectionGroups(counts.connectionGroups),
            });
        }

        if (counts.connections > 0) {
            lines.push({
                label: loc.importedConnections(counts.connections),
            });
        }

        if (counts.settings > 0) {
            lines.push({
                label: loc.importedSettings(counts.settings),
            });
        }

        if (lines.length === 0) {
            return (
                <div className={styles.resultRow}>
                    <CheckmarkCircle16Filled className={styles.successIcon} />
                    <Text>{dialog.status.message}</Text>
                </div>
            );
        }

        return (
            <div className={styles.resultSection}>
                <Text style={{ paddingBottom: "6px" }}>{dialog.status.message}</Text>
                {lines.map((line) => (
                    <div className={styles.resultRow} key={line.label}>
                        <CheckmarkCircle16Filled className={styles.successIcon} />
                        <Text>{line.label}</Text>
                    </div>
                ))}
            </div>
        );
    };

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
                        ) : dialog.status.status === ApiStatus.Error ? (
                            <div className={styles.resultRow}>
                                <Warning16Regular className={styles.errorIcon} />
                                <Text>{dialog.status.message}</Text>
                            </div>
                        ) : (
                            renderSuccessContent()
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
