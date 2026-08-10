import { parseResult } from "./parser.helpers";

// Source: tSQLt examples (Apache-2.0)
// https://github.com/tSQLt-org/tSQLt/tree/main/Examples
const tsqltCorpus = `
CREATE PROCEDURE Accelerator.SendHiggsBosonDiscoveryEmail
  @EmailAddress NVARCHAR(MAX)
AS
BEGIN
  RAISERROR('Not Implemented - yet',16,10);
END;
GO

CREATE PROCEDURE Accelerator.AlertParticleDiscovered
  @ParticleDiscovered NVARCHAR(MAX)
AS
BEGIN
  IF @ParticleDiscovered = 'Higgs Boson'
  BEGIN
    EXEC Accelerator.SendHiggsBosonDiscoveryEmail 'particle-discovery@new-era-particles.tsqlt.org';
  END;
END;
GO

EXEC tSQLt.NewTestClass 'AcceleratorTests';
GO

CREATE PROCEDURE 
  AcceleratorTests.[test ready for experimentation if 2 particles]
AS
BEGIN
  EXEC tSQLt.FakeTable 'Accelerator.Particle';
  INSERT INTO Accelerator.Particle (Id) VALUES (1);
  INSERT INTO Accelerator.Particle (Id) VALUES (2);
  DECLARE @Ready BIT;
  SELECT @Ready = 1;
  EXEC tSQLt.AssertEquals 1, @Ready;
END;
`;

describe("tSQLt open-source corpus", () => {
    test("selected example batches parse cleanly", () => {
        const result = parseResult(tsqltCorpus);
        const body = result.ast.body as any[];
        const executableBody = body.filter((stmt) => stmt.type !== "BatchSeparatorStatement");

        expect(result.issues).toEqual([]);
        expect(body.filter((stmt) => stmt.type === "BatchSeparatorStatement")).toHaveLength(3);
        expect(executableBody.map((stmt) => stmt.type)).toEqual([
            "CreateStatement",
            "CreateStatement",
            "ExecuteStatement",
            "CreateStatement",
        ]);

        expect(executableBody[0].objectType).toBe("PROCEDURE");
        expect(executableBody[1].objectType).toBe("PROCEDURE");
        expect(executableBody[3].objectType).toBe("PROCEDURE");
    });
});
