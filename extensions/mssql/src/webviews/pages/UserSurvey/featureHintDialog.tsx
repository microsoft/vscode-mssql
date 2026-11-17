/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Text,
    makeStyles,
} from "@fluentui/react-components";
import { Open16Regular, Play16Regular } from "@fluentui/react-icons";
import { FeatureHintSuggestion } from "../../../sharedInterfaces/userSurvey";
import { locConstants } from "../../common/locConstants";
import { featureHintScreenshots } from "./featureHintScreenshots";

const useStyles = makeStyles({
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    hint: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        padding: "12px",
        border: "1px solid var(--vscode-editorWidget-border, var(--vscode-editorGroup-border))",
        borderRadius: "6px",
    },
    screenshot: {
        display: "block",
        width: "100%",
        maxHeight: "200px",
        objectFit: "contain",
        marginTop: "4px",
        borderRadius: "4px",
        border: "1px solid var(--vscode-editorWidget-border, var(--vscode-editorGroup-border))",
        backgroundColor: "var(--vscode-editor-background)",
    },
    hintActions: {
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
        marginTop: "4px",
    },
});

export interface FeatureHintDialogProps {
    suggestions: FeatureHintSuggestion[];
    onOpenDocs: (hintId: string) => void;
    onTryNow: (hintId: string) => void;
    onCancel: () => void;
    onSubmitAnyway: () => void;
}

export const FeatureHintDialog = ({
    suggestions,
    onOpenDocs,
    onTryNow,
    onCancel,
    onSubmitAnyway,
}: FeatureHintDialogProps) => {
    const classes = useStyles();
    const strings = locConstants.userFeedback;
    const isSingle = suggestions.length === 1;

    return (
        <Dialog open modalType="modal" onOpenChange={(_event, data) => !data.open && onCancel()}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>
                        {isSingle
                            ? strings.youMayBeLookingFor(suggestions[0].featureName)
                            : strings.youMayBeLookingForOneOfThese}
                    </DialogTitle>
                    <DialogContent className={classes.content}>
                        <Text>
                            {isSingle
                                ? strings.featureHintIntroSingle
                                : strings.featureHintIntroMultiple}
                        </Text>
                        {suggestions.map((suggestion) => (
                            <div
                                key={suggestion.id}
                                className={classes.hint}
                                data-testid={`feature-hint-${suggestion.id}`}>
                                <Text weight="semibold">{suggestion.featureName}</Text>
                                <Text>{suggestion.description}</Text>
                                {suggestion.screenshot &&
                                    featureHintScreenshots[suggestion.screenshot] && (
                                        <img
                                            className={classes.screenshot}
                                            src={featureHintScreenshots[suggestion.screenshot]}
                                            alt={strings.featureScreenshotAlt(
                                                suggestion.featureName,
                                            )}
                                        />
                                    )}
                                <div className={classes.hintActions}>
                                    {suggestion.hasDocs && (
                                        <Button
                                            size="small"
                                            icon={<Open16Regular />}
                                            onClick={() => onOpenDocs(suggestion.id)}>
                                            {strings.viewDocumentation}
                                        </Button>
                                    )}
                                    {suggestion.canTryNow && (
                                        <Button
                                            size="small"
                                            icon={<Play16Regular />}
                                            onClick={() => onTryNow(suggestion.id)}>
                                            {suggestion.tryNowLabel || strings.tryItNow}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onCancel}>
                            {locConstants.common.cancel}
                        </Button>
                        <Button appearance="primary" onClick={onSubmitAnyway}>
                            {strings.submitAnyway}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
