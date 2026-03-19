/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";

export const DeploymentIcon = Object.assign(
    React.forwardRef<SVGSVGElement, React.SVGAttributes<SVGElement>>((props, ref) => {
        const { className, style, ...rest } = props;

        return (
            <svg
                ref={ref}
                width="82"
                height="77"
                viewBox="0 0 82 77"
                fill="none"
                className={className}
                style={style}
                xmlns="http://www.w3.org/2000/svg"
                {...rest}>
                <path
                    d="M15.375 60.1563V16.8435C20.7921 21.2998 30.053 24.1248 41 24.1248C51.947 24.1248 61.2079 21.2998 66.625 16.8435V60.1563C66.625 67.0141 55.6114 72.1875 41 72.1875C26.3886 72.1875 15.375 67.0141 15.375 60.1563Z"
                    fill="url(#deploy_g0)"
                />
                <path
                    d="M15.375 60.1563V16.8435C20.7921 21.2998 30.053 24.1248 41 24.1248C51.947 24.1248 61.2079 21.2998 66.625 16.8435V60.1563C66.625 67.0141 55.6114 72.1875 41 72.1875C26.3886 72.1875 15.375 67.0141 15.375 60.1563Z"
                    fill="url(#deploy_g1)"
                    fillOpacity="0.7"
                />
                <path
                    d="M66.625 16.8438C66.625 23.4884 55.1523 28.875 41 28.875C26.8477 28.875 15.375 23.4884 15.375 16.8438C15.375 10.1991 26.8477 4.8125 41 4.8125C55.1523 4.8125 66.625 10.1991 66.625 16.8438Z"
                    fill="url(#deploy_g2)"
                />
                <defs>
                    <linearGradient
                        id="deploy_g0"
                        x1="27.4739"
                        y1="4.37561"
                        x2="58.8494"
                        y2="65.3902"
                        gradientUnits="userSpaceOnUse">
                        <stop stopColor="#29C3FF" />
                        <stop offset="1" stopColor="#367AF2" />
                    </linearGradient>
                    <linearGradient
                        id="deploy_g1"
                        x1="48.9315"
                        y1="23.6401"
                        x2="60.6999"
                        y2="77.7896"
                        gradientUnits="userSpaceOnUse">
                        <stop offset="0.53288" stopColor="#FF6CE8" stopOpacity="0" />
                        <stop offset="1" stopColor="#FF6CE8" />
                    </linearGradient>
                    <linearGradient
                        id="deploy_g2"
                        x1="85.8437"
                        y1="40.9063"
                        x2="58.9947"
                        y2="-11.1367"
                        gradientUnits="userSpaceOnUse">
                        <stop stopColor="#58AAFE" />
                        <stop offset="1" stopColor="#6CE0FF" />
                    </linearGradient>
                </defs>
            </svg>
        );
    }),
    { displayName: "DeploymentIcon" },
);
