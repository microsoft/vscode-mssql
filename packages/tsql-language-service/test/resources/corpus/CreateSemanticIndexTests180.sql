-- Basic semantic index (defaults to SEARCH_TYPE=vector, requires EXTERNAL_MODEL)
CREATE SEMANTIC INDEX SI_Basic ON dbo.Documents (content) WITH (EXTERNAL_MODEL = MyModel);

-- Semantic index with SEARCH_TYPE and EXTERNAL_MODEL (required for vector)
CREATE SEMANTIC INDEX SI_Vector ON dbo.books (summary SEARCH_TYPE=vector) WITH (EXTERNAL_MODEL = MyModel);

-- Multiple columns with SEARCH_TYPE and EXTERNAL_MODEL (required for vector)
CREATE SEMANTIC INDEX SI_Multi ON dbo.books (summary SEARCH_TYPE=vector, title SEARCH_TYPE=vector) WITH (EXTERNAL_MODEL = MyModel);

-- All search types (EXTERNAL_MODEL required for hybrid)
CREATE SEMANTIC INDEX SI_Hybrid ON dbo.books (content SEARCH_TYPE=hybrid, title SEARCH_TYPE=fulltext) WITH (EXTERNAL_MODEL = MyModel);

-- With TYPE COLUMN (defaults to vector, requires EXTERNAL_MODEL)
CREATE SEMANTIC INDEX SI_TypeCol ON dbo.Documents (content TYPE COLUMN content_type) WITH (EXTERNAL_MODEL = MyModel);

-- With LANGUAGE (defaults to vector, requires EXTERNAL_MODEL)
CREATE SEMANTIC INDEX SI_Lang ON dbo.Documents (content LANGUAGE English) WITH (EXTERNAL_MODEL = MyModel);

-- With CHUNK_USING options (defaults to vector, requires EXTERNAL_MODEL)
CREATE SEMANTIC INDEX SI_Chunk ON dbo.Documents (content CHUNK_USING(TYPE = paragraph, SIZE = 500, OVERLAP = 50)) WITH (EXTERNAL_MODEL = MyModel);

-- Full column definition with EXTERNAL_MODEL (required for vector)
CREATE SEMANTIC INDEX SI_Full ON dbo.Documents (content SEARCH_TYPE=vector TYPE COLUMN content_type LANGUAGE English CHUNK_USING(TYPE = sentence, SIZE = 1000)) WITH (EXTERNAL_MODEL = MyModel);

-- WITH EXTERNAL_MODEL
CREATE SEMANTIC INDEX SI_Model ON dbo.books (summary SEARCH_TYPE=vector) WITH (EXTERNAL_MODEL = OpenAIModel);

-- WITH EXTERNAL_MODEL in parentheses
CREATE SEMANTIC INDEX SI_ModelParen ON dbo.books (summary SEARCH_TYPE=vector) WITH (EXTERNAL_MODEL = (MyModel));

-- WITH EXTERNAL_MODEL and PARAMETERS
CREATE SEMANTIC INDEX SI_ModelParams ON dbo.books (summary SEARCH_TYPE=vector) WITH (EXTERNAL_MODEL = MyModel (PARAMETERS = '{"dimension": 1536}'));

-- WITH VECTOR_INDEX options
CREATE SEMANTIC INDEX SI_VecOpts ON dbo.books (summary SEARCH_TYPE=vector) WITH (EXTERNAL_MODEL = OpenAIModel, VECTOR_INDEX (METRIC = 'cosine'));

-- WITH FULLTEXT_STOPLIST OFF
CREATE SEMANTIC INDEX SI_StopOff ON dbo.books (content SEARCH_TYPE=fulltext) WITH (FULLTEXT_STOPLIST = OFF);

-- WITH FULLTEXT_STOPLIST SYSTEM
CREATE SEMANTIC INDEX SI_StopSys ON dbo.books (content SEARCH_TYPE=fulltext) WITH (FULLTEXT_STOPLIST = SYSTEM);

-- WITH FULLTEXT_STOPLIST name
CREATE SEMANTIC INDEX SI_StopName ON dbo.books (content SEARCH_TYPE=fulltext) WITH (FULLTEXT_STOPLIST = MyStoplist);

-- WITH MAXDOP
CREATE SEMANTIC INDEX SI_MaxDop ON dbo.books (summary SEARCH_TYPE=vector) WITH (EXTERNAL_MODEL = OpenAIModel, MAXDOP = 4);

-- WITH DROP_EXISTING
CREATE SEMANTIC INDEX SI_DropEx ON dbo.books (summary SEARCH_TYPE=vector) WITH (EXTERNAL_MODEL = OpenAIModel, DROP_EXISTING = ON);

-- With ON filegroup
CREATE SEMANTIC INDEX SI_FG ON dbo.books (summary SEARCH_TYPE=vector) WITH (EXTERNAL_MODEL = OpenAIModel) ON [PRIMARY];

-- Complex example with all options
CREATE SEMANTIC INDEX SI_Complete ON dbo.books (summary SEARCH_TYPE=vector, title SEARCH_TYPE=fulltext CHUNK_USING(TYPE = fixed, SIZE = 200, OVERLAP = 25)) WITH (EXTERNAL_MODEL = OpenAIModel (PARAMETERS = '{"api_key": "test"}'), VECTOR_INDEX (METRIC = 'cosine', TYPE = 'DiskANN'), FULLTEXT_STOPLIST = SYSTEM, MAXDOP = 8, DROP_EXISTING = OFF) ON [PRIMARY];
