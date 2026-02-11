// Prettier configuration for the monorepo
// Uses CRLF line endings to match .gitattributes default

const config = {
    tabWidth: 4,
    printWidth: 100,
    bracketSameLine: true,
    endOfLine: "crlf",
    overrides: [
        {
            // Shell scripts and husky hooks use LF per .gitattributes
            files: ["*.sh", "*.init", ".husky/**/*"],
            options: {
                endOfLine: "lf",
            },
        },
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
