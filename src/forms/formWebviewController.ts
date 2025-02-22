/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    FormItemSpec,
    FormReducers,
    FormState,
} from "../reactviews/common/forms/form";
import { MssqlWebviewPanelOptions } from "../sharedInterfaces/webview";

abstract class FormWebviewController<
    TForm,
    TState extends FormState<TForm>,
    TReducers extends FormReducers<TForm>,
> extends ReactWebviewPanelController<TState, TReducers> {
    constructor(
        context,
        vscodeWrapper,
        sourceFile: string,
        _viewId: string,
        initialData: TState,
        options: MssqlWebviewPanelOptions,
    ) {
        super(
            context,
            vscodeWrapper,
            sourceFile,
            _viewId,
            initialData,
            options,
        );

        this.registerRpcHandlers();
    }

    private registerRpcHandlers() {
        this.registerReducer("formAction", (state, payload) => {
            // TODO
            return state;
        });
    }

    /**
     * Runs validation across the form fields
     * @param formTarget
     * @param propertyName
     * @returns array of fields with errors
     */
    protected async validateForm(
        formTarget: TForm,
        propertyName: keyof TForm,
    ): Promise<string[]> {
        const erroredInputs = [];
        if (propertyName) {
            const component = this.getFormComponent(this.state, propertyName);
            if (component && component.validate) {
                component.validation = component.validate(
                    this.state,
                    formTarget[propertyName] as string | boolean | number,
                );
                if (!component.validation.isValid) {
                    erroredInputs.push(component.propertyName);
                }
            }
        } else {
            this.getActiveFormComponents(this.state)
                .map((x) => this.state.connectionComponents.components[x])
                .forEach((c) => {
                    if (c.hidden) {
                        c.validation = {
                            isValid: true,
                            validationMessage: "",
                        };
                        return;
                    } else {
                        if (c.validate) {
                            c.validation = c.validate(
                                this.state,
                                formTarget[c.propertyName],
                            );
                            if (!c.validation.isValid) {
                                erroredInputs.push(c.propertyName);
                            }
                        }
                    }
                });
        }

        return erroredInputs;
    }

    protected abstract getActiveFormComponents(state: TState): (keyof TForm)[];

    protected abstract getFormComponent(
        state: TState,
        propertyName: keyof TForm,
    ): FormItemSpec<TState, TForm>;
}
