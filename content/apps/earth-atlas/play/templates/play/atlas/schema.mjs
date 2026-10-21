// Data schema for play/atlas packs (data.json). Uses only the engine/core/schema.mjs subset.
// A round shows one place on its map (country outline, flag) and 2-4 place cards to choose from; every round cites a source that
// exists in data.sources (citation gate: no source = no claim). Outlines use the compact grid of knowledge/countries/visual:
// rings are flat integer lists u0,v0,u1,v1,... in 0..1000; box = [west, south, span] in degrees.
const GRID = { type: 'integer', minimum: 0, maximum: 1000 };
const WIDE = { type: 'integer', minimum: -3000, maximum: 4000 };   // context land lies around the grid, not on it
export const SCHEMA = {
  type: 'object',
  required: ['rounds', 'sources'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 80 },
    intro: { type: 'string', maxLength: 400 },
    prompt: { type: 'string', maxLength: 60 },           // the headline of every round, e.g. "Find the capital"
    rounds: {
      type: 'array', minItems: 3, maxItems: 250,
      items: {
        type: 'object', required: ['id', 'place', 'options', 'answer', 'source'], additionalProperties: false,
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9:-]*$' },
          place: {
            type: 'object', required: ['name', 'box', 'outline'], additionalProperties: false,
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 60 },
              iso2: { type: 'string', pattern: '^[A-Z]{2}$' },                       // the flag is drawn from it
              box: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
              outline: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'array', minItems: 6, maxItems: 1600, items: GRID } },
              context: { type: 'array', maxItems: 24, items: { type: 'array', minItems: 6, maxItems: 200, items: WIDE } },   // faint neighbouring land drawn behind the main land
              view: { type: 'array', minItems: 4, maxItems: 4, items: GRID },                       // [u0, v0, u1, v1]: the part of the map to show (zoom); the rest is cropped
              mark: { type: 'array', minItems: 2, maxItems: 2, items: GRID },                       // a pin on the big map from the start (a peak, a lake)
              lines: { type: 'array', maxItems: 8, items: { type: 'array', minItems: 4, maxItems: 800, items: GRID } },   // polylines drawn over the land (a river)
            },
          },
          options: {
            type: 'array', minItems: 2, maxItems: 4,
            items: {
              type: 'object', required: ['id', 'name'], additionalProperties: false,
              properties: {
                id: { type: 'string', pattern: '^[a-z0-9][a-z0-9:-]*$' },
                name: { type: 'string', minLength: 1, maxLength: 60 },
                at: { type: 'array', minItems: 2, maxItems: 2, items: GRID },        // where it lies on the place's map
                shape: { type: 'object', required: ['box', 'outline'], additionalProperties: false, properties: { box: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }, outline: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'array', minItems: 6, maxItems: 1600, items: GRID } } } },   // the card's own shape as a mini map (a neighbour country), when it has no 'at'
                clues: { type: 'array', maxItems: 4, items: { type: 'object', required: ['t', 'source'], additionalProperties: false, properties: { t: { type: 'string', minLength: 1, maxLength: 40 }, source: { type: 'string' } } } },   // short measured facts, each with its source
                note: { type: 'string', maxLength: 200 },                            // shown when it is revealed
              },
            },
          },
          answer: { type: 'string', pattern: '^[a-z0-9][a-z0-9:-]*$' },             // an option id
          explain: { type: 'string', maxLength: 400 },
          source: { type: 'string' },
        },
      },
    },
    sources: {
      type: 'object',
      additionalProperties: { type: 'object', required: ['title'], additionalProperties: false, properties: { title: { type: 'string', minLength: 3 }, url: { type: 'string' }, license: { type: 'string' } } },
    },
    settings: {
      type: 'object', additionalProperties: false,
      properties: { rounds: { type: 'integer', minimum: 3, maximum: 20 } },
    },
  },
};
