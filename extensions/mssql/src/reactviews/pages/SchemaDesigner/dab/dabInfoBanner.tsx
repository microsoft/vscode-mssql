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
    MessageBarTitle,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { locConstants } from "../../../common/locConstants";

interface DabInfoBannerProps {
    title: string;
    message: string;
    learnMoreUrl: string;
}

export function DabInfoBanner({ title, message, learnMoreUrl }: DabInfoBannerProps) {
    const [dismissed, setDismissed] = useState(false);

    if (dismissed) {
        return null;
    }

    return (
        <MessageBar intent="warning">
            <MessageBarBody>
                <MessageBarTitle>{title}</MessageBarTitle>
                {message}{" "}
                <Link href={learnMoreUrl} target="_blank" rel="noopener noreferrer">
                    {locConstants.common.learnMore}
                </Link>
            </MessageBarBody>
            <MessageBarActions>
                <Button
                    appearance="transparent"
                    icon={<DismissRegular />}
                    size="small"
                    onClick={() => setDismissed(true)}
                />
            </MessageBarActions>
        </MessageBar>
    );
}
