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
    const isApplyInProgress = useSchemaCompareSelector((s) => s.isApplyInProgress);
    const applySucceeded = useSchemaCompareSelector((s) => s.applySucceeded);
    const applyFailed = useSchemaCompareSelector((s) => s.applyFailed);
    const schemaCompareResult = useSchemaCompareSelector((s) => s.schemaCompareResult);
    const classes = useStyles();

    let message = "";
    let showSpinner = false;
    if (isApplyInProgress) {
        message = loc.schemaCompare.applyingChanges;
        showSpinner = true;
    } else if (applySucceeded) {
        message = loc.schemaCompare.applySucceededRunAgain;
    } else if (applyFailed) {
        message = loc.schemaCompare.applyFailedRunAgain;
    } else if (!isComparisonInProgress && schemaCompareResult && schemaCompareResult.areEqual) {
        message = loc.schemaCompare.noDifferences;
    } else if (isComparisonInProgress) {
        message = loc.schemaCompare.initializingComparison;
        showSpinner = true;
    } else if (!isComparisonInProgress && !schemaCompareResult) {
        message = loc.schemaCompare.intro;
    }

    if (!message) {
        return <></>;
    }

    return (
        <div className={classes.container}>
            {showSpinner && <Spinner labelPosition="below" label={message} />}

            {!showSpinner && (
                <Text size={400} align="center">
                    {message}
                </Text>
            )}
        </div>
    );
};

export default Message;
