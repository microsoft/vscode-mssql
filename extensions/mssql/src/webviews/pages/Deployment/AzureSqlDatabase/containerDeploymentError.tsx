/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link, makeStyles } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { locConstants } from "../../../common/locConstants";

const useStyles = makeStyles({
    error: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "8px",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
    },
});

interface ContainerDeploymentErrorProps {
    message?: string;
    fullErrorText?: string;
}

export const ContainerDeploymentError: React.FC<ContainerDeploymentErrorProps> = ({
    message,
    fullErrorText,
}) => {
    const classes = useStyles();
    const [showFullErrorText, setShowFullErrorText] = useState(false);

    useEffect(() => {
        setShowFullErrorText(false);
    }, [fullErrorText]);

    return (
        <div className={classes.error}>
            {message && <span>{message}</span>}
            {fullErrorText && (
                <>
                    <Link
                        as="button"
                        aria-expanded={showFullErrorText}
                        onClick={() => setShowFullErrorText((shown) => !shown)}>
                        {showFullErrorText
                            ? locConstants.localContainers.hideFullErrorMessage
                            : locConstants.localContainers.showFullErrorMessage}
                    </Link>
                    {showFullErrorText && <span>{fullErrorText}</span>}
                </>
            )}
        </div>
    );
};
