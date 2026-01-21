// Root Prettier config for the monorepo.
// Extensions may override this with their own config files.

/** @type {import('prettier').Config} */
const config = {
  tabWidth: 4,
  printWidth: 100,
  bracketSameLine: true,

  // Repo enforces CRLF for most files via .gitattributes/.editorconfig.
  endOfLine: "crlf",

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
