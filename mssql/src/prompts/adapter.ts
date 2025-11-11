// This code is originally from https://github.com/DonJayamanne/bowerVSCode
// License: https://github.com/DonJayamanne/bowerVSCode/blob/master/LICENSE

import { OutputChannel } from "vscode";
import * as nodeUtil from "util";
import PromptFactory from "./factory";
import EscapeException from "../utils/escapeException";
import { IQuestion, IPrompter, IPromptCallback } from "./question";
import VscodeWrapper from "../controllers/vscodeWrapper";

// Supports simple pattern for prompting for user input and acting on this
export default class CodeAdapter implements IPrompter {
    private outChannel: OutputChannel;
    private messageLevelFormatters = {};
    constructor(private vscodeWrapper: VscodeWrapper) {
        this.outChannel = this.vscodeWrapper.outputChannel;
    }

    public logError(message: any): void {
        let line = `error: ${message.message}\n    Code - ${message.code}`;
        this.outChannel.appendLine(line);
    }

    private formatMessage(message: any): string {
        const prefix = `${message.level}: (${message.id}) `;
        return `${prefix}${message.message}`;
    }

    public log(message: any): void {
        let line: string = "";
        if (message && typeof message.level === "string") {
            let formatter: (a: any) => string = this.formatMessage;
            if (this.messageLevelFormatters[message.level]) {
                formatter = this.messageLevelFormatters[message.level];
            }
            line = formatter(message);
        } else {
            line = nodeUtil.format(arguments);
        }

        this.outChannel.appendLine(line);
    }

    public clearLog(): void {
        this.outChannel.clear();
    }

    public showLog(): void {
        this.outChannel.show();
    }

    // TODO define question interface
    private fixQuestion(question: any): any {
        if (question.type === "checkbox" && Array.isArray(question.choices)) {
            // For some reason when there's a choice of checkboxes, they aren't formatted properly
            // Not sure where the issue is
            question.choices = question.choices.map((item) => {
                if (typeof item === "string") {
                    return { checked: false, name: item, value: item };
                } else {
                    return item;
                }
            });
        }
    }

    public promptSingle<T>(question: IQuestion, ignoreFocusOut?: boolean): Promise<T> {
        let questions: IQuestion[] = [question];
        return this.prompt<T>(questions, ignoreFocusOut).then((answers) => {
            if (answers) {
                return answers[question.name] || undefined;
            }
            return undefined;
        });
    }

    public prompt<T>(
        questions: IQuestion[],
        ignoreFocusOut?: boolean,
    ): Promise<{ [key: string]: T }> {
        let answers: { [key: string]: T } = {};

        // Collapse multiple questions into a set of prompt steps
        let promptResult: Promise<{ [key: string]: T }> = questions.reduce(
            (promise: Promise<{ [key: string]: T }>, question: IQuestion) => {
                this.fixQuestion(question);

                return promise
                    .then(() => {
                        return PromptFactory.createPrompt(
                            question,
                            this.vscodeWrapper,
                            ignoreFocusOut,
                        );
                    })
                    .then((prompt) => {
                        // Original Code: uses jQuery patterns. Keeping for reference
                        // if (!question.when || question.when(answers) === true) {
                        //     return prompt.render().then(result => {
                        //         answers[question.name] = question.filter ? question.filter(result) : result;
                        //     });
                        // }

                        if (!question.shouldPrompt || question.shouldPrompt(answers) === true) {
                            return prompt.render().then(async (result) => {
                                answers[question.name] = result;

                                if (question.onAnswered) {
                                    await question.onAnswered(result);
                                }
                                return answers;
                            });
                        }
                        return answers;
                    });
            },
            Promise.resolve(),
        );

        return promptResult.catch((err) => {
            if (err instanceof EscapeException || err instanceof TypeError) {
                return undefined;
            }

            this.vscodeWrapper.showErrorMessage(err.message);
        });
    }

    // Helper to make it possible to prompt using callback pattern. Generally Promise is a preferred flow
    public promptCallback(questions: IQuestion[], callback: IPromptCallback): void {
        // Collapse multiple questions into a set of prompt steps
        this.prompt(questions).then((answers) => {
            if (callback) {
                callback(answers);
            }
        });
    }
}
