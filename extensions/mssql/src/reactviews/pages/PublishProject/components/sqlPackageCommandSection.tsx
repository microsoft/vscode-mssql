/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState, useCallback } from "react";
import { Field, Link, makeStyles } from "@fluentui/react-components";
import { PublishProjectContext } from "../publishProjectStateProvider";
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

    const [isSqlPackageDialogOpen, setIsSqlPackageDialogOpen] = useState(false);

    const handleGenerateSqlPackageCommand = useCallback(async () => {
        setIsSqlPackageDialogOpen(true);
    }, []);

    if (!publishCtx) {
        return undefined;
    }

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
                publishContext={publishCtx}
            />
        </>
    );
};
