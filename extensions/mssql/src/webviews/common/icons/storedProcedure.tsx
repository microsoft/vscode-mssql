/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";

export const StoredProcedureIcon16Regular = Object.assign(
    React.forwardRef<SVGSVGElement, React.SVGAttributes<SVGElement>>((props, ref) => {
        const { fill = "currentColor", className, style, ...rest } = props;
        return (
            <svg
                ref={ref}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className={className}
                style={style}
                aria-hidden="true"
                focusable="false"
                {...rest}>
                <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M4.5 2C3.837 2 3.201 2.263 2.732 2.732C2.263 3.201 2 3.837 2 4.5V11.5C2 12.163 2.263 12.799 2.732 13.268C3.201 13.737 3.837 14 4.5 14H11.5C12.163 14 12.799 13.737 13.268 13.268C13.737 12.799 14 12.163 14 11.5V4.5C14 3.837 13.737 3.201 13.268 2.732C12.799 2.263 12.163 2 11.5 2H4.5ZM13 5H3V4.5C3 4.102 3.158 3.72 3.439 3.439C3.721 3.158 4.102 3 4.5 3H11.5C11.898 3 12.28 3.158 12.561 3.439C12.842 3.721 13 4.102 13 4.5V5ZM3 6H13V11.5C13 11.898 12.842 12.28 12.561 12.561C12.279 12.842 11.898 13 11.5 13H4.5C4.102 13 3.72 12.842 3.439 12.561C3.158 12.279 3 11.898 3 11.5V6Z"
                    fill={fill}
                />
                <path
                    d="M4.5 7C4.224 7 4 7.224 4 7.5C4 7.776 4.224 8 4.5 8H8.5C8.776 8 9 7.776 9 7.5C9 7.224 8.776 7 8.5 7H4.5Z"
                    fill={fill}
                />
                <path
                    d="M4 9.5C4 9.224 4.224 9 4.5 9H8.5C8.776 9 9 9.224 9 9.5C9 9.776 8.776 10 8.5 10H4.5C4.224 10 4 9.776 4 9.5Z"
                    fill={fill}
                />
                <path
                    d="M9 11.5C9 11.224 9.224 11 9.5 11H11.5C11.776 11 12 11.224 12 11.5C12 11.776 11.776 12 11.5 12H9.5C9.224 12 9 11.776 9 11.5Z"
                    fill={fill}
                />
                <path
                    d="M10.5 9C10.224 9 10 9.224 10 9.5C10 9.776 10.224 10 10.5 10H11.5C11.776 10 12 9.776 12 9.5C12 9.224 11.776 9 11.5 9H10.5Z"
                    fill={fill}
                />
                <path
                    d="M4.5 11C4.224 11 4 11.224 4 11.5C4 11.776 4.224 12 4.5 12H7.5C7.776 12 8 11.776 8 11.5C8 11.224 7.776 11 7.5 11H4.5Z"
                    fill={fill}
                />
            </svg>
        );
    }),
    { displayName: "StoredProcedureIcon16Regular" },
);
