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
} from "../../../shared/userSurvey";
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
    Popover,
    PopoverTrigger,
    PopoverSurface,
} from "@fluentui/react-components";
import { useContext, useState } from "react";

import { UserSurveyContext } from "./userSurveryStateProvider";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        width: "800px",
        maxWidth: "calc(100% - 20px)",
        "> *": {
            marginBottom: "15px",
        },
        padding: "10px",
    },
    title: {
        marginBottom: "30px",
    },
    footer: {
        display: "flex",
        justifyContent: "space-between",
    },
    buttonsContainer: {
        display: "flex",
        "> *": {
            marginRight: "10px",
        },
    },
    privacyDisclaimer: {
        marginTop: "30px",
        marginLeft: "auto",
    },
});

export const UserSurveyPage = () => {
    const classes = useStyles();
    const userSurveryProvider = useContext(UserSurveyContext);
    const [isSubmitDisabled, setIsSubmitDisabled] = useState(true);
    const [userAnswers, setUserAnswers] = useState<Answers>({});

    const updateSubmitButtonState = () => {
        for (let i = 0; i < userSurveryProvider!.state!.questions.length; i++) {
            const question = userSurveryProvider!.state!.questions[i];
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

    if (!userSurveryProvider?.state) {
        return undefined;
    }

    return (
        <div className={classes.root}>
            <h2
                style={{
                    marginBottom: "30px",
                }}>
                {userSurveryProvider.state.title ??
                    locConstants.userFeedback.microsoftWouldLikeYourFeedback}
            </h2>
            {userSurveryProvider.state.subtitle && <p>{userSurveryProvider.state.subtitle}</p>}

            {userSurveryProvider.state.questions.map((question, index) => {
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
            <div className={classes.footer}>
                <div className={classes.buttonsContainer}>
                    <Button
                        appearance="primary"
                        disabled={isSubmitDisabled}
                        onClick={() => userSurveryProvider.submit(userAnswers)}>
                        {userSurveryProvider.state.submitButtonText ??
                            locConstants.userFeedback.submit}
                    </Button>
                    <Button onClick={() => userSurveryProvider.cancel()}>
                        {userSurveryProvider.state.cancelButtonText ?? locConstants.common.cancel}
                    </Button>
                </div>
            </div>
            <div className={classes.privacyDisclaimer}>
                <Popover inline openOnHover positioning={{ coverTarget: true }}>
                    <PopoverTrigger>
                        <p>{locConstants.userFeedback.feedbackStatementShort}</p>
                    </PopoverTrigger>
                    <PopoverSurface>
                        <div style={{ width: "600px" }}>
                            {locConstants.userFeedback.feedbackStatementLong}
                        </div>
                    </PopoverSurface>
                </Popover>
                <Link
                    onClick={() => {
                        userSurveryProvider.openPrivacyStatement();
                    }}>
                    {locConstants.userFeedback.privacyStatement}
                </Link>
            </div>
        </div>
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
