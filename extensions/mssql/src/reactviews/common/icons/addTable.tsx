/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";

/**
 * Custom icon component because the paths require fillRule="evenodd" which
 * createFluentIcon does not support.
 */
export const AddTableIcon16Regular = Object.assign(
    React.forwardRef<SVGSVGElement, React.SVGAttributes<SVGElement>>((props, ref) => {
        const { fill = "currentColor", className, style, ...rest } = props;
        return (
            <svg
                ref={ref}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                xmlns="http://www.w3.org/2000/svg"
                className={className}
                style={style}
                {...rest}>
                <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M4 9.97758V10H6V9.79297C6.34864 9.69436 6.68321 9.56223 7 9.40029V10L11 10V6L9.79297 6C9.88412 5.67772 9.94663 5.34341 9.97758 5L11 5V3H9.79297C9.69436 2.65136 9.56223 2.31679 9.40029 2L12.5 2C13.8807 2 15 3.11929 15 4.5V11.5C15 12.8807 13.8807 14 12.5 14H5.5C4.11929 14 3 12.8807 3 11.5L3 9.79297C3.32228 9.88412 3.65659 9.94663 4 9.97758ZM11 13H7V11L11 11V13ZM4 11H6V13H5.5C4.67157 13 4 12.3284 4 11.5V11ZM12 6H14V10H12V6ZM12 11H14V11.5C14 12.3284 13.3284 13 12.5 13H12V11ZM14 4.5V5H12V3H12.5C13.3284 3 14 3.67157 14 4.5Z"
                    fill={fill}
                />
                <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M9 4.5C9 6.98528 6.98528 9 4.5 9C2.01472 9 0 6.98528 0 4.5C0 2.01472 2.01472 0 4.5 0C6.98528 0 9 2.01472 9 4.5ZM4.5 2C4.77614 2 5 2.22386 5 2.5V4H6.5C6.77614 4 7 4.22386 7 4.5C7 4.77614 6.77614 5 6.5 5H5V6.5C5 6.77614 4.77614 7 4.5 7C4.22386 7 4 6.77614 4 6.5V5H2.5C2.22386 5 2 4.77614 2 4.5C2 4.22386 2.22386 4 2.5 4H4V2.5C4 2.22386 4.22386 2 4.5 2Z"
                    fill={fill}
                />
            </svg>
        );
    }),
    { displayName: "AddTableIcon16Regular" },
);
