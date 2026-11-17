/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Answers,
    FEATURE_HINT_MAX_SCORE,
    FeatureHintSource,
    FeatureHintSuggestion,
    JobRoleQuestion,
    NpsQuestion,
    NsatQuestion,
    TextareaQuestion,
    getFeatureHintInput,
    isFeatureHintEligible,
} from "../../../sharedInterfaces/userSurvey";
import {
    Button,
    Divider,
    Field,
    Input,
    Link,
    MessageBar,
    MessageBarBody,
    Radio,
    RadioGroup,
    Select,
    Spinner,
    Text,
    Textarea,
    Tooltip,
    makeStyles,
} from "@fluentui/react-components";
import { Shield20Regular, Sparkle16Regular } from "@fluentui/react-icons";
import { useContext, useEffect, useState } from "react";

import { UserSurveyContext } from "./userSurveryStateProvider";
import { useUserSurveySelector } from "./userSurveySelector";
import { locConstants } from "../../common/locConstants";
import { DialogPageShell } from "../../common/dialogPageShell";
import { FeedbackIcon } from "../../common/icons/feedback";
import { FeatureHintDialog } from "./featureHintDialog";

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
        borderRadius: "12px",
        padding: "16px 18px",
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
    },
    privacyContent: {
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        columnGap: "10px",
        rowGap: "8px",
        alignItems: "start",
    },
    privacyIcon: {
        color: "var(--vscode-descriptionForeground)",
        flexShrink: 0,
        gridColumn: "1",
        gridRow: "1",
        alignSelf: "center",
    },
    privacySummary: {
        color: "var(--vscode-descriptionForeground)",
        lineHeight: "1.5",
        gridColumn: "2",
    },
    privacyExpandedText: {
        color: "var(--vscode-descriptionForeground)",
        lineHeight: "1.5",
        gridColumn: "2",
    },
    privacyLink: {
        gridColumn: "2",
        width: "fit-content",
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
    const [userAnswers, setUserAnswers] = useState<Answers>({});
    const [isCopilotAvailable, setIsCopilotAvailable] = useState(false);
    const [copilotStatus, setCopilotStatus] = useState<"idle" | "checking" | "noMatches" | "error">(
        "idle",
    );
    const [isCheckingHints, setIsCheckingHints] = useState(false);
    const [hintDialog, setHintDialog] = useState<
        { suggestions: FeatureHintSuggestion[]; source: FeatureHintSource } | undefined
    >(undefined);
    const [dismissedHintIds, setDismissedHintIds] = useState<ReadonlySet<string>>(new Set());

    useEffect(() => {
        let isCurrent = true;
        context
            ?.isCopilotFeatureHintAvailable()
            .then((available) => isCurrent && setIsCopilotAvailable(available))
            .catch(() => isCurrent && setIsCopilotAvailable(false));
        return () => {
            isCurrent = false;
        };
    }, [context]);

    const isSubmitDisabled =
        isCheckingHints ||
        questions?.some(
            (question) =>
                question.type !== "divider" &&
                question.required &&
                userAnswers[question.id] === undefined,
        );

    const isHintEligible = isFeatureHintEligible(getFeatureHintInput(questions ?? [], userAnswers));

    const onAnswerChange = (id: string, answer: string | number | undefined) => {
        setCopilotStatus((status) => (status === "checking" ? status : "idle"));
        setUserAnswers((previous) => {
            const answers = { ...previous };
            if (answer === undefined) {
                delete answers[id];
            } else {
                answers[id] = answer;
            }
            return answers;
        });
    };

    if (!context || !questions) {
        return undefined;
    }

    // Keyword hints run on every submit; hints the user already dismissed are not repeated.
    const onSubmit = async () => {
        if (isHintEligible) {
            setIsCheckingHints(true);
            try {
                const result = await context.getFeatureHints(userAnswers, "keyword");
                const suggestions = result.suggestions.filter(
                    (suggestion) => !dismissedHintIds.has(suggestion.id),
                );
                if (suggestions.length > 0) {
                    setHintDialog({ suggestions, source: "keyword" });
                    return;
                }
            } catch {
                // Hints are optional; never block feedback on them.
            } finally {
                setIsCheckingHints(false);
            }
        }
        context.submit(userAnswers);
    };

    const onCheckWithCopilot = async () => {
        setCopilotStatus("checking");
        try {
            const result = await context.getFeatureHints(userAnswers, "copilot");
            if (result.status === "unavailable") {
                setIsCopilotAvailable(false);
            }
            if (result.suggestions.length > 0) {
                setHintDialog({ suggestions: result.suggestions, source: "copilot" });
                setCopilotStatus("idle");
            } else {
                setCopilotStatus(
                    result.status === "ok"
                        ? "noMatches"
                        : result.status === "notEligible"
                          ? "idle"
                          : "error",
                );
            }
        } catch {
            setCopilotStatus("error");
        }
    };

    const closeHintDialog = (outcome: "cancel" | "submitAnyway") => {
        if (!hintDialog) {
            return;
        }
        const hintIds = hintDialog.suggestions.map((suggestion) => suggestion.id);
        context.closeFeatureHints(hintIds, hintDialog.source, outcome);
        setDismissedHintIds((previous) => new Set([...previous, ...hintIds]));
        setHintDialog(undefined);
        if (outcome === "submitAnyway") {
            context.submit(userAnswers);
        }
    };

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
                    {isCopilotAvailable && (
                        <Tooltip
                            relationship="description"
                            content={
                                isHintEligible
                                    ? locConstants.userFeedback.checkWithCopilotTooltip
                                    : locConstants.userFeedback.checkWithCopilotDisabledTooltip(
                                          FEATURE_HINT_MAX_SCORE,
                                      )
                            }>
                            <Button
                                appearance="secondary"
                                icon={
                                    copilotStatus === "checking" ? (
                                        <Spinner size="tiny" />
                                    ) : (
                                        <Sparkle16Regular />
                                    )
                                }
                                disabledFocusable={!isHintEligible || copilotStatus === "checking"}
                                onClick={() => void onCheckWithCopilot()}>
                                {copilotStatus === "checking"
                                    ? locConstants.userFeedback.checkingWithCopilot
                                    : locConstants.userFeedback.checkWithCopilot}
                            </Button>
                        </Tooltip>
                    )}
                    <Button
                        appearance="primary"
                        disabled={isSubmitDisabled}
                        onClick={() => void onSubmit()}>
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
                        case "jobRole":
                            return (
                                <JobRoleQuestionField
                                    key={index}
                                    question={question}
                                    answers={userAnswers}
                                    onChange={onAnswerChange}
                                />
                            );
                        default:
                            return undefined;
                    }
                })}
                {(copilotStatus === "noMatches" || copilotStatus === "error") && (
                    <MessageBar intent={copilotStatus === "error" ? "warning" : "info"}>
                        <MessageBarBody>
                            {copilotStatus === "error"
                                ? locConstants.userFeedback.copilotCheckFailed
                                : locConstants.userFeedback.noExistingFeaturesFound}
                        </MessageBarBody>
                    </MessageBar>
                )}
                {hintDialog && (
                    <FeatureHintDialog
                        suggestions={hintDialog.suggestions}
                        onOpenDocs={(hintId) =>
                            context.openFeatureHintDocs(hintId, hintDialog.source)
                        }
                        onTryNow={(hintId) => context.tryFeatureHint(hintId, hintDialog.source)}
                        onCancel={() => closeHintDialog("cancel")}
                        onSubmitAnyway={() => closeHintDialog("submitAnyway")}
                    />
                )}
                <div className={classes.privacyDisclaimer}>
                    <div className={classes.privacyNoticeCard}>
                        <div className={classes.privacyContent}>
                            <Shield20Regular className={classes.privacyIcon} />
                            <Text className={classes.privacySummary}>
                                <Text weight="semibold">
                                    {locConstants.userFeedback.privacyNotice}
                                </Text>
                            </Text>
                            <Text className={classes.privacyExpandedText}>
                                {locConstants.userFeedback.feedbackStatementLong}
                            </Text>
                            <Link
                                className={classes.privacyLink}
                                onClick={() => {
                                    context.openPrivacyStatement();
                                }}>
                                {locConstants.userFeedback.privacyStatement}
                            </Link>
                        </div>
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

/** Renders the optional role selection and shows specification only for Other. */
const JobRoleQuestionField = ({
    question,
    answers,
    onChange,
}: {
    question: JobRoleQuestion;
    answers: Answers;
    onChange: (id: string, answer: string | undefined) => void;
}) => {
    const strings = locConstants.userFeedback;
    const role = answers[question.id] ?? "";
    return (
        <>
            <Field label={<Text weight="bold">{strings.primaryJobRole}</Text>}>
                <Select
                    value={role}
                    onChange={(_event, data) => {
                        onChange(question.id, data.value || undefined);
                        onChange(question.otherAnswerId, undefined);
                    }}>
                    <option value="">{strings.selectJobRole}</option>
                    <option value="applicationDeveloper">{strings.applicationDeveloper}</option>
                    <option value="databaseDeveloper">{strings.databaseDeveloper}</option>
                    <option value="databaseAdministrator">{strings.databaseAdministrator}</option>
                    <option value="dataEngineer">{strings.dataEngineer}</option>
                    <option value="dataAnalyst">{strings.dataAnalyst}</option>
                    <option value="dataScientist">{strings.dataScientist}</option>
                    <option value="dataArchitect">{strings.dataArchitect}</option>
                    <option value="itDevOpsProfessional">{strings.itDevOpsProfessional}</option>
                    <option value="other">{strings.otherJobRole}</option>
                </Select>
            </Field>
            {role === "other" && (
                <Field label={strings.specifyJobRole}>
                    <Input
                        value={String(answers[question.otherAnswerId] ?? "")}
                        onChange={(_event, data) =>
                            onChange(question.otherAnswerId, data.value || undefined)
                        }
                    />
                </Field>
            )}
        </>
    );
};

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
