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
    linkWrapper: {
        display: "flex",
        alignItems: "center",
        minHeight: "32px",
        marginTop: "-2px",
    },
});

export const SqlPackageCommandSection: React.FC = () => {
    const styles = useStyles();
    const loc = LocConstants.getInstance().publishProject;
    const publishCtx = useContext(PublishProjectContext);
    const formState = usePublishDialogSelector((s) => s.formState);

    const [isSqlPackageDialogOpen, setIsSqlPackageDialogOpen] = useState(false);
    const [sqlPackageCommand, setSqlPackageCommand] = useState("");

    const handleGenerateSqlPackageCommand = useCallback(async () => {
        if (!publishCtx || !formState) {
            console.error("Missing publishCtx or formState");
            return;
        }

        try {
            console.log("Calling generateSqlPackageCommand...");
            // Call the backend service to generate the actual sqlpackage command
            const command = await publishCtx.generateSqlPackageCommand();
            console.log("Received command:", command);

            setSqlPackageCommand(command);
            setIsSqlPackageDialogOpen(true);
        } catch (error) {
            console.error("Error generating SqlPackage command:", error);
        }
    }, [publishCtx, formState]);

    if (!publishCtx) {
        return undefined;
    }

    return (
        <>
            <div className={styles.root}>
                <Field label={loc.SqlPackageCommand} orientation="horizontal">
                    <div className={styles.linkWrapper}>
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
