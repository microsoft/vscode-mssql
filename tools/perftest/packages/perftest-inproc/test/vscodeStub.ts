/**
 * Minimal `vscode` stub for unit tests: the scenario engine imports the module
 * at load; connection-free scenarios (noop, syntheticDelay, waits) exercise
 * only these seams.
 */
export const commands = {
    executeCommand: async (_command: string, ..._args: unknown[]): Promise<unknown> => undefined,
};
export const workspace = {
    workspaceFolders: undefined as unknown,
    openTextDocument: async (_options?: unknown): Promise<unknown> => ({}),
};
export const window = {
    activeTextEditor: undefined as unknown,
    showTextDocument: async (_doc: unknown, _options?: unknown): Promise<unknown> => undefined,
};
export const Uri = {
    file: (p: string) => ({ fsPath: p }),
    joinPath: (base: unknown, ...parts: string[]) => ({ base, parts }),
};
export class Selection {}
export const version = "1.101.0-test";
