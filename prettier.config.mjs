// Also update the Prettier options in settings.json so that both CLI and VS Code formatting use the same options!

const config = {
    tabWidth: 4,
    printWidth: 100,
    bracketSameLine: true,
    endOfLine: "lf",
    overrides: [
        {
            files: "*.svg",
            options: {
                parser: "html",
            },
        },
    ],
};

export default config;
