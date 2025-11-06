/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Field, Input, makeStyles } from "@fluentui/react-components";
import { locConstants } from "../../common/locConstants";

/**
 * Default application version for DACPAC extraction
 */
const DEFAULT_APPLICATION_VERSION = "1.0.0";

interface ApplicationInfoSectionProps {
    applicationName: string;
    setApplicationName: (value: string) => void;
    applicationVersion: string;
    setApplicationVersion: (value: string) => void;
    isOperationInProgress: boolean;
}

const useStyles = makeStyles({
    section: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
});

export const ApplicationInfoSection = ({
    applicationName,
    setApplicationName,
    applicationVersion,
    setApplicationVersion,
    isOperationInProgress,
}: ApplicationInfoSectionProps) => {
    const classes = useStyles();

    return (
        <div className={classes.section}>
            <Field label={locConstants.dacpacDialog.applicationNameLabel}>
                <Input
                    value={applicationName}
                    onChange={(_, data) => setApplicationName(data.value)}
                    placeholder={locConstants.dacpacDialog.enterApplicationName}
                    disabled={isOperationInProgress}
                    aria-label={locConstants.dacpacDialog.applicationNameLabel}
                />
            </Field>

            <Field label={locConstants.dacpacDialog.applicationVersionLabel}>
                <Input
                    value={applicationVersion}
                    onChange={(_, data) => setApplicationVersion(data.value)}
                    placeholder={DEFAULT_APPLICATION_VERSION}
                    disabled={isOperationInProgress}
                    aria-label={locConstants.dacpacDialog.applicationVersionLabel}
                />
            </Field>
        </div>
    );
};
