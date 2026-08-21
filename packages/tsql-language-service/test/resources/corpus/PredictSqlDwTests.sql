SELECT d.*, p.Score
FROM PREDICT(MODEL = (SELECT Model FROM Models WHERE Id = 4), DATA = testData AS d, RUNTIME=ONNX) WITH (Score float) AS p;

INSERT INTO test_application (c1, c2, c3, c4, score)
SELECT d.c1, d.c2, d.c3, d.c4, p.Score
FROM PREDICT(MODEL = (SELECT Model FROM Models WHERE Id = 4), DATA = testData AS d, RUNTIME=ONNX) WITH (Score float) AS p;

INSERT INTO sample_applications (c1, c2, c3, c4, score)
SELECT d.c1, d.c2, d.c3, d.c4, p.score
FROM PREDICT(MODEL = @model, DATA = dbo.mytable AS d, RUNTIME=ONNX) WITH(score FLOAT) AS p;