// Data schema for play/estimate packs (data.json). Uses only the engine/core/schema.mjs subset.
// Every item cites a source that exists in data.sources (citation gate: no source = no claim).
export const SCHEMA = {
  type: 'object',
  required: ['items', 'sources'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 80 },
    intro: { type: 'string', maxLength: 400 },
    items: {
      type: 'array', minItems: 3, maxItems: 100,
      items: {
        type: 'object', required: ['id', 'prompt', 'value', 'unit', 'source'], additionalProperties: false,
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9:-]*$' },
          prompt: { type: 'string', minLength: 3, maxLength: 240 },
          value: { type: 'number', minimum: 0.0001, maximum: 1e15 },
          unit: { type: 'string', maxLength: 30 },
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
      properties: {
        bands: { type: 'integer', minimum: 4, maximum: 6 },
        count: { type: 'integer', minimum: 1, maximum: 100 },
        bandRatio: { type: 'number', minimum: 2, maximum: 10 },
        maxValue: { type: 'number', minimum: 0.0001, maximum: 1e15 },   // no answer range starts at or above this (a physical upper limit)
        shuffle: { type: 'boolean' },
        passScore: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
};
