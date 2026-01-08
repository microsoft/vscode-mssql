import { allFileTypes } from "../constants/constants";
import { FileBrowserService } from "../services/fileBrowserService";
import { FileBrowserReducers, FileBrowserWebviewState } from "../sharedInterfaces/fileBrowser";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";

export function registerFileBrowserReducers<TResult>(
    controller: ReactWebviewPanelController<FileBrowserWebviewState, FileBrowserReducers, TResult>,
    fileBrowserService: FileBrowserService,
    showFoldersOnly?: boolean,
    fileBrowserFilters?: string[],
): void {
    controller.registerReducer("openFileBrowser", async (state, payload) => {
        const result = await fileBrowserService.openFileBrowser(
            payload.ownerUri,
            payload.expandPath,
            payload.fileFilters,
            payload.changeFilter,
            payload.showFoldersOnly,
        );
        if (result && result.succeeded) {
            state.fileBrowserState = fileBrowserService.fileBrowserState;
        }
        return state;
    });
    controller.registerReducer("expandNode", async (state, payload) => {
        const result = await fileBrowserService.expandFilePath(payload.ownerUri, payload.nodePath);
        if (result && result.succeeded) {
            state.fileBrowserState = fileBrowserService.fileBrowserState;
        }
        return state;
    });
    controller.registerReducer("submitFilePath", async (state, payload) => {
        state.fileBrowserState.selectedPath = payload.selectedPath;
        return state;
    });
    controller.registerReducer("closeFileBrowser", async (state, payload) => {
        const result = await fileBrowserService.closeFileBrowser(payload.ownerUri);
        if (result && result.succeeded) {
            state.fileBrowserState = fileBrowserService.fileBrowserState;
        }
        return state;
    });
    controller.registerReducer("toggleFileBrowserDialog", async (state, payload) => {
        if (payload.shouldOpen) {
            if (!state.fileBrowserState) {
                // Initialize file browser state if not already done
                const result = await fileBrowserService.openFileBrowser(
                    state.ownerUri,
                    state.defaultFileBrowserExpandPath,
                    fileBrowserFilters || allFileTypes,
                    false, // changeFilter
                    showFoldersOnly,
                );
                if (result && result.succeeded) {
                    state.fileBrowserState = fileBrowserService.fileBrowserState;
                }
            }
            // Open the file browser dialog with the current file browser state
            state.dialog = {
                type: "fileBrowser",
            };
        } else {
            // Close the file browser dialog
            state.dialog = undefined;
        }
        return state;
    });
}
