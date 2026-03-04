/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";

/**
 * Custom icon components because the paths require fillRule="evenodd" which
 * createFluentIcon does not support.
 */

export const FilterFunnelIcon16Regular = Object.assign(
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
                    d="M15 2v1.67l-5 4.759V14H6V8.429l-5-4.76V2h14zM7 8v5h2V8l5-4.76V3H2v.24L7 8z"
                    fill={fill}
                />
            </svg>
        );
    }),
    { displayName: "FilterFunnelIcon16Regular" },
);

export const FilterFunnelIcon16Filled = Object.assign(
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
                    d="M15 2v1.67l-5 4.759V14H6V8.429l-5-4.76V2h14z"
                    fill={fill}
                />
            </svg>
        );
    }),
    { displayName: "FilterFunnelIcon16Filled" },
);
