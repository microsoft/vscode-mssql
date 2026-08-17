/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, shorthands } from "@fluentui/react-components";
import { type ComponentType, type SyntheticEvent, useCallback, useEffect, useRef } from "react";
import { QueryResultPane } from "./queryResultPane";
import { KeyCode } from "../../common/keys";
import { isMetaOrCtrlKeyPressed } from "../../common/utils";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    PlayQueryCompletionSoundNotification,
    QueryResultReducers,
    QueryResultWebviewState,
} from "../../../sharedInterfaces/queryResult";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        maxWidth: "100%",
        maxHeight: "100%",
    },
    pageContext: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
        width: "100%",
        flexDirection: "column",
    },
    errorIcon: {
        fontSize: "100px",
        opacity: 0.5,
    },
    retryButton: {
        marginTop: "10px",
    },
    resultPaneHandle: {
        position: "absolute",
        top: "0",
        right: "0",
        width: "100%",
        height: "10px",
        cursor: "ns-resize",
        zIndex: 1,
        boxShadow: "0px -1px 1px  #e0e0e0",
    },
    propertiesPaneHandle: {
        position: "absolute",
        top: "0",
        left: "0",
        width: "10px",
        height: "100%",
        cursor: "ew-resize",
        zIndex: 1,
        // boxShadow: '0px -1px 1px  #e0e0e0'
    },
    designerRibbon: {
        width: "100%",
    },
    mainContent: {
        height: "100%",
        width: "100%",
        minHeight: "100%",
        display: "flex",
        ...shorthands.flex(1),
        flexDirection: "column",
        ...shorthands.overflow("hidden"),
    },
    editor: {
        ...shorthands.overflow("hidden"),
        ...shorthands.flex(1),
        width: "100%",
        display: "flex",
        flexDirection: "row",
    },
    resultPaneContainer: {
        width: "100%",
        position: "relative",
    },
    mainPaneContainer: {
        ...shorthands.flex(1),
        height: "100%",
        ...shorthands.overflow("hidden"),
    },
    propertiesPaneContainer: {
        position: "relative",
        height: "100%",
        width: "300px",
        ...shorthands.overflow("hidden"),
    },
});

interface QueryResultProps {
    GridView: ComponentType;
    isBetaResultsGridEnabled: boolean;
}

const maximumPlaybackSeconds = 5;

export const QueryResult = ({ GridView, isBetaResultsGridEnabled }: QueryResultProps) => {
    const classes = useStyles();
    const { extensionRpc } = useVscodeWebview<QueryResultWebviewState, QueryResultReducers>();
    const audioRef = useRef<HTMLAudioElement>(null);
    const fallbackAudioSourceRef = useRef("");
    const fallbackAttemptedRef = useRef(false);
    const playbackGenerationRef = useRef(0);
    const playbackTimerRef = useRef<number | undefined>(undefined);

    const stopPlayback = useCallback(() => {
        playbackGenerationRef.current++;
        if (playbackTimerRef.current !== undefined) {
            window.clearTimeout(playbackTimerRef.current);
            playbackTimerRef.current = undefined;
        }
        const audio = audioRef.current;
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
        }
    }, []);

    const playSource = useCallback(
        (source: string, isFallback: boolean) => {
            stopPlayback();
            fallbackAttemptedRef.current = isFallback;
            const audio = audioRef.current;
            if (!audio) {
                return;
            }

            const generation = ++playbackGenerationRef.current;
            audio.src = source;
            audio.currentTime = 0;
            playbackTimerRef.current = window.setTimeout(() => {
                if (generation !== playbackGenerationRef.current) {
                    return;
                }
                stopPlayback();
            }, maximumPlaybackSeconds * 1000);
            void audio.play().catch(() => {
                if (generation !== playbackGenerationRef.current) {
                    return;
                }
                if (!fallbackAttemptedRef.current) {
                    playSource(fallbackAudioSourceRef.current, true);
                } else {
                    stopPlayback();
                }
            });
        },
        [stopPlayback],
    );

    useEffect(() => {
        const disposable = extensionRpc.registerNotificationHandler(
            PlayQueryCompletionSoundNotification.type,
            ({ audioSource, fallbackAudioSource }) => {
                fallbackAudioSourceRef.current = fallbackAudioSource;
                playSource(audioSource, audioSource === fallbackAudioSource);
            },
        );
        return () => {
            disposable.dispose();
            stopPlayback();
        };
    }, [extensionRpc, playSource, stopPlayback]);

    // This is needed to stop the browser from selecting all the raw text in the webview when ctrl+a is pressed
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent): void => {
            if (isMetaOrCtrlKeyPressed(e) && e.code === KeyCode.KeyA) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return function cleanup() {
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    const handleAudioError = useCallback(() => {
        if (!fallbackAttemptedRef.current) {
            playSource(fallbackAudioSourceRef.current, true);
        } else {
            stopPlayback();
        }
    }, [playSource, stopPlayback]);

    const handleTimeUpdate = useCallback(
        (event: SyntheticEvent<HTMLAudioElement>) => {
            if (event.currentTarget.currentTime >= maximumPlaybackSeconds) {
                stopPlayback();
            }
        },
        [stopPlayback],
    );

    return (
        <div className={classes.root}>
            <audio
                ref={audioRef}
                hidden
                preload="auto"
                onEnded={stopPlayback}
                onError={handleAudioError}
                onTimeUpdate={handleTimeUpdate}
            />
            {
                <div className={classes.mainContent}>
                    <QueryResultPane
                        GridView={GridView}
                        isBetaResultsGridEnabled={isBetaResultsGridEnabled}
                    />
                </div>
            }
        </div>
    );
};
