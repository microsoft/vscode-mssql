/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Answers,
    BaseQuestion,
    NpsQuestion,
    NsatQuestion,
    TextareaQuestion,
} from "../../../sharedInterfaces/userSurvey";
import {
    Button,
    Divider,
    Field,
    Link,
    Radio,
    RadioGroup,
    Text,
    Textarea,
    makeStyles,
} from "@fluentui/react-components";
import { Shield20Regular } from "@fluentui/react-icons";
import { useContext, useState } from "react";

import { UserSurveyContext } from "./userSurveryStateProvider";
import { useUserSurveySelector } from "./userSurveySelector";
import { locConstants } from "../../common/locConstants";
import { DialogPageShell } from "../../common/dialogPageShell";
import { FeedbackIcon } from "../../common/icons/feedback.tsx";

const useStyles = makeStyles({
    formContainer: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        "> *": {
            marginBottom: "15px",
        },
    },
    footerButtons: {
        display: "flex",
        gap: "8px",
    },
    privacyDisclaimer: {
        marginTop: "10px",
    },
    privacyNoticeCard: {
        border: "1px solid var(--vscode-editorWidget-border, var(--vscode-editorGroup-border))",
        borderRadius: "14px",
        padding: "16px 18px",
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
    },
    privacyHeader: {
        display: "flex",
        gap: "10px",
        alignItems: "flex-start",
    },
    privacyIcon: {
        color: "var(--vscode-descriptionForeground)",
        flexShrink: 0,
        marginTop: "2px",
    },
    privacySummary: {
        color: "var(--vscode-descriptionForeground)",
        lineHeight: "1.5",
    },
    privacyDivider: {
        marginTop: "12px",
        marginBottom: "12px",
    },
    privacyExpandedText: {
        color: "var(--vscode-descriptionForeground)",
        lineHeight: "1.5",
    },
});

export const UserSurveyPage = () => {
    const classes = useStyles();
    const context = useContext(UserSurveyContext);
    const questions = useUserSurveySelector((s) => s?.questions);
    const title = useUserSurveySelector((s) => s?.title);
    const subtitle = useUserSurveySelector((s) => s?.subtitle);
    const submitButtonText = useUserSurveySelector((s) => s?.submitButtonText);
    const cancelButtonText = useUserSurveySelector((s) => s?.cancelButtonText);
    const [isSubmitDisabled, setIsSubmitDisabled] = useState(true);
    const [userAnswers, setUserAnswers] = useState<Answers>({});
    const [isPrivacyExpanded, setIsPrivacyExpanded] = useState(false);

    const updateSubmitButtonState = () => {
        for (let i = 0; i < questions!.length; i++) {
            const question = questions![i];
            // if question is not divider and not required, skip
            if (question.type === "divider") {
                continue;
            }
            if (!(question as BaseQuestion)?.required) {
                continue;
            }
            if (userAnswers[question.id] === undefined) {
                setIsSubmitDisabled(true);
                return;
            }
        }
        setIsSubmitDisabled(false);
    };

    const onAnswerChange = (id: string, answer: string | number) => {
        userAnswers[id] = answer;
        setUserAnswers(userAnswers);
        updateSubmitButtonState();
    };

    if (!context || !questions) {
        return undefined;
    }

    return (
        <DialogPageShell
            icon={<FeedbackIcon />}
            title={title ?? locConstants.userFeedback.microsoftWouldLikeYourFeedback}
            subtitle={subtitle}
            maxContentWidth="medium"
            footerEnd={
                <div className={classes.footerButtons}>
                    <Button appearance="secondary" onClick={() => context.cancel()}>
                        {cancelButtonText ?? locConstants.common.cancel}
                    </Button>
                    <Button
                        appearance="primary"
                        disabled={isSubmitDisabled}
                        onClick={() => context.submit(userAnswers)}>
                        {submitButtonText ?? locConstants.userFeedback.submit}
                    </Button>
                </div>
            }>
            <div className={classes.formContainer}>
                {questions.map((question, index) => {
                    switch (question.type) {
                        case "nsat":
                            return (
                                <NSATQuestion
                                    key={index}
                                    question={question}
                                    onChange={(d) => onAnswerChange(question.id, d)}
                                />
                            );
                        case "nps":
                            return (
                                <NPSQuestion
                                    key={index}
                                    question={question}
                                    onChange={(d) => onAnswerChange(question.id, d)}
                                />
                            );
                        case "textarea":
                            return (
                                <TextAreaQuestion
                                    key={index}
                                    question={question}
                                    onChange={(d) => onAnswerChange(question.id, d)}
                                />
                            );
                        case "divider":
                            return <Divider key={index} />;
                        default:
                            return undefined;
                    }
                })}
                <div className={classes.privacyDisclaimer}>
                    <div className={classes.privacyNoticeCard}>
                        <div className={classes.privacyHeader}>
                            <Shield20Regular className={classes.privacyIcon} />
                            <Text className={classes.privacySummary}>
                                <Text weight="semibold">
                                    {locConstants.userFeedback.privacyNotice}
                                </Text>{" "}
                                - {locConstants.userFeedback.feedbackStatementShort}{" "}
                                <Link
                                    onClick={() => {
                                        setIsPrivacyExpanded((current) => !current);
                                    }}>
                                    {isPrivacyExpanded
                                        ? `${locConstants.userFeedback.hideFullStatement} \u2191`
                                        : `${locConstants.userFeedback.readFullStatement} \u2193`}
                                </Link>
                            </Text>
                        </div>

                        {isPrivacyExpanded && (
                            <>
                                <Divider className={classes.privacyDivider} />
                                <Text className={classes.privacyExpandedText}>
                                    {locConstants.userFeedback.feedbackStatementLong}{" "}
                                    <Link
                                        onClick={() => {
                                            context.openPrivacyStatement();
                                        }}>
                                        {locConstants.userFeedback.privacyStatement}
                                    </Link>
                                </Text>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </DialogPageShell>
    );
};

export interface QuestionProps<T> {
    question: T;
    onChange: (data: string | number) => void;
}

export const NSATQuestion = ({ question, onChange }: QuestionProps<NsatQuestion>) => {
    const userSurveryProvider = useContext(UserSurveyContext);
    if (!userSurveryProvider) {
        return undefined;
    }
    return (
        <Field
            label={
                <Text weight="bold">
                    {question.label ??
                        locConstants.userFeedback.overallHowSatisfiedAreYouWithMSSQLExtension}
                </Text>
            }
            required={question.required ?? false}>
            <RadioGroup
                layout="horizontal-stacked"
                onChange={(_e, d) => onChange(parseInt(d.value))}>
                <Radio value={"0"} label={locConstants.userFeedback.veryDissatisfied} />
                <Radio value={"1"} label={locConstants.userFeedback.dissatisfied} />
                <Radio value={"2"} label={locConstants.userFeedback.satisfied} />
                <Radio value={"3"} label={locConstants.userFeedback.verySatisfied} />
            </RadioGroup>
        </Field>
    );
};

export const NPSQuestion = ({ question, onChange }: QuestionProps<NpsQuestion>) => {
    const userSurveryProvider = useContext(UserSurveyContext);
    if (!userSurveryProvider) {
        return undefined;
    }
    return (
        <Field
            label={<Text weight="bold">{question.label}</Text>}
            required={question.required ?? false}
            style={{
                marginBottom: "25px",
            }}>
            <RadioGroup
                layout="horizontal-stacked"
                onChange={(_e, d) => onChange(parseInt(d.value))}>
                <Radio
                    value={"0"}
                    label={
                        <div
                            style={{
                                position: "relative",
                                display: "flex",
                                flexDirection: "column",
                            }}>
                            {"0"}
                            <br />
                            <Text
                                style={{
                                    position: "absolute",
                                    width: "100px",
                                    top: "30px",
                                    left: "0px",
                                    fontSize: "10px",
                                }}
                                size={200}>
                                {locConstants.userFeedback.notLikelyAtAll}
                            </Text>
                        </div>
                    }
                />
                <Radio value={"1"} label={"1"} />
                <Radio value={"2"} label={"2"} />
                <Radio value={"3"} label={"3"} />
                <Radio value={"4"} label={"4"} />
                <Radio value={"5"} label={"5"} />
                <Radio value={"6"} label={"6"} />
                <Radio value={"7"} label={"7"} />
                <Radio value={"8"} label={"8"} />
                <Radio value={"9"} label={"9"} />
                <Radio
                    value={"10"}
                    label={
                        <div
                            style={{
                                position: "relative",
                                display: "flex",
                                flexDirection: "column",
                            }}>
                            {"10"}
                            <br />
                            <Text
                                style={{
                                    position: "absolute",
                                    width: "max-content",
                                    top: "30px",
                                    right: "0px",
                                    fontSize: "10px",
                                }}
                                size={200}>
                                {locConstants.userFeedback.extremelyLikely}
                            </Text>
                        </div>
                    }
                />
            </RadioGroup>
        </Field>
    );
};

export const TextAreaQuestion = ({ question, onChange }: QuestionProps<TextareaQuestion>) => {
    const userSurveryProvider = useContext(UserSurveyContext);
    if (!userSurveryProvider) {
        return undefined;
    }
    return (
        <Field
            required={question.required ?? false}
            label={<Text weight="bold">{question.label}</Text>}
            hint={question.placeholder}>
            <Textarea onChange={(_e, data) => onChange(data.value)} resize="vertical" />
        </Field>
    );
};
