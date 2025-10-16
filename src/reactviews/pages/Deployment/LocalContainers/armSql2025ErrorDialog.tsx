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
} from "@fluentui/react-components";
import { locConstants as Loc } from "../../../common/locConstants";
import { Keys } from "../../../common/keys";

export const ArmSql2025ErrorDialog = ({ closeDialog }: { closeDialog: () => void }) => {
    return (
        <Dialog open={true /* standalone dialog always open*/}>
            <DialogSurface
                onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === Keys.Escape) {
                        closeDialog();
                    }
                }}>
                <DialogBody>
                    {" "}
                    <DialogTitle>Warning</DialogTitle>
                    <DialogContent>
                        <Text>The selected ARM template is not supported in SQL Server 2025.</Text>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
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
