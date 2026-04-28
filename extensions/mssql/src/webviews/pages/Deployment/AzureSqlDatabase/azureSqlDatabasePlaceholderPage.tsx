/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Text, tokens } from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        padding: "40px 24px",
        textAlign: "center",
    },
    description: {
        color: tokens.colorNeutralForeground3,
        maxWidth: "480px",
    },
});

export const AzureSqlDatabasePlaceholderPage: React.FC = () => {
    const classes = useStyles();

    return (
        <div className={classes.container}>
            <Text size={500} weight="semibold">
                {locConstants.azureSqlDatabase.azureSqlDatabaseHeader}
            </Text>
            <Text className={classes.description} size={400}>
                {locConstants.azureSqlDatabase.comingSoon}
            </Text>
        </div>
    );
};
