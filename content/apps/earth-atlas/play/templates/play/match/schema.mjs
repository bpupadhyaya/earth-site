// Data schema for play/match packs (data.json). Uses only the engine/core/schema.mjs subset.
// Every pair cites a source that exists in data.sources (citation gate: no source = no claim).
export const SCHEMA = {
  type: 'object',
  required: ['pairs', 'sources'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 80 },
    intro: { type: 'string', maxLength: 400 },
    leftTitle: { type: 'string', maxLength: 40 },
    rightTitle: { type: 'string', maxLength: 40 },
    pairs: {
      type: 'array', minItems: 4, maxItems: 100,
      items: {
        type: 'object', required: ['id', 'left', 'right', 'source'], additionalProperties: false,
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9:-]*$' },
          left: { type: 'string', minLength: 1, maxLength: 60 },
          right: { type: 'string', minLength: 1, maxLength: 60 },
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
      properties: { boardSize: { type: 'integer', minimum: 4, maximum: 8 }, rounds: { type: 'integer', minimum: 1, maximum: 10 } },
    },
  },
};
