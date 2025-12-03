/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState, useCallback } from "react";
import { Field, Link, makeStyles } from "@fluentui/react-components";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import { LocConstants } from "../../../common/locConstants";
import { SqlPackageCommandDialog } from "./sqlPackageCommandDialog";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        maxWidth: "640px",
        width: "100%",
    },
    linkContainer: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
    },
});

export const SqlPackageCommandSection: React.FC = () => {
    const styles = useStyles();
    const loc = LocConstants.getInstance().publishProject;
    const publishCtx = useContext(PublishProjectContext);
    const formState = usePublishDialogSelector((s) => s.formState);
    const sqlCmdVariables = usePublishDialogSelector((s) => s.formState.sqlCmdVariables);

    const [isSqlPackageDialogOpen, setIsSqlPackageDialogOpen] = useState(false);
    const [sqlPackageCommand, setSqlPackageCommand] = useState("");

    const handleGenerateSqlPackageCommand = useCallback(() => {
        if (!publishCtx || !formState) return;

        // TODO: Get the actual sqlpackage command from the backend
        // For now, we'll create a command based on current form state
        const variableArgs = Object.entries(sqlCmdVariables || {})
            .map(([name, value]) => `/v:${name}="${value}"`)
            .join(" ");

        const serverArg = formState.serverName ? `/TargetServerName:"${formState.serverName}"` : "";
        const databaseArg = formState.databaseName
            ? `/TargetDatabaseName:"${formState.databaseName}"`
            : "";

        const command =
            `sqlpackage /Action:Publish /SourceFile:"<path-to-dacpac>" ${serverArg} ${databaseArg} ${variableArgs}`.trim();

        setSqlPackageCommand(command);
        setIsSqlPackageDialogOpen(true);
    }, [publishCtx, formState, sqlCmdVariables]);

    if (!publishCtx) {
        return undefined;
    }

    return (
        <>
            <div className={styles.root}>
                <Field label={loc.SqlPackageCommand} orientation="horizontal">
                    <div className={styles.linkContainer}>
                        <Link onClick={handleGenerateSqlPackageCommand}>
                            {loc.GenerateSqlPackageCommand}
                        </Link>
                    </div>
                </Field>
            </div>

            <SqlPackageCommandDialog
                isOpen={isSqlPackageDialogOpen}
                onClose={() => setIsSqlPackageDialogOpen(false)}
                sqlPackageCommand={sqlPackageCommand}
            />
        </>
    );
};
