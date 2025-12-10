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
    Link,
    makeStyles,
    Text,
    tokens,
} from "@fluentui/react-components";
import { locConstants as Loc } from "../../../common/locConstants";
import { KeyCode } from "../../../common/keys";
import { Warning24Filled } from "@fluentui/react-icons";

const useStyles = makeStyles({
    titleDiv: {
        display: "flex",
        flexDirection: "row",
        paddingLeft: "20px",
    },
    titleIcon: {
        marginTop: "4px",
    },
    titleText: {
        marginLeft: "8px",
        fontSize: "20px",
        fontWeight: 600,
    },
    contentDiv: {
        display: "flex",
        flexDirection: "column",
        padding: "15px",
    },
    contentItem: {
        padding: "10px",
    },
});

// Issue tracking this: https://github.com/microsoft/vscode-mssql/issues/20337
export const ArmSql2025ErrorDialog = ({ closeDialog }: { closeDialog: () => void }) => {
    const classes = useStyles();
    const armReferenceLink =
        "https://learn.microsoft.com/en-us/sql/sql-server/install/hardware-and-software-requirements-for-installing-sql-server-2025?view=sql-server-ver17";

    return (
        <Dialog open={true /* standalone dialog always open*/}>
            <DialogSurface
                onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === KeyCode.Escape) {
                        closeDialog();
                    }
                }}>
                <DialogBody>
                    <DialogTitle className={classes.titleDiv}>
                        <Warning24Filled
                            className={classes.titleIcon}
                            style={{ color: tokens.colorPaletteMarigoldForeground1 }}
                        />
                        <Text className={classes.titleText}> {Loc.common.warning} </Text>
                    </DialogTitle>
                    <DialogContent className={classes.contentDiv}>
                        <Text className={classes.contentItem}>
                            {Loc.localContainers.armErrorDescription}
                        </Text>
                        <Text className={classes.contentItem}>
                            {Loc.localContainers.toContinueCheck}{" "}
                            <Link href={armReferenceLink}>
                                {" "}
                                {Loc.localContainers.theDocumentation}
                            </Link>
                            {Loc.localContainers.forMoreInformation}
                        </Text>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            onClick={() => {
                                closeDialog();
                            }}>
                            {Loc.common.close}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
