# Dacpac fixtures (Parts 19 & 40)

The two dacpac environments (`smoke-dacpac`, `smoke-dacpac-clean`) point
`sqlpackage` at a pre-built `.dacpac`. Both dacpacs are checked in here:

| File                       | Built from                                                                                                                 | Exercises                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `SmokeProject.dacpac`      | `samples/cloudDeploy/smoke/sqlproj/SmokeProject.sqlproj` (its `GetCustomers.sql` has `SELECT * FROM dbo.NonExistentTable`) | **Part 19** — Static Analysis **Failed** with an unresolved-reference finding (`SQL715xx`) |
| `SmokeProjectClean.dacpac` | a clean copy with the bad `SELECT` repointed at the real `dbo.Customers` table                                             | **Part 40** — Static Analysis **Passed**, zero findings                                    |

## Rebuilding (needs the .NET SDK)

`sqlpackage` **consumes** a dacpac; building one from a `.sqlproj` needs the
**.NET SDK** (the project uses the `Microsoft.Build.Sql` SDK).

```powershell
# 1) Rebuild the "dirty" dacpac (keeps the deliberate unresolved reference)
dotnet build samples/cloudDeploy/smoke/sqlproj/SmokeProject.sqlproj -c Release
Copy-Item samples/cloudDeploy/smoke/sqlproj/bin/Release/SmokeProject.dacpac `
  samples/cloudDeploy/smoke/dacpac/SmokeProject.dacpac -Force

# 2) For the clean dacpac: copy the sqlproj to a temp dir, change
#    Procedures/GetCustomers.sql to `SELECT [Id],[Name] FROM [dbo].[Customers]`,
#    build, and copy the output here as SmokeProjectClean.dacpac.
```
