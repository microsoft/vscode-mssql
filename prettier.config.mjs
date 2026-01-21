/** @type {import('prettier').Config} */
export default {
    tabWidth: 4,
    printWidth: 100,
    bracketSameLine: true,
    endOfLine: "crlf",
    overrides: [
        { files: "*.svg", options: { parser: "html" } },
        { files: ["*.yml", "*.yaml"], options: { tabWidth: 2 } },
    ],
};
