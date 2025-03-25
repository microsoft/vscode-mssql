/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { locConstants as loc } from "../../../common/locConstants";
import { makeStyles, Text } from "@fluentui/react-components";

const useStyles = makeStyles({
    container: {
        marginTop: "32px",
        display: "flex",
        gap: "16px",
        flexDirection: "column",
        alignItems: "stretch",
    },
});

const Message = () => {
    const context = useContext(schemaCompareContext);
    const state = context.state;
    const classes = useStyles();

    return (
        <div className={classes.container}>
            {!state.isComparisonInProgress &&
                state.schemaCompareResult &&
                state.schemaCompareResult.areEqual && (
                    <Text size={400} align="center">
                        {loc.schemaCompare.noDifferences}
                    </Text>
                )}

            {state.isComparisonInProgress && (
                <Text size={400} align="center">
                    {loc.schemaCompare.initializingComparison}
                </Text>
            )}

            {!state.isComparisonInProgress && !state.schemaCompareResult && (
                <Text size={400} align="center">
                    {loc.schemaCompare.intro}
                </Text>
            )}
        </div>
    );
};

export default Message;
