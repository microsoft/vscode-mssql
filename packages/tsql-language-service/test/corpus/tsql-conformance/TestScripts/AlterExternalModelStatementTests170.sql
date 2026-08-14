ALTER EXTERNAL MODEL abc
SET (
LOCATION = 'new_location',
API_FORMAT = 'Ollama',
MODEL_TYPE = EMBEDDINGS,
MODEL = 'new_model',
PARAMETERS = '{"key":"new_value"}'
);
ALTER EXTERNAL MODEL abc
SET (
MODEL = 'new_model'
);
ALTER EXTERNAL MODEL params_model
SET (
PARAMETERS = '{"temperature":0.7, "max_tokens":2048}'
);
ALTER EXTERNAL MODEL ml_model
SET (
API_FORMAT = 'OpenAI',
MODEL = 'gpt-3.5-turbo-16k',
PARAMETERS = '{"stream":true}'
);
ALTER EXTERNAL MODEL location_change
SET (
LOCATION = '/new/model/path',
MODEL_TYPE = EMBEDDINGS
);