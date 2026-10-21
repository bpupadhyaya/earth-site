// Data schema for learn/flashcards packs (data.json). Uses only the engine/core/schema.mjs subset.
// Any object with a "source" field must point at an entry of data.sources (citation gate: no source = no claim).
export const SCHEMA = {
  type: 'object',
  required: ['cards', 'sources'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 80 },
    intro: { type: 'string', maxLength: 400 },
    cards: {
      type: 'array', minItems: 3, maxItems: 100,
      items: {
        type: 'object', required: ['id', 'front', 'back', 'source'], additionalProperties: false,
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9:-]*$' },
          front: { type: 'string', minLength: 2, maxLength: 200 },
          back: { type: 'string', minLength: 1, maxLength: 200 },
          explain: { type: 'string', maxLength: 400 },
          source: { type: 'string' },
          media: { type: 'string', pattern: '^[0-9a-f]{16,64}$' },
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
        sessionSize: { type: 'integer', minimum: 1, maximum: 100 },
        shuffle: { type: 'boolean' },
        boxes: { type: 'integer', minimum: 2, maximum: 5 },
      },
    },
  },
};
