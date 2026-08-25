-- QO-9a large-cell shape: 20 rows x two ~1 MiB-character MAX cells computed
-- server-side (no seed dependency beyond dbo.PerfRows). With the service's
-- pinned 1 MiB maxCellBytes these arrive as honest truncated wrappers -- the
-- scenario measures the bounded-payload path, not a full-value transfer.
SELECT TOP (20)
  Id,
  CAST(N'{"id":' + CAST(Id AS NVARCHAR(10)) + N',"data":"' + REPLICATE(CAST(N'x' AS NVARCHAR(MAX)), 1048576) + N'"}' AS NVARCHAR(MAX)) AS JsonPayload,
  CAST(N'<root>' + REPLICATE(CAST(N'<i>y</i>' AS NVARCHAR(MAX)), 131072) + N'</root>' AS NVARCHAR(MAX)) AS XmlPayload
FROM dbo.PerfRows
ORDER BY Id;
