// Data schema for play/sort packs (data.json). Uses only the engine/core/schema.mjs subset.
// Every item cites a source that exists in data.sources (citation gate: no source = no claim).
export const SCHEMA = {
  type: 'object',
  required: ['items', 'property', 'sources'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 80 },
    intro: { type: 'string', maxLength: 400 },
    property: {
      type: 'object', required: ['label', 'unit', 'direction'], additionalProperties: false,
      properties: {
        label: { type: 'string', minLength: 1, maxLength: 40 },
        unit: { type: 'string', maxLength: 20 },
        direction: { type: 'string', enum: ['desc', 'asc'] },
      },
    },
    items: {
      type: 'array', minItems: 4, maxItems: 100,
      items: {
        type: 'object', required: ['id', 'label', 'value', 'source'], additionalProperties: false,
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9:-]*$' },
          label: { type: 'string', minLength: 1, maxLength: 60 },
          value: { type: 'number' },
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
      properties: { count: { type: 'integer', minimum: 4, maximum: 7 }, rounds: { type: 'integer', minimum: 1, maximum: 10 }, passScore: { type: 'number', minimum: 0, maximum: 1 } },
    },
  },
};
