/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { tokens } from "@fluentui/react-components";
import React from "react";

/**
 * Unlike the single-colour glyphs, this one does not inherit `currentColor`. Both are theme
 * tokens rather than the literal `#202020` and `#006CBF`, so the neutral half stays legible on a
 * dark background.
 */
export const SqlMigrationIcon = Object.assign(
    React.forwardRef<SVGSVGElement, React.SVGAttributes<SVGElement>>((props, ref) => {
        const { className, style, ...rest } = props;

        return (
            <svg
                ref={ref}
                width="20"
                height="20"
                viewBox="0 0 16 16"
                fill="none"
                className={className}
                style={style}
                xmlns="http://www.w3.org/2000/svg"
                {...rest}>
                <path
                    d="M4.5 2H2.5C1.673 2 1 2.673 1 3.5V12.5C1 13.327 1.673 14 2.5 14H4.5C5.327 14 6 13.327 6 12.5V9H5V12.5C5 12.776 4.776 13 4.5 13H2.5C2.224 13 2 12.776 2 12.5V3.5C2 3.224 2.224 3 2.5 3H4.5C4.776 3 5 3.224 5 3.5V6H6V3.5C6 2.673 5.327 2 4.5 2ZM13.5 2H11.5C10.673 2 10 2.673 10 3.5V4.886L11 5.886V3.5C11 3.224 11.224 3 11.5 3H13.5C13.776 3 14 3.224 14 3.5V12.5C14 12.776 13.776 13 13.5 13H11.5C11.224 13 11 12.776 11 12.5V9.114L10 10.114V12.5C10 13.327 10.673 14 11.5 14H13.5C14.327 14 15 13.327 15 12.5V3.5C15 2.673 14.327 2 13.5 2Z"
                    fill={tokens.colorNeutralForeground1}
                />
                <path
                    d="M10.85 7.84984L8.85 9.84984C8.805 9.89684 8.751 9.93484 8.69 9.96084C8.63 9.98684 8.565 9.99984 8.5 9.99984C8.435 9.99984 8.37 9.98684 8.31 9.96084C8.25 9.93484 8.195 9.89684 8.15 9.84984C8.103 9.80484 8.065 9.75084 8.039 9.68984C8.013 9.62984 8 9.56484 8 9.49984C8 9.43484 8.013 9.36984 8.039 9.30884C8.065 9.24884 8.103 9.19484 8.15 9.14884L9.29 7.99884H4.5C4.367 7.99884 4.24 7.94584 4.146 7.85284C4.052 7.75884 4 7.63184 4 7.49884C4 7.36584 4.053 7.23884 4.146 7.14484C4.24 7.05084 4.367 6.99884 4.5 6.99884H9.29L8.15 5.84884C8.059 5.75584 8.008 5.62984 8.009 5.49984C8.009 5.36984 8.062 5.24484 8.154 5.15184C8.246 5.05984 8.371 5.00784 8.502 5.00684C8.632 5.00684 8.758 5.05684 8.851 5.14784L10.851 7.14784C10.898 7.19284 10.936 7.24684 10.962 7.30784C10.988 7.36784 11.001 7.43284 11.001 7.49884C11.001 7.56484 10.988 7.62884 10.962 7.68884C10.936 7.74884 10.898 7.80384 10.851 7.84884L10.85 7.84984Z"
                    fill={tokens.colorBrandForeground1}
                />
            </svg>
        );
    }),
    { displayName: "SqlMigrationIcon" },
);
