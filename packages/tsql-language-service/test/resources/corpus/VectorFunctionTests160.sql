DECLARE @v1 vector ( 4 ), @v2 vector(4)
SET @v2 = CAST('[0.1, 0.1, 0.1,0.2]' as vector(4))
SET @v1 = CONVERT(vector( 4 ), '[0.1, 0.2, 0.1, 0.2]')

-- VECTOR_DISTANCE
SELECT VECTOR_DISTANCE('cosine', @v1, @v2);
SELECT VECTOR_DISTANCE('euclidean', @v1, @v2);
SELECT VECTOR_DISTANCE('dot', @v1, @v2);
SELECT VECTOR_DISTANCE('dot', @v1, NULL);
SELECT ROUND(VECTOR_DISTANCE('cosine',@v1,@v2),16)

-- VECTOR_NORM
SELECT VECTOR_NORM(@v1, 'norm1');
SELECT VECTOR_NORM(@v1, 'norm2');

-- VECTOR_NORMALIZE
SELECT VECTOR_NORMALIZE(@v1, 'norm1') AS normalized_vector;
SELECT VECTOR_NORMALIZE(@v1, 'norm2') AS normalized_vector;

-- VECTORPROPERTY Metadata function
SELECT VECTORPROPERTY(@v1, 'Dimensions');
SELECT VECTORPROPERTY(@v1, 'BaseType');
