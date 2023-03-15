These steps should be followed to publish a new version of the package to npmjs.

1. Bump version if needed
2. Run the [Official Build Pipeline](https://mssqltools.visualstudio.com/CrossPlatBuildScripts/_build?definitionId=522) against main
3. Download ads-adal-library-X.X.X.tgz package from the artifacts of the completed build
4. Run `npm publish <PATH_TO_PACKAGE>/microsoft-ads-adal-library-X.X.X.tgz`
   * If you do not have permissions to publish contact the team to get added to the [azure-data-studio](https://www.npmjs.com/settings/microsoft/teams/team/azure-data-studio/users) team on NPM
   * See [the docs](https://docs.opensource.microsoft.com/releasing/publish-binaries/npm/#publish-microsoft-scoped-packages) for more info about the publishing process
5. Create a [release](https://github.com/microsoft/vscode-mssql/releases) with a tag pointing to the commit the build is from (should be the latest from main) with a link to the package version that was just released (e.g. https://www.npmjs.com/package/@microsoft/ads-adal-library/v/1.0.15)