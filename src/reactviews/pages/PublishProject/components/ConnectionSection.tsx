/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState, useEffect } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import { PlugDisconnectedRegular } from "@fluentui/react-icons";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import { renderInput, renderCombobox } from "./FormFieldComponents";
import { useFormStyles } from "../../../common/forms/form.component";

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
    const formStyles = useFormStyles();
    const classes = useStyles();
    const serverComponent = usePublishDialogSelector((s) => s.formComponents.serverName);
    const databaseComponent = usePublishDialogSelector((s) => s.formComponents.databaseName);
    const serverValue = usePublishDialogSelector((s) => s.formState.serverName);
    const databaseValue = usePublishDialogSelector((s) => s.formState.databaseName);

    const [localServer, setLocalServer] = useState(serverValue || "");
    const [localDatabase, setLocalDatabase] = useState(databaseValue || "");

    useEffect(() => setLocalServer(serverValue || ""), [serverValue]);
    useEffect(() => setLocalDatabase(databaseValue || ""), [databaseValue]);

    if (!publishCtx) {
        return undefined;
    }

    return (
        <div className={formStyles.formComponentDiv}>
            <div className={classes.root}>
                {renderInput(serverComponent, localServer, setLocalServer, {
                    readOnly: true,
                    contentAfter: (
                        <Button
                            size="small"
                            aria-label="Connect to server"
                            icon={<PlugDisconnectedRegular />}
                            appearance="transparent"
                            onClick={() => {
                                publishCtx.openConnectionDialog();
                            }}
                        />
                    ),
                })}
                {renderCombobox(databaseComponent, localDatabase, false, setLocalDatabase)}
            </div>
        </div>
    );
};
