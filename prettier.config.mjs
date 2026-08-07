// Prettier configuration for the monorepo

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
        {
            files: ["*.yml", "*.yaml"],
            options: {
                tabWidth: 2,
            },
        },
    ],
};

export default config;
