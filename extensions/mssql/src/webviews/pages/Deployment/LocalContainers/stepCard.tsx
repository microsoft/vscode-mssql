/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from "@fluentui/react-components";
import { ChevronDown20Regular, ChevronUp20Regular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { DockerStep } from "../../../../sharedInterfaces/localContainers";
import { locConstants } from "../../../common/locConstants";
import { useDeploymentSelector } from "../deploymentSelector";
import { DeploymentStepCard } from "../deploymentStepCard";

const useStyles = makeStyles({
    topSpace: {
        marginTop: "8px",
    },
});

interface StepCardProps {
    step: DockerStep;
}

export const StepCard: React.FC<StepCardProps> = ({ step }) => {
    const classes = useStyles();
    const stateExists = useDeploymentSelector((s) => s != null);
    const [expanded, setExpanded] = useState(true);
    // This state is used to track if the step has just errored, and expand then
    const [isNewlyErrored, setIsNewlyErrored] = useState(false);
    const [showFullErrorText, setShowFullErrorText] = useState(false);

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!stateExists) {
        return undefined;
    }

    useEffect(() => {
        if (!isNewlyErrored && step.loadState === ApiStatus.Error) {
            setExpanded(true);
            setIsNewlyErrored(true);
        }
    }, [step.loadState]);

    return (
        <DeploymentStepCard
            status={step.loadState}
            title={step.headerText}
            headerAction={
                step.loadState !== ApiStatus.Loaded ? (
                    <Button
                        icon={expanded ? <ChevronDown20Regular /> : <ChevronUp20Regular />}
                        appearance="subtle"
                        onClick={() => setExpanded(!expanded)}
                    />
                ) : undefined
            }>
            {expanded && step.loadState !== ApiStatus.Loaded && (
                <>
                    {step.loadState === ApiStatus.Error ? step.errorMessage : step.bodyText}

                    {/* If step.errorLink is defined and API is in error, render it */}
                    {step.loadState === ApiStatus.Error && step.errorLink && (
                        <div className={classes.topSpace}>
                            <a
                                href={step.errorLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={classes.topSpace}>
                                {step.errorLinkText}
                            </a>
                        </div>
                    )}
                    <div className={classes.topSpace}>
                        {step.loadState === ApiStatus.Error && showFullErrorText && (
                            <div style={{ marginBottom: "8px" }}>{step.fullErrorText}</div>
                        )}

                        {step.fullErrorText && (
                            <a onClick={() => setShowFullErrorText(!showFullErrorText)}>
                                {showFullErrorText
                                    ? locConstants.localContainers.hideFullErrorMessage
                                    : locConstants.localContainers.showFullErrorMessage}
                            </a>
                        )}
                    </div>
                </>
            )}
        </DeploymentStepCard>
    );
};
