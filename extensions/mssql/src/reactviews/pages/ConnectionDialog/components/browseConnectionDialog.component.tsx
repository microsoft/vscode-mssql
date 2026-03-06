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
    makeStyles,
} from "@fluentui/react-components";
import { useContext } from "react";
import {
    BrowseConnectionDialogProps,
    ConnectionInputMode,
} from "../../../../sharedInterfaces/connectionDialog";
import { locConstants } from "../../../common/locConstants";
import { DialogMessage } from "../../../common/dialogMessage";
import { AzureIcon20, FabricIcon20 } from "../../../common/icons/fluentIcons";
import { AzureBrowsePage } from "../azureBrowsePage";
import { FabricBrowsePage } from "../fabricBrowsePage";
import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import { useConnectionDialogSelector } from "../connectionDialogSelector";

const useStyles = makeStyles({
    surface: {
        width: "min(960px, calc(100vw - 64px))",
        maxWidth: "min(960px, calc(100vw - 64px))",
    },
    content: {
        maxHeight: "calc(100vh - 220px)",
        overflowY: "auto",
    },
    title: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
});

function renderBrowseContent(
    browseTarget: ConnectionInputMode.AzureBrowse | ConnectionInputMode.FabricBrowse,
) {
    switch (browseTarget) {
        case ConnectionInputMode.AzureBrowse:
            return <AzureBrowsePage />;
        case ConnectionInputMode.FabricBrowse:
            return <FabricBrowsePage />;
    }
}

export const BrowseConnectionDialog = ({
    dialogProps,
}: {
    dialogProps: BrowseConnectionDialogProps;
}) => {
    const styles = useStyles();
    const context = useContext(ConnectionDialogContext)!;
    const formMessage = useConnectionDialogSelector((s) => s.formMessage);
    const selectedServer = useConnectionDialogSelector((s) => s.formState.server);
    const isBrowseSelectionReady = Boolean(selectedServer);

    const title =
        dialogProps.browseTarget === ConnectionInputMode.AzureBrowse
            ? locConstants.connectionDialog.browseAzure
            : locConstants.connectionDialog.browseFabric;
    const titleIcon =
        dialogProps.browseTarget === ConnectionInputMode.AzureBrowse ? (
            <AzureIcon20 />
        ) : (
            <FabricIcon20 />
        );

    return (
        <Dialog
            open={true}
            modalType="modal"
            onOpenChange={(_, data) => !data.open && context.closeDialog()}>
            <DialogSurface className={styles.surface}>
                <DialogBody>
                    <DialogTitle>
                        <span className={styles.title}>
                            {titleIcon}
                            {title}
                        </span>
                    </DialogTitle>
                    <DialogContent className={styles.content}>
                        {formMessage && (
                            <DialogMessage
                                message={formMessage}
                                onMessageButtonClicked={context.messageButtonClicked}
                                onCloseMessage={context.closeMessage}
                            />
                        )}
                        {renderBrowseContent(dialogProps.browseTarget)}
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={() => context.closeDialog()}>
                            {locConstants.common.cancel}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={!isBrowseSelectionReady}
                            onClick={() => context.confirmBrowseDialog()}>
                            {locConstants.common.ok}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
