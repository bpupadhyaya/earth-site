// Data schema for play/map-pin packs (data.json). Uses only the engine/core/schema.mjs subset.
// Every round cites the source of its coordinates in `source` (citation gate: no source = no claim); a fact line taken from
// another source lists it in `sources`. Coordinates are copied from knowledge claims, never typed from memory.
const LAT = { type: 'number', minimum: -90, maximum: 90 };
const LON = { type: 'number', minimum: -180, maximum: 180 };
const ID = { type: 'string', pattern: '^[a-z0-9][a-z0-9:-]*$', maxLength: 80 };
const KM = { type: 'number', minimum: 1, maximum: 20000 };

/** What kind of point a round asks for. It sets the radius that still scores full points (scoring.fullKm). */
export const SIZE_CLASSES = ['point', 'city', 'lake', 'country', 'region'];
export const MODES = ['classic', 'streak', 'timed', 'hotcold'];

export const SCHEMA = {
  type: 'object',
  required: ['rounds', 'sources'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 80 },
    intro: { type: 'string', maxLength: 400 },
    mode: { enum: MODES },
    // The area the player works in: the first grid covers it and the map or globe starts on it.
    view: {
      type: 'object', additionalProperties: false,
      properties: {
        kind: { enum: ['map', 'globe'] },
        centre: { type: 'object', required: ['lat', 'lon'], additionalProperties: false, properties: { lat: LAT, lon: LON } },
        span: { type: 'object', required: ['lat', 'lon'], additionalProperties: false, properties: { lat: { type: 'number', minimum: 1, maximum: 180 }, lon: { type: 'number', minimum: 1, maximum: 360 } } },
        projection: { enum: ['equirect', 'stereo'] },
      },
    },
    rounds: {
      type: 'array', minItems: 3, maxItems: 60,
      items: {
        type: 'object', required: ['id', 'name', 'lat', 'lon', 'sizeClass', 'source'], additionalProperties: false,
        properties: {
          id: ID,
          name: { type: 'string', minLength: 1, maxLength: 60 },
          prompt: { type: 'string', minLength: 3, maxLength: 120 },
          lat: LAT, lon: LON,
          sizeClass: { enum: SIZE_CLASSES },
          fact: { type: 'string', minLength: 3, maxLength: 300 },
          source: { type: 'string' },
          sources: { type: 'array', maxItems: 3, items: { type: 'string' } },
        },
      },
    },
    // Named reference points drawn on the easy (labelled) map only.
    landmarks: {
      type: 'array', maxItems: 24,
      items: { type: 'object', required: ['name', 'lat', 'lon', 'source'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 40 }, lat: LAT, lon: LON, source: { type: 'string' }, priority: { type: 'number', minimum: 0, maximum: 10 } } },
    },
    scoring: {
      type: 'object', additionalProperties: false,
      properties: {
        maxPoints: { type: 'integer', minimum: 10, maximum: 1000 },
        fullKm: { type: 'object', additionalProperties: false, properties: { point: KM, city: KM, lake: KM, country: KM, region: KM } },
        zeroKm: KM,
        falloff: { enum: ['linear', 'exp'] },
        missKm: KM,
        hintCost: { type: 'number', minimum: 0, maximum: 1 },
        attemptFactor: { type: 'number', minimum: 0.1, maximum: 1 },
        hintBandsKm: { type: 'array', minItems: 2, maxItems: 10, items: KM },
      },
    },
    settings: {
      type: 'object', additionalProperties: false,
      properties: {
        count: { type: 'integer', minimum: 1, maximum: 60 },
        shuffle: { type: 'boolean' },
        labels: { enum: ['easy', 'hard'] },
        gridLevels: { type: 'integer', minimum: 2, maximum: 6 },
        hints: { type: 'integer', minimum: 0, maximum: 20 },
        lives: { type: 'integer', minimum: 1, maximum: 5 },
        seconds: { type: 'integer', minimum: 10, maximum: 300 },
        attempts: { type: 'integer', minimum: 2, maximum: 6 },
        passScore: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    sources: {
      type: 'object',
      additionalProperties: { type: 'object', required: ['title'], additionalProperties: false, properties: { title: { type: 'string', minLength: 3 }, url: { type: 'string' }, license: { type: 'string' }, asOf: { type: 'string' } } },
    },
  },
};
