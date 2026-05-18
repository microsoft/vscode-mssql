/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Link,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarIntent,
    MessageBarTitle,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { locConstants } from "../../../common/locConstants";

interface DabInfoBannerProps {
    title: string;
    message: string;
    learnMoreUrl?: string;
    intent?: MessageBarIntent;
    onDismiss?: () => void;
}

export function DabInfoBanner({
    title,
    message,
    learnMoreUrl,
    intent = "warning",
    onDismiss,
}: DabInfoBannerProps) {
    const [dismissed, setDismissed] = useState(false);

    if (!onDismiss && dismissed) {
        return null;
    }

    const dismiss = () => {
        if (onDismiss) {
            onDismiss();
            return;
        }
        setDismissed(true);
    };

    return (
        <MessageBar intent={intent}>
            <MessageBarBody>
                <MessageBarTitle>{title}</MessageBarTitle>
                {message}
                {learnMoreUrl && (
                    <>
                        {" "}
                        <Link href={learnMoreUrl} target="_blank" rel="noopener noreferrer">
                            {locConstants.common.learnMore}
                        </Link>
                    </>
                )}
            </MessageBarBody>
            <MessageBarActions>
                <Button
                    appearance="transparent"
                    icon={<DismissRegular />}
                    size="small"
                    aria-label={locConstants.common.dismiss}
                    onClick={dismiss}
                />
            </MessageBarActions>
        </MessageBar>
    );
}
