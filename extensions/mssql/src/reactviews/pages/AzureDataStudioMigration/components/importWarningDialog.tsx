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
    Text,
    makeStyles,
} from "@fluentui/react-components";

import { ImportWarningDialogProps } from "../../../../sharedInterfaces/azureDataStudioMigration";
import { locConstants as Loc } from "../../../common/locConstants";

const useStyles = makeStyles({
    message: {
        marginBottom: "12px",
    },
    warningSection: {
        marginTop: "12px",
    },
    warningList: {
        marginTop: "4px",
        marginBottom: "0",
        paddingLeft: "20px",
    },
});

interface ImportWarningDialogComponentProps {
    dialog: ImportWarningDialogProps;
    onCancel: () => void;
    onProceed: () => void;
}

export const ImportWarningDialog = ({
    dialog,
    onCancel,
    onProceed,
}: ImportWarningDialogComponentProps) => {
    const styles = useStyles();
    const loc = Loc.azureDataStudioMigration;

    return (
        <Dialog open>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{loc.importWarningDialogTitle}</DialogTitle>
                    <DialogContent>
                        <Text className={styles.message}>{loc.importWarningDialogMessage}</Text>
                        {dialog.warnings.length > 0 && (
                            <div className={styles.warningSection}>
                                <Text weight="semibold">{loc.importWarningConnectionsHeader}</Text>
                                <ul className={styles.warningList}>
                                    {dialog.warnings.map((warning) => (
                                        <li key={warning}>{warning}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onCancel}>
                            {Loc.common.cancel}
                        </Button>
                        <Button appearance="primary" onClick={onProceed}>
                            {loc.importWarningProceed}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
