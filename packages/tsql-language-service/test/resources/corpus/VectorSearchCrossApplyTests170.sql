DECLARE @qv VECTOR(1536);

SELECT qt.qid, src.id, ann.distance 
FROM QueryTable qt 
CROSS APPLY 
    VECTOR_SEARCH( 
        TABLE = graphnode AS src, 
        COLUMN = embedding, 
        SIMILAR_TO = qt.qembedding, 
        METRIC = 'euclidean', 
        TOP_N = dbo.qt.top_n 
    ) AS ann
