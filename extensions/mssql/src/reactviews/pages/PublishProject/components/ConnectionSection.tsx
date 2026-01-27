/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState, useEffect } from "react";
import { makeStyles, Spinner, Field } from "@fluentui/react-components";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import { renderCombobox, renderSearchableDropdown } from "./FormFieldComponents";
import { locConstants } from "../../../common/locConstants";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        maxWidth: "640px",
        width: "100%",
    },
});

export const ConnectionSection: React.FC = () => {
    const publishCtx = useContext(PublishProjectContext);
    const styles = useStyles();
    const serverComponent = usePublishDialogSelector((s) => s.formComponents.serverName);
    const databaseComponent = usePublishDialogSelector((s) => s.formComponents.databaseName);
    const databaseValue = usePublishDialogSelector((s) => s.formState.databaseName);
    const selectedProfileId = usePublishDialogSelector((s) => s.selectedProfileId);
    const isConnecting = usePublishDialogSelector((s) => s.isConnecting);
    const isLoadingDatabases = usePublishDialogSelector((s) => s.isLoadingDatabases);

    const [localDatabase, setLocalDatabase] = useState(databaseValue || "");

    useEffect(() => setLocalDatabase(databaseValue || ""), [databaseValue]);

    if (!publishCtx) {
        return undefined;
    }

    const handleServerSelect = (value: string) => {
        // value is the profile ID - connect to the selected server
        publishCtx.connectToServer(value);
    };

    const handleDatabaseChange = (value: string) => {
        setLocalDatabase(value);
        if (databaseComponent) {
            publishCtx.formAction({
                propertyName: databaseComponent.propertyName,
                isAction: false,
                value: value,
            });
        }
    };

    return (
        <div className={styles.root}>
            {isConnecting ? (
                <Field
                    label={serverComponent?.label}
                    required={serverComponent?.required}
                    orientation="horizontal">
                    <Spinner size="tiny" label={locConstants.dacpacDialog.connectingToServer} />
                </Field>
            ) : (
                renderSearchableDropdown(serverComponent, selectedProfileId, handleServerSelect, {
                    searchBoxPlaceholder: locConstants.queryResult.search,
                })
            )}
            {renderCombobox(
                databaseComponent,
                localDatabase,
                true, // freeform - always allow typing database name
                handleDatabaseChange,
                isLoadingDatabases ?? false, // disabled while loading
            )}
        </div>
    );
};
