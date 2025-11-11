/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { locConstants as loc } from "../../../common/locConstants";
import { makeStyles, Spinner, Text } from "@fluentui/react-components";

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

    let message = "";
    if (
        !state.isComparisonInProgress &&
        state.schemaCompareResult &&
        state.schemaCompareResult.areEqual
    ) {
        message = loc.schemaCompare.noDifferences;
    } else if (state.isComparisonInProgress) {
        message = loc.schemaCompare.initializingComparison;
    } else if (!state.isComparisonInProgress && !state.schemaCompareResult) {
        message = loc.schemaCompare.intro;
    }

    if (!message) {
        return <></>;
    }

    return (
        <div className={classes.container}>
            {state.isComparisonInProgress && <Spinner labelPosition="below" label={message} />}

            {!state.isComparisonInProgress && (
                <Text size={400} align="center">
                    {message}
                </Text>
            )}
        </div>
    );
};

export default Message;
