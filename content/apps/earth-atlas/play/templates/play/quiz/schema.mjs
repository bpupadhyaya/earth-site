// Data schema for play/quiz packs (data.json). Uses only the engine/core/schema.mjs subset.
// Any object with a "source" field must point at an entry of data.sources (citation gate: no source = no claim).
export const SCHEMA = {
  type: 'object',
  required: ['questions', 'sources'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 80 },
    intro: { type: 'string', maxLength: 400 },
    questions: {
      type: 'array', minItems: 3, maxItems: 100,
      items: {
        type: 'object', required: ['id', 'prompt', 'choices', 'answer', 'source'], additionalProperties: false,
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9:-]*$' },
          prompt: { type: 'string', minLength: 3, maxLength: 240 },
          choices: { type: 'array', minItems: 2, maxItems: 6, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 80 } },
          answer: { type: 'integer', minimum: 0, maximum: 5 },
          context: { type: 'string', minLength: 1, maxLength: 600 },
          explain: { type: 'string', maxLength: 400 },
          source: { type: 'string' },
          media: { type: 'string', pattern: '^[0-9a-f]{16,64}$' },
          mediaAlt: { type: 'string', maxLength: 300 },
        },
      },
    },
    sources: {
      type: 'object',
      additionalProperties: { type: 'object', required: ['title'], additionalProperties: false, properties: { title: { type: 'string', minLength: 3 }, url: { type: 'string' }, license: { type: 'string' }, asOf: { type: 'string' } } },
    },
    settings: {
      type: 'object', additionalProperties: false,
      properties: { shuffleQuestions: { type: 'boolean' }, shuffleChoices: { type: 'boolean' }, count: { type: 'integer', minimum: 1, maximum: 100 }, passScore: { type: 'number', minimum: 0, maximum: 1 },
        mode: { type: 'string', enum: ['classic', 'timed', 'survival'] }, seconds: { type: 'integer', minimum: 3, maximum: 300 }, lives: { type: 'integer', minimum: 1, maximum: 10 }, hints: { type: 'integer', minimum: 0, maximum: 20 } },
    },
  },
};
