/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Divider,
    Field,
    makeStyles,
    Radio,
    RadioGroup,
    Text,
    Textarea,
} from "@fluentui/react-components";
import { useContext, useEffect, useState } from "react";
import { UserSurveyContext } from "./userSurveryStateProvider";
import { locConstants } from "../../common/locConstants";
import { Answer, Question } from "../../../sharedInterfaces/userSurvey";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        width: "500px",
        maxWidth: "100%",
        "> *": {
            marginBottom: "15px",
        },
        padding: "10px",
    },
    title: {
        marginBottom: "30px",
    },
    buttonsContainer: {
        display: "flex",
        "> *": {
            marginRight: "10px",
        },
    },
});

export const UserSurveyPage = () => {
    const classes = useStyles();
    const userSurveryProvider = useContext(UserSurveyContext);
    const [isSubmitDisabled, setIsSubmitDisabled] = useState(true);
    const [userAnswers, setUserAnswers] = useState<Answer[]>([]);

    useEffect(() => {
        function loadQuestions() {
            if (userSurveryProvider?.state?.questions) {
                setUserAnswers(
                    userSurveryProvider.state.questions.map((q) => {
                        return {
                            label: q.label,
                            answer: "",
                        };
                    }),
                );
            }
        }
        loadQuestions();
    }, [userSurveryProvider!.state]);

    const updateSubmitButtonState = () => {
        let emptyRequired = 0;
        for (let i = 0; i < userAnswers.length; i++) {
            if (!userSurveryProvider!.state!.questions[i].required) {
                continue;
            }
            if (!userAnswers[i].answer) {
                emptyRequired++;
            }
        }
        setIsSubmitDisabled(emptyRequired !== 0);
    };

    const onAnswerChange = (index: number, answer: string) => {
        userAnswers[index].answer = answer;
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
                }}
            >
                {userSurveryProvider.state.title ??
                    locConstants.userFeedback.microsoftWouldLikeYourFeedback}
            </h2>
            {userSurveryProvider.state.subtitle && (
                <p>{userSurveryProvider.state.subtitle}</p>
            )}

            {userSurveryProvider.state.questions.map((question, index) => {
                switch (question.type) {
                    case "nsat":
                        return (
                            <NSATQuestion
                                key={index}
                                question={question}
                                onChange={(d) => onAnswerChange(index, d)}
                            />
                        );
                    case "nps":
                        return (
                            <NPSQuestion
                                key={index}
                                question={question}
                                onChange={(d) => onAnswerChange(index, d)}
                            />
                        );
                    case "textarea":
                        return (
                            <TextAreaQuestion
                                key={index}
                                question={question}
                                onChange={(d) => onAnswerChange(index, d)}
                            />
                        );
                    case "divider":
                        return <Divider key={index} />;
                    default:
                        return undefined;
                }
            })}
            <div className={classes.buttonsContainer}>
                <Button
                    appearance="primary"
                    disabled={isSubmitDisabled}
                    onClick={() => userSurveryProvider.submit(userAnswers)}
                >
                    {userSurveryProvider.state.submitButtonText ??
                        locConstants.userFeedback.submit}
                </Button>
                <Button onClick={() => userSurveryProvider.cancel()}>
                    {userSurveryProvider.state.cancelButtonText ??
                        locConstants.userFeedback.cancel}
                </Button>
            </div>
        </div>
    );
};

export interface QuestionProps {
    question: Question;
    onChange: (data: string) => void;
}

export const NSATQuestion = ({ question, onChange }: QuestionProps) => {
    const userSurveryProvider = useContext(UserSurveyContext);
    if (!userSurveryProvider) {
        return undefined;
    }
    return (
        <Field
            label={
                <Text weight="bold">
                    {question.label ??
                        locConstants.userFeedback
                            .overallHowSatisfiedAreYouWithMSSQLExtension}
                </Text>
            }
            required={question.required ?? false}
        >
            <RadioGroup
                layout="horizontal-stacked"
                onChange={(_e, d) => onChange(d.value)}
            >
                <Radio
                    value={locConstants.userFeedback.verySatisfied}
                    label={locConstants.userFeedback.verySatisfied}
                />
                <Radio
                    value={locConstants.userFeedback.satisfied}
                    label={locConstants.userFeedback.satisfied}
                />
                <Radio
                    value={locConstants.userFeedback.dissatisfied}
                    label={locConstants.userFeedback.dissatisfied}
                />
                <Radio
                    value={locConstants.userFeedback.veryDissatisfied}
                    label={locConstants.userFeedback.veryDissatisfied}
                />
            </RadioGroup>
        </Field>
    );
};

export const NPSQuestion = ({ question, onChange }: QuestionProps) => {
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
            }}
        >
            <RadioGroup
                layout="horizontal-stacked"
                onChange={(_e, d) => onChange(d.value)}
            >
                <Radio
                    value={"0"}
                    label={
                        <div
                            style={{
                                position: "relative",
                                display: "flex",
                                flexDirection: "column",
                            }}
                        >
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
                                size={200}
                            >
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
                            }}
                        >
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
                                size={200}
                            >
                                {locConstants.userFeedback.extremelyLikely}
                            </Text>
                        </div>
                    }
                />
            </RadioGroup>
        </Field>
    );
};

export const TextAreaQuestion = ({ question, onChange }: QuestionProps) => {
    const userSurveryProvider = useContext(UserSurveyContext);
    if (!userSurveryProvider) {
        return undefined;
    }
    return (
        <Field
            required={question.required ?? false}
            label={<Text weight="bold">{question.label}</Text>}
        >
            <Textarea
                placeholder={
                    question.placeholder ??
                    locConstants.userFeedback.microsoftReviewPrivacyDisclaimer
                }
                onChange={(_e, data) => onChange(data.value)}
                resize="vertical"
            />
        </Field>
    );
};
