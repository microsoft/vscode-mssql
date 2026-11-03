/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Tooltip } from "@fluentui/react-components";
import { ArrowLeft16Regular } from "@fluentui/react-icons";
import { locConstants as loc } from "../locConstants";
import { useNavigation } from "./navigationProvider";

/**
 * Goes back to the earlier page. Without one, such as on a page opened from a deep link, it goes
 * to the parent page. A top page has no parent, so the button is not shown there.
 */
export const NavigationBackButton = ({ className }: { className?: string }) => {
    const { router, match, navigate, canGoBack, back } = useNavigation();
    const parent = router.ancestry(match).at(-2);
    if (!parent) {
        return null;
    }
    return (
        <Tooltip content={loc.navigation.back} relationship="label">
            <Button
                className={className}
                appearance="subtle"
                size="small"
                icon={<ArrowLeft16Regular />}
                onClick={() => (canGoBack ? back() : navigate(parent.location))}
            />
        </Tooltip>
    );
};
