/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useSchemaCompareSelector } from "../schemaCompareSelector";
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
    const isComparisonInProgress = useSchemaCompareSelector((s) => s.isComparisonInProgress);
    const schemaCompareResult = useSchemaCompareSelector((s) => s.schemaCompareResult);
    const classes = useStyles();

    let message = "";
    if (
        !isComparisonInProgress &&
        schemaCompareResult &&
        schemaCompareResult.areEqual
    ) {
        message = loc.schemaCompare.noDifferences;
    } else if (isComparisonInProgress) {
        message = loc.schemaCompare.initializingComparison;
    } else if (!isComparisonInProgress && !schemaCompareResult) {
        message = loc.schemaCompare.intro;
    }

    if (!message) {
        return <></>;
    }

    return (
        <div className={classes.container}>
            {isComparisonInProgress && <Spinner labelPosition="below" label={message} />}

            {!isComparisonInProgress && (
                <Text size={400} align="center">
                    {message}
                </Text>
            )}
        </div>
    );
};

export default Message;
