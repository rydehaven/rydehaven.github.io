// config.js — texture slots and the shared TEXTURE LIBRARY.
//
// Each map (maps/*.js) picks textures from the library by name, e.g.
//   textures: { road: 'asphalt_02', grass: 'rocky_terrain_02' }
// Slots a map doesn't fill use procedural placeholders (or whatever you drop in the Textures panel).
//
// Adding a Poly Haven texture: download at 1k or 2k, JPG, put the files in textures/shared/<name>/
// as diff.jpg, nor_gl.jpg (OpenGL normal, NOT nor_dx) and arm.jpg (AO/Rough/Metal). No ARM file?
// set arm: null and fill rough (and ao) instead. `meters` = real-world size of one tile, from the
// asset's "Dimensions" on Poly Haven.

export const SLOT_INFO = {
  road: { label: 'Road (asphalt)', meters: 3 },
  shoulder: { label: 'Shoulder (gravel)', meters: 2 },
  grass: { label: 'Terrain: grass', meters: 4 },
  dirt: { label: 'Terrain: dirt / verge', meters: 3 },
  rock: { label: 'Terrain: rock', meters: 8 },
  snow: { label: 'Terrain: snow', meters: 4 },
};

export const TEXLIB = {
  asphalt_02: { // Poly Haven asphalt_02 (3 m tile)
    meters: 3,
    files: { diff: 'textures/shared/asphalt_02/diff.jpg', nor: 'textures/shared/asphalt_02/nor_gl.jpg', arm: 'textures/shared/asphalt_02/arm.jpg', rough: null, ao: null },
  },
  asphalt_01: { // Poly Haven asphalt_01: darker, smoother asphalt with fine aggregate (2.08 m tile; normal map generated from the color)
    meters: 2.08,
    files: { diff: 'textures/shared/asphalt_01/diff.jpg', nor: 'textures/shared/asphalt_01/nor_gl.jpg', arm: 'textures/shared/asphalt_01/arm.jpg', rough: null, ao: null },
  },
  grass_ground: { // Poly Haven grass_ground (dry grass + dirt patches, 2.5 m tile)
    meters: 2.5,
    files: { diff: 'textures/shared/grass_ground/diff.jpg', nor: 'textures/shared/grass_ground/nor_gl.jpg', arm: 'textures/shared/grass_ground/arm.jpg', rough: null, ao: null },
  },
  sparse_grass: { // Poly Haven sparse_grass (thin grass over red-brown soil, 2 m tile)
    meters: 2,
    files: { diff: 'textures/shared/sparse_grass/diff.jpg', nor: 'textures/shared/sparse_grass/nor_gl.jpg', arm: 'textures/shared/sparse_grass/arm.jpg', rough: null, ao: null },
  },
  rocky_terrain_03: { // Poly Haven rocky_terrain_03 (90 m aerial scan of rock slabs + grass, shown at 45 m)
    meters: 45,
    files: { diff: 'textures/shared/rocky_terrain_03/diff.jpg', nor: 'textures/shared/rocky_terrain_03/nor_gl.jpg', arm: 'textures/shared/rocky_terrain_03/arm.jpg', rough: null, ao: null },
  },
  castle_wall_slates: { // Poly Haven castle_wall_slates: slate rubble stone in pale mortar (2.5 m tile)
    meters: 2.5,
    files: { diff: 'textures/shared/castle_wall_slates/diff.jpg', nor: 'textures/shared/castle_wall_slates/nor_gl.jpg', arm: 'textures/shared/castle_wall_slates/arm.jpg', rough: null, ao: null },
  },
  medieval_red_brick: { // Poly Haven medieval_red_brick: old hand-made red brick, pale mortar (2 m tile)
    meters: 2,
    files: { diff: 'textures/shared/medieval_red_brick/diff.jpg', nor: 'textures/shared/medieval_red_brick/nor_gl.jpg', arm: 'textures/shared/medieval_red_brick/arm.jpg', rough: null, ao: null },
  },
  roof_planks: { // Poly Haven roof_planks: varnished vertical boards with dark gaps (1.5 m tile) — doors, shutters, gable boards
    meters: 1.5,
    files: { diff: 'textures/shared/roof_planks/diff.jpg', nor: 'textures/shared/roof_planks/nor_gl.jpg', arm: 'textures/shared/roof_planks/arm.jpg', rough: null, ao: null },
  },
  reed_roof_03: { // Poly Haven reed_roof_03, thatch field only (ridge strip cut off, made seamless top-to-bottom), 2.5 m tile
    meters: 2.5,
    files: { diff: 'textures/shared/reed_roof_03/diff.jpg', nor: 'textures/shared/reed_roof_03/nor_gl.jpg', arm: 'textures/shared/reed_roof_03/arm.jpg', rough: null, ao: null },
  },
  reed_roof_03_ridge: { // the ridge band of reed_roof_03 (bound reed + wooden stakes), tiles sideways along the roof ridge
    meters: 2.5,
    files: { diff: 'textures/shared/reed_roof_03_ridge/diff.jpg', nor: 'textures/shared/reed_roof_03_ridge/nor_gl.jpg', arm: 'textures/shared/reed_roof_03_ridge/arm.jpg', rough: null, ao: null },
  },
  fort_wall: { // Poly Haven modular_fort_01 wall: rubble stone with rain streaks (~3 m tile, est.)
    meters: 3,
    files: { diff: 'textures/shared/fort_wall/diff.jpg', nor: 'textures/shared/fort_wall/nor_gl.jpg', arm: 'textures/shared/fort_wall/arm.jpg', rough: null, ao: null },
  },
  fort_plaster: { // Poly Haven modular_fort_01 plaster: weathered render over brick (~3 m tile, est.)
    meters: 3,
    files: { diff: 'textures/shared/fort_plaster/diff.jpg', nor: 'textures/shared/fort_plaster/nor_gl.jpg', arm: 'textures/shared/fort_plaster/arm.jpg', rough: null, ao: null },
  },
  fort_trim: { // Poly Haven modular_fort_01 trim sheet: cut-stone blocks + moulding strips, for wall caps/edges (~2 m, est.)
    meters: 2,
    files: { diff: 'textures/shared/fort_trim/diff.jpg', nor: 'textures/shared/fort_trim/nor_gl.jpg', arm: 'textures/shared/fort_trim/arm.jpg', rough: null, ao: null },
  },
  rocks_ground_04: { // Poly Haven rocks_ground_04: broken grey rock slabs with gravel between (scan shown large, 40 m per tile, so mountain faces read as big rock structure with no visible repeat)
    meters: 40,
    files: { diff: 'textures/shared/rocks_ground_04/diff.jpg', nor: 'textures/shared/rocks_ground_04/nor_gl.jpg', arm: 'textures/shared/rocks_ground_04/arm.jpg', rough: null, ao: null },
  },
  rocky_terrain_02: { // Poly Haven rocky_terrain_02 (90 m aerial scan, shown at 60 m)
    meters: 60,
    files: { diff: 'textures/shared/rocky_terrain_02/diff.jpg', nor: 'textures/shared/rocky_terrain_02/nor_gl.jpg', arm: 'textures/shared/rocky_terrain_02/arm.jpg', rough: null, ao: null },
  },
};

// Optional Poly Haven HDRI for sky + lighting (.hdr, 1k or 2k is enough).
export const SKY = { hdr: 'textures/sky/sky.hdr', exposure: 1.0 };
