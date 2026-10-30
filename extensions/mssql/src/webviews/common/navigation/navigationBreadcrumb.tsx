/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Breadcrumb,
    BreadcrumbButton,
    BreadcrumbDivider,
    BreadcrumbItem,
} from "@fluentui/react-components";
import { Fragment, ReactNode } from "react";
import { locConstants as loc } from "../locConstants";
import { useNavigation } from "./navigationProvider";

export interface NavigationBreadcrumbProps {
    /** An item before the routes, such as a database picker. */
    readonly root?: ReactNode;
    readonly className?: string;
}

/** The current location and its parents. Each parent is a link. */
export const NavigationBreadcrumb = ({ root, className }: NavigationBreadcrumbProps) => {
    const { router, match, navigate } = useNavigation();
    const ancestry = router.ancestry(match);

    return (
        <Breadcrumb size="small" aria-label={loc.navigation.breadcrumb} className={className}>
            {root && (
                <>
                    <BreadcrumbItem>{root}</BreadcrumbItem>
                    <BreadcrumbDivider />
                </>
            )}
            {ancestry.map((ancestor, index) => {
                const isCurrent = index === ancestry.length - 1;
                return (
                    <Fragment key={ancestor.location}>
                        <BreadcrumbItem>
                            <BreadcrumbButton
                                current={isCurrent}
                                onClick={isCurrent ? undefined : () => navigate(ancestor.location)}>
                                {ancestor.route.title(ancestor)}
                            </BreadcrumbButton>
                        </BreadcrumbItem>
                        {!isCurrent && <BreadcrumbDivider />}
                    </Fragment>
                );
            })}
        </Breadcrumb>
    );
};
