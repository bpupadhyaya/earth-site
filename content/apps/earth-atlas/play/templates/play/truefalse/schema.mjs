// Data schema for play/truefalse packs (data.json). Uses only the engine/core/schema.mjs subset.
// Every statement cites a source that exists in data.sources (citation gate: no source = no claim).
export const SCHEMA = {
  type: 'object',
  required: ['statements', 'sources'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 80 },
    intro: { type: 'string', maxLength: 400 },
    statements: {
      type: 'array', minItems: 3, maxItems: 100,
      items: {
        type: 'object', required: ['id', 'text', 'truth', 'source'], additionalProperties: false,
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9:-]*$' },
          text: { type: 'string', minLength: 3, maxLength: 240 },
          truth: { type: 'boolean' },
          explain: { type: 'string', maxLength: 400 },
          source: { type: 'string' },
        },
      },
    },
    sources: {
      type: 'object',
      additionalProperties: { type: 'object', required: ['title'], additionalProperties: false, properties: { title: { type: 'string', minLength: 3 }, url: { type: 'string' }, license: { type: 'string' }, asOf: { type: 'string' } } },
    },
    settings: {
      type: 'object', additionalProperties: false,
      properties: { shuffle: { type: 'boolean' }, count: { type: 'integer', minimum: 1, maximum: 100 }, passScore: { type: 'number', minimum: 0, maximum: 1 } },
    },
  },
};
