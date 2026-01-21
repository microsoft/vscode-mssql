/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState, useEffect } from "react";
import { makeStyles } from "@fluentui/react-components";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import { renderCombobox } from "./FormFieldComponents";
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
    const selectedConnectionUri = usePublishDialogSelector((s) => s.selectedConnectionUri);
    const isLoadingDatabases = usePublishDialogSelector((s) => s.isLoadingDatabases);

    const [localServerDisplay, setLocalServerDisplay] = useState("");
    const [localDatabase, setLocalDatabase] = useState(databaseValue || "");

    // Update local server display when selectedConnectionUri changes
    useEffect(() => {
        if (selectedConnectionUri && serverComponent?.options) {
            const opt = serverComponent.options.find((o) => o.value === selectedConnectionUri);
            setLocalServerDisplay(opt?.displayName || "");
        } else {
            setLocalServerDisplay("");
        }
    }, [selectedConnectionUri, serverComponent?.options]);

    useEffect(() => setLocalDatabase(databaseValue || ""), [databaseValue]);

    if (!publishCtx) {
        return undefined;
    }

    // Add "Add Connection" option to the server options
    const getServerComponentWithNewConnection = () => {
        if (!serverComponent) return undefined;
        return {
            ...serverComponent,
            options: [
                {
                    displayName: locConstants.publishProject.addConnection,
                    value: locConstants.publishProject.addConnection,
                },
                ...(serverComponent.options || []),
            ],
        };
    };

    // Get database component with loading indicator option when loading
    const getDatabaseComponentWithLoading = () => {
        if (!databaseComponent) return undefined;
        if (isLoadingDatabases) {
            return {
                ...databaseComponent,
                options: [
                    {
                        displayName: locConstants.publishProject.loadingDatabases,
                        value: locConstants.publishProject.loadingDatabases,
                        disabled: true,
                    },
                ],
            };
        }
        return databaseComponent;
    };

    const handleServerSelect = (value: string) => {
        if (value === locConstants.publishProject.addConnection) {
            publishCtx.openConnectionDialog();
        } else {
            publishCtx.connectToServer(value);
        }
    };

    const handleServerInputChange = (value: string) => {
        setLocalServerDisplay(value);
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
            {renderCombobox(
                getServerComponentWithNewConnection(),
                localServerDisplay,
                false,
                handleServerInputChange,
                handleServerSelect,
                selectedConnectionUri,
            )}
            {renderCombobox(
                getDatabaseComponentWithLoading(),
                localDatabase,
                true, // Always allow typing database name
                handleDatabaseChange,
            )}
        </div>
    );
};
