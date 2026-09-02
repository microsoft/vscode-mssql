-- Test 1: VECTOR_SEARCH without TOP_N (validates optional parameter)
SELECT * FROM VECTOR_SEARCH(
    TABLE = graphnode,
    COLUMN = embedding,
    SIMILAR_TO = @qembedding,
    METRIC = 'euclidean'
);

-- Test 2: VECTOR_SEARCH without TOP_N + WITH (FORCE_ANN_ONLY) (validates both changes)
SELECT * FROM VECTOR_SEARCH(
    TABLE = graphnode,
    COLUMN = embedding,
    SIMILAR_TO = @qembedding,
    METRIC = 'euclidean'
) WITH (FORCE_ANN_ONLY);

-- Test 3: VECTOR_SEARCH with TOP_N (validates backward compatibility)
SELECT * FROM VECTOR_SEARCH(
    TABLE = graphnode,
    COLUMN = embedding,
    SIMILAR_TO = @qembedding,
    METRIC = 'euclidean',
    TOP_N = 20
);

-- Test 4: VECTOR_SEARCH with TOP_N + WITH (FORCE_ANN_ONLY) (validates both features together)
SELECT * FROM VECTOR_SEARCH(
    TABLE = graphnode,
    COLUMN = embedding,
    SIMILAR_TO = @qembedding,
    METRIC = 'euclidean',
    TOP_N = 20
) WITH (FORCE_ANN_ONLY);
