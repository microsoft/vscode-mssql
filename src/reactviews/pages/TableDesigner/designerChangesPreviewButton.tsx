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
import * as l10n from '@vscode/l10n';

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

    // contant strings
    const PUBLISHING_CHANGES = l10n.t('Publishing Changes');
    const CHANGES_PUBLISHED_SUCCESSFULLY = l10n.t('Changes published successfully');
    const CLOSE_DESIGNER = l10n.t('Close Designer');
    const CONTINUE_EDITING = l10n.t('Continue Editing');
    const LOADING_TABLE_DESIGNER = l10n.t('Loading Table Designer');
    const ERROR_LOADING_PREVIEW = l10n.t('Error loading preview');
    const RETRY = l10n.t('Retry');
    const UPDATE_DATABASE = l10n.t('Update Database');
    const GENERATE_SCRIPT = l10n.t('Generate Script');
    const CLOSE = l10n.t('Close');
    const PUBLISH = l10n.t('Publish');
    const PREVIEW_DATABASE_UPDATES = l10n.t('Preview Database Updates');

    const generateScriptIcon = () => {
        switch (metadata?.apiState?.generateScriptState) {
            case LoadState.Loading:
                return <Spinner size='extra-small' />;
            case LoadState.Error:
                return <ErrorCircleRegular />;
            default:
                return undefined;
        }
    };

    const getDialogContent = () => {
        if (metadata?.apiState?.publishState === LoadState.Loading) {
            return (
                <>
                    <DialogContent className={classes.dialogContent}>
                        <Spinner label={PUBLISHING_CHANGES} labelPosition='below' />
                    </DialogContent>
                </>
            );
        }
        if (metadata?.apiState?.publishState === LoadState.Loaded) {
            return (
                <>
                    <DialogContent className={classes.dialogContent}>
                        <div>{CHANGES_PUBLISHED_SUCCESSFULLY}</div>
                    </DialogContent>
                    <DialogActions>
                        <Button size="medium" appearance="primary" onClick={designerContext.provider.closeDesigner}>{CLOSE_DESIGNER}</Button>
                        <DialogTrigger action="close">
                            <Button size="medium" appearance="secondary" onClick={designerContext.provider.continueEditing}>{CONTINUE_EDITING}</Button>
                        </DialogTrigger>
                    </DialogActions>
                </>
            );
        }
        if (metadata?.apiState?.previewState === LoadState.Loading) {
            return (
                <>
                    <DialogContent className={classes.dialogContent}>
                        <Spinner label={LOADING_TABLE_DESIGNER} labelPosition='below' />
                    </DialogContent>
                </>
            );
        }
        if (metadata?.apiState?.previewState === LoadState.Error) {
            return (
                <>
                    <DialogContent className={classes.dialogContent}>
                        <ErrorCircleRegular className={classes.errorIcon} />
                        <div>{ERROR_LOADING_PREVIEW}</div>
                        <Button className={classes.retryButton} onClick={() => {
                            designerContext.provider.generatePreviewReport();
                        }}>{RETRY}</Button>
                    </DialogContent>
                </>
            );
        }
        if (metadata?.apiState?.previewState === LoadState.Loaded) {
            return (
                <>
                    <DialogContent>
                        <div style={
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
                        }} >{UPDATE_DATABASE}</Button>
                        <DialogTrigger action="close">
                            <Button icon={generateScriptIcon()} iconPosition="after" className={classes.openScript} disabled={metadata.apiState?.previewState !== LoadState.Loaded} appearance="primary" onClick={designerContext.provider.generateScript} >{GENERATE_SCRIPT}</Button>
                        </DialogTrigger>
                        <DialogTrigger disableButtonEnhancement>
                            <Button size="medium" appearance="secondary">{CLOSE}</Button>
                        </DialogTrigger>
                    </DialogActions>
                </>
            );
        }

    };

    return (
        <Dialog inertTrapFocus={true}>
            <DialogTrigger disableButtonEnhancement>
                <ToolbarButton
                    aria-label={PUBLISH}
                    title={PUBLISH}
                    icon={<DatabaseArrowDownRegular />}
                    onClick={() => {
                        designerContext.provider.generatePreviewReport();
                    }}
                    disabled={(metadata?.issues?.length ?? 0) > 0}
                >
                    {PUBLISH}
                </ToolbarButton>
            </DialogTrigger>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>
                        {PREVIEW_DATABASE_UPDATES}
                    </DialogTitle>
                    {getDialogContent()}
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}