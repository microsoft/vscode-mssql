CREATE EXTERNAL MODEL abc
    AUTHORIZATION dbo
WITH (
LOCATION = 'sdfasfd',
API_FORMAT = 'Ollama',
MODEL_TYPE = EMBEDDINGS,
MODEL = 'shghfh',
PARAMETERS = '{"key":"valuoipe"}'
);
CREATE EXTERNAL MODEL simple_model
WITH (
LOCATION = '/models/simple',
API_FORMAT = 'OpenAI',
MODEL_TYPE = EMBEDDINGS,
MODEL = 'gpt-3.5-turbo'
);
CREATE EXTERNAL MODEL advanced_model
WITH (
LOCATION = 'https://models.example.com/advanced',
API_FORMAT = 'Azure OpenAI',
MODEL_TYPE = EMBEDDINGS,
MODEL = 'bert-base-uncased',
PARAMETERS = '{"batch_size":32,"device":"cuda"}'
);
CREATE EXTERNAL MODEL [model_name]
WITH (
LOCATION = 'FILE PATH',
API_FORMAT = 'onnx runtime',
MODEL_TYPE = EMBEDDINGS,
MODEL = 'text-embedding-ada-002,etc',
PARAMETERS = '{ "valid":"JSON"}',
LOCAL_RUNTIME_PATH = 'Path on local server to onnx runtime'
);