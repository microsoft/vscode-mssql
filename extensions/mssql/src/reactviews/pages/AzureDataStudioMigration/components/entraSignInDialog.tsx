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

import { EntraSignInDialogProps } from "../../../../sharedInterfaces/azureDataStudioMigration";
import { locConstants as Loc } from "../../../common/locConstants";

const useStyles = makeStyles({
    list: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        marginTop: "12px",
        marginBottom: "12px",
    },
    label: {
        fontWeight: 600,
        marginRight: "4px",
    },
});

interface EntraSignInDialogComponentProps {
    dialog: EntraSignInDialogProps;
    onSignIn: (connectionId: string) => void;
    onCancel: () => void;
}

export const EntraSignInDialog = ({
    dialog,
    onSignIn,
    onCancel,
}: EntraSignInDialogComponentProps) => {
    const styles = useStyles();
    const loc = Loc.azureDataStudioMigration;

    return (
        <Dialog open>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{dialog.title}</DialogTitle>
                    <DialogContent>
                        <Text>{dialog.message}</Text>
                        <div className={styles.list}>
                            <Text>
                                <span className={styles.label}>{loc.entraSignInAccountLabel}:</span>
                                {dialog.accountDisplayName}
                            </Text>
                            <Text>
                                <span className={styles.label}>{loc.entraSignInTenantLabel}:</span>
                                {dialog.tenantIdDisplayName}
                            </Text>
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onCancel}>
                            {dialog.secondaryButtonText}
                        </Button>
                        <Button appearance="primary" onClick={() => onSignIn(dialog.connectionId)}>
                            {dialog.primaryButtonText}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
