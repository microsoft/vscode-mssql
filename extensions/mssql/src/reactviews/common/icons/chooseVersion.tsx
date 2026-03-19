/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";

export const ChooseVersionIcon = Object.assign(
    React.forwardRef<SVGSVGElement, React.SVGAttributes<SVGElement>>((props, ref) => {
        const { className, style, ...rest } = props;

        return (
            <svg
                ref={ref}
                width="48"
                height="60"
                viewBox="0 0 48 60"
                fill="none"
                className={className}
                style={style}
                xmlns="http://www.w3.org/2000/svg"
                {...rest}>
                <path
                    d="M24.0001 41.7996C37.0341 41.7996 47.6001 45.7617 47.6001 50.6497V32.9496C47.6001 28.0616 37.0341 24.0996 24.0001 24.0996H18.1001V41.7996H24.0001Z"
                    fill="url(#version_g0)"
                />
                <path
                    d="M47.6 32.9502C47.6 37.8382 37.034 41.8002 24 41.8002C16.051 41.8002 9.02002 40.3262 4.74402 38.0682C2.42802 37.0412 0.400024 38.5962 0.400024 40.7052V50.6502C0.400024 55.5382 10.966 59.5002 24 59.5002C37.034 59.5002 47.6 55.5382 47.6 50.6502V32.9502Z"
                    fill="url(#version_g1)"
                />
                <path
                    d="M47.6 32.9502C47.6 37.8382 37.034 41.8002 24 41.8002C16.051 41.8002 9.02002 40.3262 4.74402 38.0682C2.42802 37.0412 0.400024 38.5962 0.400024 40.7052V50.6502C0.400024 55.5382 10.966 59.5002 24 59.5002C37.034 59.5002 47.6 55.5382 47.6 50.6502V32.9502Z"
                    fill="url(#version_g2)"
                />
                <path
                    d="M24 0.5C37.034 0.5 47.6 4.46198 47.6 9.34998V19.375C47.6 20.747 46.171 23.155 43.253 21.93C38.976 19.673 31.947 18.2 24 18.2C10.966 18.2 0.400024 22.162 0.400024 27.05V9.34998C0.400024 4.46198 10.966 0.5 24 0.5Z"
                    fill="url(#version_g3)"
                />
                <path
                    d="M24 18.1996C10.966 18.1996 0.400024 14.2376 0.400024 9.34961V27.0496C0.400024 31.9376 10.966 35.8997 24 35.8997H25.475C27.919 35.8997 29.9 33.9186 29.9 31.4746V22.6246C29.9 20.1806 27.919 18.1996 25.475 18.1996H24Z"
                    fill="url(#version_g4)"
                />
                <path
                    d="M24 18.1996C10.966 18.1996 0.400024 14.2376 0.400024 9.34961V27.0496C0.400024 31.9376 10.966 35.8997 24 35.8997H25.475C27.919 35.8997 29.9 33.9186 29.9 31.4746V22.6246C29.9 20.1806 27.919 18.1996 25.475 18.1996H24Z"
                    fill="url(#version_g5)"
                />
                <defs>
                    <linearGradient
                        id="version_g0"
                        x1="38.7501"
                        y1="24.0996"
                        x2="14.0871"
                        y2="44.5276"
                        gradientUnits="userSpaceOnUse">
                        <stop stopColor="#0094F0" />
                        <stop offset="0.243047" stopColor="#0078D4" />
                        <stop offset="0.584404" stopColor="#2052CB" />
                        <stop offset="0.830639" stopColor="#312A9A" />
                        <stop offset="1" stopColor="#312A9A" />
                    </linearGradient>
                    <radialGradient
                        id="version_g1"
                        cx="0"
                        cy="0"
                        r="1"
                        gradientUnits="userSpaceOnUse"
                        gradientTransform="translate(35.8 36.8222) rotate(143.591) scale(36.655 65.1645)">
                        <stop stopColor="#3BD5FF" />
                        <stop offset="1" stopColor="#0078D4" />
                    </radialGradient>
                    <radialGradient
                        id="version_g2"
                        cx="0"
                        cy="0"
                        r="1"
                        gradientUnits="userSpaceOnUse"
                        gradientTransform="translate(43.175 34.4252) rotate(146.31) scale(31.9091 53.8324)">
                        <stop stopColor="#DECBFF" stopOpacity="0.9" />
                        <stop offset="1" stopColor="#DECBFF" stopOpacity="0" />
                    </radialGradient>
                    <linearGradient
                        id="version_g3"
                        x1="34.325"
                        y1="1.975"
                        x2="6.385"
                        y2="32.396"
                        gradientUnits="userSpaceOnUse">
                        <stop stopColor="#0FAFFF" />
                        <stop offset="0.162714" stopColor="#0094F0" />
                        <stop offset="0.563871" stopColor="#2052CB" />
                        <stop offset="0.764283" stopColor="#312A9A" />
                        <stop offset="1" stopColor="#312A9A" />
                    </linearGradient>
                    <radialGradient
                        id="version_g4"
                        cx="0"
                        cy="0"
                        r="1"
                        gradientUnits="userSpaceOnUse"
                        gradientTransform="translate(23.593 15.4326) rotate(137.53) scale(30.3119 47.2144)">
                        <stop stopColor="#3BD5FF" />
                        <stop offset="1" stopColor="#0078D4" />
                    </radialGradient>
                    <radialGradient
                        id="version_g5"
                        cx="0"
                        cy="0"
                        r="1"
                        gradientUnits="userSpaceOnUse"
                        gradientTransform="translate(28.425 13.7746) rotate(149.036) scale(25.8019 41.3007)">
                        <stop stopColor="#DECBFF" stopOpacity="0.9" />
                        <stop offset="1" stopColor="#D1D1FF" stopOpacity="0" />
                    </radialGradient>
                </defs>
            </svg>
        );
    }),
    { displayName: "ChooseVersionIcon" },
);
