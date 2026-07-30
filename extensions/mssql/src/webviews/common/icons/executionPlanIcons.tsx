/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./executionPlanIcons.css";

import { SearchFilled, SearchRegular } from "@fluentui/react-icons";
import { forwardRef, HTMLAttributes, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function commonIconProps(props: IconProps) {
    return {
        width: "1em",
        height: "1em",
        viewBox: "0 0 16 16",
        fill: "currentColor",
        focusable: "false",
        "aria-hidden": true,
        ...props,
    } as const;
}

export const DocumentCodeIcon16Regular = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
    <svg ref={ref} {...commonIconProps(props)}>
        <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M2.32637 10.3704C2.53604 10.5501 2.56032 10.8657 2.3806 11.0754L1.15952 12.5L2.3806 13.9246C2.56032 14.1343 2.53604 14.4499 2.32637 14.6296C2.11671 14.8093 1.80106 14.7851 1.62135 14.5754L0.121348 12.8254C-0.0391473 12.6381 -0.0391473 12.3618 0.121348 12.1746L1.62135 10.4246C1.80106 10.2149 2.11671 10.1907 2.32637 10.3704Z"
        />
        <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M7.67558 10.3704C7.88524 10.1907 8.20089 10.2149 8.3806 10.4246L9.8806 12.1746C10.0411 12.3618 10.0411 12.6381 9.8806 12.8254L8.3806 14.5754C8.20089 14.7851 7.88524 14.8093 7.67558 14.6296C7.46592 14.4499 7.44164 14.1343 7.62135 13.9246L8.84244 12.5L7.62135 11.0754C7.44164 10.8657 7.46592 10.5501 7.67558 10.3704Z"
        />
        <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M5.87224 9.01493C6.14014 9.0819 6.30302 9.35337 6.23605 9.62126L4.73605 15.6213C4.66907 15.8892 4.39761 16.052 4.12971 15.9851C3.86181 15.9181 3.69893 15.6466 3.76591 15.3787L5.26591 9.37873C5.33288 9.11083 5.60435 8.94795 5.87224 9.01493Z"
        />
        <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M3.99902 3C3.99902 1.89543 4.89445 1 5.99902 1H9.58481C9.98263 1 10.3642 1.15804 10.6455 1.43934L13.5597 4.35355C13.841 4.63486 13.999 5.01639 13.999 5.41421V13C13.999 14.1046 13.1036 15 11.999 15H9.33359L10.1902 14H11.999C12.5513 14 12.999 13.5523 12.999 13V6H10.499C9.6706 6 8.99902 5.32843 8.99902 4.5V2H5.99902C5.44674 2 4.99902 2.44772 4.99902 3V8.21506C4.96512 8.23478 4.9319 8.25588 4.89944 8.27835C4.60353 8.48318 4.39113 8.78758 4.30099 9.13599L3.99902 10.3371V3ZM10.499 5H12.7919L9.99902 2.20711V4.5C9.99902 4.77614 10.2229 5 10.499 5Z"
        />
    </svg>
));
DocumentCodeIcon16Regular.displayName = "DocumentCodeIcon16Regular";

export const OpenQueryIcon16Regular = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
    <svg ref={ref} {...commonIconProps(props)}>
        <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M7.8865 3.07663C7.96184 2.89454 8.00042 2.69934 8 2.50227C8.00036 2.33098 7.97127 2.16109 7.91417 2L11.5 2C12.163 2 12.7989 2.26339 13.2678 2.73223C13.7366 3.20107 14 3.83696 14 4.5V9.5C14 9.8283 13.9353 10.1534 13.8097 10.4567C13.6841 10.76 13.4999 11.0356 13.2678 11.2678C13.0356 11.4999 12.76 11.6841 12.4567 11.8097C12.2956 11.8764 12.1284 11.926 11.9577 11.9577C11.926 12.1284 11.8764 12.2956 11.8097 12.4567C11.6841 12.76 11.4999 13.0356 11.2678 13.2678C11.0356 13.4999 10.76 13.6841 10.4567 13.8097C10.1534 13.9353 9.8283 14 9.5 14H4.5C3.83696 14 3.20107 13.7366 2.73223 13.2678C2.26339 12.7989 2 12.163 2 11.5V6.5C2 5.83696 2.26339 5.20107 2.73223 4.73223C2.8159 4.64856 2.90489 4.57143 2.99841 4.50118C2.99804 4.66823 3.02556 4.83536 3.08101 4.99546C3.19251 5.31737 3.41026 5.59174 3.69844 5.77343C3.9056 5.90404 4.14029 5.98115 4.38163 6H3V11.5C3 11.8978 3.15804 12.2794 3.43934 12.5607C3.72064 12.842 4.10218 13 4.5 13H9.5C9.89782 13 10.2794 12.842 10.5607 12.5607C10.842 12.2794 11 11.8978 11 11.5V6H4.61516C4.63231 5.99866 4.64945 5.99703 4.66659 5.99509C5.00511 5.9569 5.32055 5.8046 5.561 5.56327L7.561 3.56327C7.70053 3.42412 7.81116 3.25873 7.8865 3.07663ZM12.5607 10.5607C12.401 10.7204 12.209 10.8403 12 10.9142V6.5C12 6.1717 11.9353 5.84661 11.8097 5.54329C11.6841 5.23998 11.4999 4.96438 11.2678 4.73223C11.0356 4.50009 10.76 4.31594 10.4567 4.1903C10.1534 4.06466 9.8283 4 9.5 4H13V9.5C13 9.89782 12.842 10.2794 12.5607 10.5607Z"
        />
        <path
            className="execution-plan-icon-accent-yellow"
            d="M6 8.5C6 8.22386 6.22386 8 6.5 8H9.5C9.77614 8 10 8.22386 10 8.5C10 8.77614 9.77614 9 9.5 9H6.5C6.22386 9 6 8.77614 6 8.5Z"
        />
        <path
            className="execution-plan-icon-accent-yellow"
            fillRule="evenodd"
            clipRule="evenodd"
            d="M4.00312 5.92042C4.00105 5.94668 4 5.97322 4 6V9.5C4 10.8807 5.11929 12 6.5 12H11C11.5523 12 12 11.5523 12 11V6C12 5.44772 11.5523 5 11 5H6.12427L5.561 5.56327C5.32055 5.8046 5.00511 5.9569 4.66659 5.99509C4.4412 6.02052 4.21452 5.99437 4.00312 5.92042ZM6.5 11H11V6L5 6V9.5C5 10.3284 5.67157 11 6.5 11Z"
        />
        <path
            className="execution-plan-icon-accent-blue"
            d="M4.854 0.148274L6.854 2.14827C6.90056 2.19472 6.93751 2.2499 6.96271 2.31064C6.98792 2.37139 7.00089 2.43651 7.00089 2.50227C7.00089 2.56804 6.98792 2.63316 6.96271 2.69391C6.93751 2.75465 6.90056 2.80983 6.854 2.85627L4.854 4.85627C4.76011 4.95016 4.63278 5.00291 4.5 5.00291C4.36722 5.00291 4.23989 4.95016 4.146 4.85627C4.05211 4.76239 3.99937 4.63505 3.99937 4.50227C3.99937 4.3695 4.05211 4.24216 4.146 4.14827L5.293 3.00227L2.5 3.00227C2.10218 3.00227 1.72064 3.16031 1.43934 3.44161C1.15804 3.72292 1 4.10445 1 4.50227L1 5.50227C1 5.63488 0.947322 5.76206 0.853554 5.85583C0.759786 5.9496 0.632608 6.00227 0.5 6.00227C0.367392 6.00227 0.240214 5.9496 0.146446 5.85583C0.0526781 5.76206 1.60592e-08 5.63488 2.18557e-08 5.50227L6.55671e-08 4.50227C9.45495e-08 3.83923 0.263392 3.20335 0.732233 2.73451C1.20107 2.26567 1.83696 2.00227 2.5 2.00227L5.293 2.00227L4.146 0.856274C4.05211 0.762387 3.99937 0.635049 3.99937 0.502274C3.99937 0.369498 4.05211 0.24216 4.146 0.148274C4.23989 0.054387 4.36722 0.00164194 4.5 0.00164195C4.63278 0.00164195 4.76011 0.054387 4.854 0.148274Z"
        />
    </svg>
));
OpenQueryIcon16Regular.displayName = "OpenQueryIcon16Regular";

export const ZoomControlIcon16Regular = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
    <svg ref={ref} {...commonIconProps(props)}>
        <path d="M2 4.5C2 3.119 3.119 2 4.5 2H11.5C12.881 2 14 3.119 14 4.5V11.5C14 12.881 12.881 14 11.5 14H4.5C3.119 14 2 12.881 2 11.5V4.5ZM4.5 3C3.672 3 3 3.672 3 4.5V11.5C3 12.328 3.672 13 4.5 13H11.5C12.328 13 13 12.328 13 11.5V4.5C13 3.672 12.328 3 11.5 3H4.5Z" />
        <path d="M11.854 11.146L9.44098 8.733C9.78998 8.243 10.001 7.647 10.001 7C10.001 5.346 8.65498 4 7.00098 4C5.34698 4 4.00098 5.346 4.00098 7C4.00098 8.654 5.34698 10 7.00098 10C7.64798 10 8.24398 9.79 8.73398 9.44L11.147 11.853C11.245 11.951 11.373 11.999 11.501 11.999C11.629 11.999 11.757 11.95 11.855 11.853C12.05 11.658 12.049 11.341 11.854 11.146ZM6.99998 9C5.89698 9 4.99998 8.103 4.99998 7C4.99998 5.897 5.89698 5 6.99998 5C8.10298 5 8.99998 5.897 8.99998 7C8.99998 8.103 8.10298 9 6.99998 9Z" />
    </svg>
));
ZoomControlIcon16Regular.displayName = "ZoomControlIcon16Regular";

export const HighlightExpensiveOperationIcon16Regular = forwardRef<SVGSVGElement, IconProps>(
    (props, ref) => (
        <svg
            ref={ref}
            {...commonIconProps(props)}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round">
            <rect
                x="1.5"
                y="1.5"
                width="4.5"
                height="4.5"
                rx="1"
                fill="currentColor"
                stroke="none"
            />
            <rect x="10.5" y="1.5" width="4" height="4" rx="1" />
            <rect x="10.5" y="10.5" width="4" height="4" rx="1" />
            <path d="M10.5 3.5H7.25M8.5 2.25L7.25 3.5L8.5 4.75M12.5 5.5V10.5" />
        </svg>
    ),
);
HighlightExpensiveOperationIcon16Regular.displayName = "HighlightExpensiveOperationIcon16Regular";

const tooltipBodyPath =
    "M2.5 4H12.5C13.327 4 14 4.673 14 5.5V9.5C14 10.143 13.592 10.688 13.022 10.901L12.121 10H12.5C12.775 10 13 9.776 13 9.5V5.5C13 5.224 12.775 5 12.5 5H2.5C2.225 5 2 5.224 2 5.5V9.5C2 9.776 2.225 10 2.5 10H8V11H2.5C1.673 11 1 10.327 1 9.5V5.5C1 4.673 1.673 4 2.5 4ZM4 7.5C4 7.224 4.224 7 4.5 7H10.5C10.776 7 11 7.224 11 7.5C11 7.776 10.776 8 10.5 8H4.5C4.224 8 4 7.776 4 7.5Z";
const tooltipPointerPath =
    "M13.854 13.1464C13.997 13.2894 14.039 13.5044 13.962 13.6914C13.884 13.8784 13.702 14.0004 13.5 14.0004H11.25L9.9 15.8004C9.771 15.9724 9.546 16.0424 9.342 15.9744C9.138 15.9064 9 15.7154 9 15.5004V9.50045C9 9.29845 9.122 9.11545 9.309 9.03845C9.496 8.96045 9.711 9.00345 9.854 9.14645L13.854 13.1464ZM10.6 13.2004C10.694 13.0744 10.843 13.0004 11 13.0004H12.293L10 10.7074V14.0004L10.6 13.2004Z";

export const TooltipIcon16Regular = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
    <svg ref={ref} {...commonIconProps(props)}>
        <path d={tooltipBodyPath} />
        <path
            className="execution-plan-icon-accent-blue"
            fillRule="evenodd"
            clipRule="evenodd"
            d={tooltipPointerPath}
        />
    </svg>
));
TooltipIcon16Regular.displayName = "TooltipIcon16Regular";

export const TooltipOffIcon16Regular = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
    <svg ref={ref} {...commonIconProps(props)}>
        <path d={tooltipBodyPath} />
        <path
            className="execution-plan-icon-accent-blue"
            fillRule="evenodd"
            clipRule="evenodd"
            d={tooltipPointerPath}
        />
        <path
            d="M2.25 13.75L13.75 2.25"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
        />
    </svg>
));
TooltipOffIcon16Regular.displayName = "TooltipOffIcon16Regular";

export const ZoomOriginalSizeIcon16Regular = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
    <svg ref={ref} {...commonIconProps(props)}>
        <path d="M4.50001 5.00023C4.37201 5.00023 4.24401 4.95123 4.14601 4.85423L2.14601 2.85423C1.95101 2.65923 1.95101 2.34223 2.14601 2.14723C2.34101 1.95223 2.65801 1.95223 2.85301 2.14723L4.85301 4.14723C5.04801 4.34223 5.04801 4.65923 4.85301 4.85423C4.75501 4.95223 4.62801 5.00023 4.50001 5.00023ZM2.85401 13.8542L4.85401 11.8542C5.04901 11.6592 5.04901 11.3422 4.85401 11.1472C4.65901 10.9522 4.34201 10.9522 4.14701 11.1472L2.14701 13.1472C1.95201 13.3422 1.95201 13.6592 2.14701 13.8542C2.24501 13.9522 2.37301 14.0002 2.50101 14.0002C2.62901 14.0002 2.75601 13.9512 2.85401 13.8542ZM13.854 13.8542C14.049 13.6592 14.049 13.3422 13.854 13.1472L11.854 11.1472C11.659 10.9522 11.342 10.9522 11.147 11.1472C10.952 11.3422 10.952 11.6592 11.147 11.8542L13.147 13.8542C13.245 13.9522 13.373 14.0002 13.501 14.0002C13.629 14.0002 13.756 13.9512 13.854 13.8542ZM11.854 4.85423L13.854 2.85423C14.049 2.65923 14.049 2.34223 13.854 2.14723C13.659 1.95223 13.342 1.95223 13.147 2.14723L11.147 4.14723C10.952 4.34223 10.952 4.65923 11.147 4.85423C11.245 4.95223 11.373 5.00023 11.501 5.00023C11.629 5.00023 11.756 4.95123 11.854 4.85423Z" />
    </svg>
));
ZoomOriginalSizeIcon16Regular.displayName = "ZoomOriginalSizeIcon16Regular";

interface SearchPlanIconProps extends HTMLAttributes<HTMLSpanElement> {
    planNumber: 1 | 2;
    selected?: boolean;
}

export function SearchPlanIcon({
    planNumber,
    selected = false,
    className,
    ...props
}: SearchPlanIconProps) {
    const SearchIcon = selected ? SearchFilled : SearchRegular;
    return (
        <span
            className={`execution-plan-numbered-icon${className ? ` ${className}` : ""}`}
            aria-hidden="true"
            {...props}>
            <SearchIcon />
            <span className="execution-plan-numbered-icon-badge">{planNumber}</span>
        </span>
    );
}
