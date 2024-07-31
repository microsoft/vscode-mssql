/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogTrigger } from "@fluentui/react-dialog";
import { ToolbarButton } from "@fluentui/react-toolbar";
import { DatabaseArrowDownRegular, ErrorCircleRegular } from "@fluentui/react-icons";
import { Button } from "@fluentui/react-button";
import { Spinner, makeStyles, shorthands } from "@fluentui/react-components";
import ReactMarkdown from 'react-markdown'
import { useContext } from "react";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { LoadState } from "../../../sharedInterfaces/tableDesigner";

const useStyles = makeStyles({
    dialogContent: {
        height: '300px',
        ...shorthands.overflow('auto'),
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        flexDirection: 'column'
    },
    openScript: {
        width: '150px'
    },
    updateDatabase: {
        width: '150px'
    },
    errorIcon: {
        fontSize: '100px',
        opacity: 0.5
    },
    retryButton: {
        marginTop: '10px'
    }
});

export const DesignerChangesPreviewButton = () => {
    const designerContext = useContext(TableDesignerContext);
    const classes = useStyles();
    if (!designerContext) {
        return null;
    }

    const metadata = designerContext.state;

    const generateScriptIcon = () => {
        switch (metadata?.apiState?.generateScriptState) {
            case LoadState.Loading:
                return <Spinner size='extra-small' />
            case LoadState.Error:
                return <ErrorCircleRegular />
            default:
                return undefined;
        }
    };

    const getDialogContent = () => {
        if (metadata?.apiState?.publishState === LoadState.Loading) {
            return <>
                <DialogContent className={classes.dialogContent}>
                    <Spinner label="Publishing Changes" labelPosition='below' />
                </DialogContent>
            </>;
        }
        if (metadata?.apiState?.publishState === LoadState.Loaded) {
            return <>
                <DialogContent className={classes.dialogContent}>
                    <div>Changes published successfully</div>
                </DialogContent>
                <DialogActions>
                    <Button size="medium" appearance="primary" onClick={designerContext.provider.closeDesigner}>Close Designer</Button>
                    <DialogTrigger action="close">
                        <Button size="medium" appearance="secondary" onClick={designerContext.provider.continueEditing}>Continue Editing</Button>
                    </DialogTrigger>
                </DialogActions>
            </>;
        }
        if (metadata?.apiState?.previewState === LoadState.Loading) {
            return <>
                <DialogContent className={classes.dialogContent}>
                    <Spinner label="Loading" labelPosition='below' />
                </DialogContent>
            </>;
        }
        if (metadata?.apiState?.previewState === LoadState.Error) {
            return <>
                <DialogContent className={classes.dialogContent}>
                    <ErrorCircleRegular className={classes.errorIcon} />
                    <div>Error loading preview</div>
                    <Button className={classes.retryButton} onClick={() => {
                        designerContext.provider.generatePreviewReport();
                    }}>Retry</Button>
                </DialogContent>
            </>;
        }
        if (metadata?.apiState?.previewState === LoadState.Loaded) {
            return <>
                <DialogContent>
                    <div style = {
                        {
                            width: '98%',
                            height: '100%',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderTop: '1px solid #e0e0e0',
                            borderBottom: '1px solid #e0e0e0',
                            overflow: 'auto',
                        }
                    }>
                    <ReactMarkdown>{metadata?.generatePreviewReportResult?.report}</ReactMarkdown>
                    </div>
                </DialogContent>
                <DialogActions>
                    <Button className={classes.updateDatabase} disabled={metadata.apiState?.previewState !== LoadState.Loaded} appearance="primary" onClick={() => {
                        designerContext.provider.publishChanges();
                    }} >Update Database</Button>
                    <DialogTrigger action="close">
                        <Button icon={generateScriptIcon()} iconPosition="after" className={classes.openScript} disabled={metadata.apiState?.previewState !== LoadState.Loaded} appearance="primary" onClick={designerContext.provider.generateScript} >Generate Script</Button>
                    </DialogTrigger>
                    <DialogTrigger disableButtonEnhancement>
                        <Button size="medium" appearance="secondary">Close</Button>
                    </DialogTrigger>
                </DialogActions>
            </>;
        }

    };

    return <Dialog inertTrapFocus={true}>
        <DialogTrigger disableButtonEnhancement>
            <ToolbarButton
                aria-label="Publish"
                title="Publish"
                icon={<DatabaseArrowDownRegular />}
                onClick={() => {
                    designerContext.provider.generatePreviewReport();
                }}
                disabled={(metadata?.issues?.length ?? 0) > 0}
            >
                Publish
            </ToolbarButton>
        </DialogTrigger>
        <DialogSurface>
            <DialogBody>
                <DialogTitle>
                    Preview Database Updates
                </DialogTitle>
                {getDialogContent()}
            </DialogBody>
        </DialogSurface>
    </Dialog>
}