/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Link } from "@fluentui/react-components";
import { ReactNode } from "react";
import { useNavigation } from "./navigationProvider";

export interface NavigationLinkProps {
    /** The location to go to, for example from `router.build`. */
    readonly to: string;
    readonly children: ReactNode;
    readonly className?: string;
    readonly title?: string;
}

/** A link to a location in the same page. */
export const NavigationLink = ({ to, children, className, title }: NavigationLinkProps) => {
    const { navigate } = useNavigation();
    return (
        <Link
            href={`#${to}`}
            className={className}
            title={title}
            onClick={(event) => {
                event.preventDefault();
                navigate(to);
            }}>
            {children}
        </Link>
    );
};
