/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, Text, makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
    card: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
        padding: tokens.spacingHorizontalM,
    },
    label: { color: tokens.colorNeutralForeground2 },
    valueRow: {
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: tokens.spacingHorizontalM,
    },
    value: {
        fontVariantNumeric: "tabular-nums",
    },
    danger: { color: tokens.colorStatusDangerForeground1 },
    caution: { color: tokens.colorStatusWarningForeground1 },
    caption: { color: tokens.colorNeutralForeground3 },
});

export interface MetricCardProps {
    readonly label: string;
    readonly value: string;
    readonly unit?: string;
    readonly caption?: string;
    readonly history?: readonly number[];
    /** Drawn as a dashed rule on the trend, so "slow" is a stated threshold rather than a feel. */
    readonly budgetMs?: number;
    readonly tone?: "neutral" | "caution" | "danger";
}

export const MetricCard = (props: MetricCardProps) => {
    const styles = useStyles();
    const toneClass =
        props.tone === "danger" ? styles.danger : props.tone === "caution" ? styles.caution : "";
    return (
        <Card className={styles.card}>
            <Text size={200} className={styles.label}>
                {props.label}
            </Text>
            <div className={styles.valueRow}>
                <div>
                    <Text size={700} weight="semibold" className={`${styles.value} ${toneClass}`}>
                        {props.value}
                    </Text>
                    {props.unit && (
                        <Text size={200} className={styles.caption}>
                            {` ${props.unit}`}
                        </Text>
                    )}
                </div>
                {props.history && props.history.length > 1 && (
                    <Sparkline samples={props.history} budget={props.budgetMs} />
                )}
            </div>
            {props.caption && (
                <Text size={200} className={styles.caption}>
                    {props.caption}
                </Text>
            )}
        </Card>
    );
};

const sparklineWidth = 84;
const sparklineHeight = 24;

/**
 * A trend, because one number cannot answer "is this getting worse".
 *
 * Marked `aria-hidden`: it repeats the value beside it and the caption below it, so a screen reader
 * announcing it would add noise rather than information.
 */
const Sparkline = ({ samples, budget }: { samples: readonly number[]; budget?: number }) => {
    const maximum = Math.max(...samples, budget ?? 0) || 1;
    const step = sparklineWidth / Math.max(samples.length - 1, 1);
    const y = (value: number) => sparklineHeight - (value / maximum) * (sparklineHeight - 4) - 2;
    const points = samples.map((value, index) => `${index * step},${y(value)}`).join(" ");
    return (
        <svg
            width={sparklineWidth}
            height={sparklineHeight}
            aria-hidden="true"
            focusable="false"
            style={{ flexShrink: 0, overflow: "visible" }}>
            {budget !== undefined && budget <= maximum && (
                <line
                    x1={0}
                    x2={sparklineWidth}
                    y1={y(budget)}
                    y2={y(budget)}
                    stroke={tokens.colorNeutralStroke2}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                />
            )}
            <polyline
                points={points}
                fill="none"
                stroke={tokens.colorBrandForeground1}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </svg>
    );
};
