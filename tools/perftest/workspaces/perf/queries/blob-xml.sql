SELECT Id, DATALENGTH(BinPayload) AS BinBytes, BinPayload, XmlPayload, LEN(TextPayload) AS TextChars, TextPayload
FROM dbo.PerfBlobs
ORDER BY Id;
