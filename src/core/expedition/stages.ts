// 원정(가제): the three stages of a run (web/docs/expedition-balance.md §17). Each is one tileset of the original with
// its own creatures and boss room: 셀마 초원 (t3), 카라스 사막 (t4), 벨루카 화산 (t6). A stage is three battle zones
// grown from its field maps, rest zones between them, and its boss; the party, its levels, gold, equipment and skills
// go on from one stage to the next. Battle zone n of the run (1..9) is zone power n − 1 (zoneStats, ENEMY_HIT) and
// loot row n (loot.ts), so the stages continue one curve.
import { BIOME_T3, type Biome } from './zone';

export interface Stage {
  /** the stage's name (the stage banner and the result) */
  name: string;
  /** what the HUD calls its battle zones ("사막 2 / 3") */
  area: string;
  /** its boss room's name in the original */
  bossArea: string;
  biome: Biome;
  /** the species of its battle zones (species.ts) and its boss */
  species: readonly number[];
  boss: number;
  /** the line shown when the stage begins */
  intro: string;
}

export const STAGES: readonly Stage[] = [
  {
    name: '셀마 초원', area: '초원', bossArea: '초원 - 깊숙한곳', biome: BIOME_T3, species: [0, 1, 2, 3], boss: 4,
    intro: '셀마 초원. 초원의 왕이 깊은 곳에서 기다린다',
  },
  {
    name: '카라스 사막', area: '사막', bossArea: '서쪽사막 - 잊혀진땅',
    biome: {
      objset: 4,
      // 서쪽사막 5, 4, 3 and 서쪽사막1 (m127, m129, m130, m134): the t4 field maps that grow to ~150 tiles
      battle: [127, 129, 130, 134],
      rest: [387, 388],
      sources: [127, 129, 130, 131, 132, 133, 134, 135, 136, 137, 139, 387, 388, 389, 390, 391, 392, 393, 394, 395],
      // 잊혀진땅 (m128), entered by its west passage; the golem where the original stands it
      boss: { map: 128, start: [2.5, 66.5], exit: [13.5, 3] },
      decals: [],
      water: 182,
      // t4's sand is one tile; its plain ground variants are rarer, and its cliffs are drawn with many tiles
      grassMin: 30,
      shearAny: true,
      // blocked sand that meets walkable sand with no cliff or rim between them is opened (no invisible walls)
      openFlat: true,
    },
    species: [5, 6, 7, 8], boss: 9,
    intro: '카라스 사막. 모래 속에 잠든 봉인을 골렘이 지킨다',
  },
  {
    name: '벨루카 화산', area: '화산', bossArea: '화산 - 용암의대지',
    biome: {
      objset: 6,
      // m198, m200, m202 and m422, the t6 maps that grow at all: they grow one way only (narrow ways between lava and chasms), so these
      // zones are tall and are crossed from north to south
      battle: [198, 200, 202, 422],
      rest: [423, 424],
      sources: [198, 199, 200, 201, 202, 203, 204, 206, 207, 417, 418, 419, 420, 421, 422, 423, 424, 425],
      // 용암의대지 (m205), entered from the south; the hellhound where the original stands it
      boss: { map: 205, start: [20.5, 50], exit: [16.5, 6] },
      decals: [],
      water: 227,
      grassMin: 30,
      shearAny: true,
    },
    species: [10, 11, 12], boss: 13,
    intro: '벨루카 화산. 용암의 대지 끝에서 지옥견이 울부짖는다',
  },
];

/** battle zones in a stage */
export const STAGE_ZONES = 3;
