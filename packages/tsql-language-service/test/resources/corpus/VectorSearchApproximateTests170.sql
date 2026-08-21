-- Tests for VECTOR_SEARCH with TOP WITH APPROXIMATE and FETCH APPROXIMATE
-- From ADO commit: 355ed5f69d5c8a589271a5a5d4df76665bb4e985
-- Source: VectorSearch.xml tests top_with_approx, top_with_approximate, order_by_fetch_approx, order_by_fetch_approximate

-- Test 1: TOP WITH APPROX (abbreviated)
SELECT TOP 10 WITH APPROX qt.qid, src.id, ann.distance FROM QueryTable qt
CROSS APPLY
	VECTOR_SEARCH(
		TABLE		= graphnode AS src,
		COLUMN		= embedding,
		SIMILAR_TO	= qt.qembedding,
		METRIC		= 'euclidean',
		TOP_N		= 10
	) AS ann
ORDER BY ann.distance;
GO

-- Test 2: TOP WITH APPROXIMATE (full keyword)
SELECT TOP 10 WITH APPROXIMATE qt.qid, src.id, ann.distance FROM QueryTable qt
CROSS APPLY
	VECTOR_SEARCH(
		TABLE		= graphnode AS src,
		COLUMN		= embedding,
		SIMILAR_TO	= qt.qembedding,
		METRIC		= 'euclidean',
		TOP_N		= 10
	) AS ann
ORDER BY ann.distance;
GO

-- Test 3: ORDER BY FETCH APPROX (abbreviated)
SELECT qt.qid, src.id, ann.distance FROM QueryTable qt
CROSS APPLY
	VECTOR_SEARCH(
		TABLE		= graphnode AS src,
		COLUMN		= embedding,
		SIMILAR_TO	= qt.qembedding,
		METRIC		= 'euclidean',
		TOP_N		= 10
	) AS ann
ORDER BY ann.distance
FETCH APPROX NEXT 10 ROWS ONLY;
GO

-- Test 4: ORDER BY FETCH APPROXIMATE (full keyword)
SELECT qt.qid, src.id, ann.distance FROM QueryTable qt
CROSS APPLY
	VECTOR_SEARCH(
		TABLE		= graphnode AS src,
		COLUMN		= embedding,
		SIMILAR_TO	= qt.qembedding,
		METRIC		= 'euclidean',
		TOP_N		= 10
	) AS ann
ORDER BY ann.distance
FETCH APPROXIMATE NEXT 10 ROWS ONLY;
GO
