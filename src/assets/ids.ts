export const regularTypes = ['thug', 'quick', 'brute'] as const
export const enemyTypes = [...regularTypes, 'bulldog'] as const
export type RegularType = typeof regularTypes[number]
export type EnemyType = typeof enemyTypes[number]
export type Hand = 'left' | 'right'

export const enemyPoses = [
  'idle', 'approach', 'positioning', 'laneTell', 'telegraph', 'attack', 'recovery',
  'hit', 'knockback', 'sideFlight', 'stunned', 'airborne', 'fall', 'defeated',
  'retreat', 'rage', 'finish',
] as const
export type EnemyPose = typeof enemyPoses[number]

export const handPoses = ['idle', 'run', 'punch', 'hook', 'uppercut', 'sideLeft', 'sideRight', 'counter', 'dash', 'hurt', 'knockout', 'finish'] as const
export type HandPose = typeof handPoses[number]
export type AnimationState = EnemyPose | HandPose
export type AssetId =
  | EnemyType | 'fist.left' | 'fist.right'
  | 'park.tree' | 'park.bench' | 'park.lamp' | 'park.sky' | 'park.ridge.far' | 'park.ridge.near'
