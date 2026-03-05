// Mock vscode module for testing
const Module = require("module");
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
    if (id === "vscode") {
        return {
            ExtensionContext: function () {},
            ViewColumn: { One: 1 },
            Uri: { file: (path) => ({ fsPath: path, scheme: "file", path: path }) },
            WebviewPanel: function () {},
            window: { createWebviewPanel: () => ({}) },
            commands: { registerCommand: () => {} },
            EventEmitter: class {},
            Event: class {},
            workspace: { workspaceFolders: [] },
            StatusBarAlignment: { Left: 0 },
            ThemeColor: function () {},
            SecretStorage: class {},
            Memento: class {},
            ConfigurationTarget: { Global: 1 },
            CompletionItem: class {},
            CompletionItemKind: {},
            Position: class {},
            Range: class {},
            Selection: class {},
            DebugAdapterDescriptorFactory: class {},
            DebugAdapterInlineImplementation: class {},
            ProviderResult: undefined,
            CancellationTokenSource: class {},
        };
    }
    return originalRequire.apply(this, arguments);
};
