// riders.js — 双骑手角色档案（UI、技能与数值共用）
export const RIDER_PROFILES = {
  alan: {
    id: 'alan',
    name: '蓝小哥',
    title: '冷萃骑士',
    role: '速度 · 耐力 · 夜班之王',
    accent: '#6aa8d8',
    stats: { 速度: 92, 耐力: 88, 好评: 76, 抗压: 90 },
    skill: '蓝光闪送',
    skillType: 'active',
    skillKey: 'E',
    skillDesc: '抢单瞬间提速 30%，持续 8 秒；冷却 90 秒',
    skillHint: '按 E 释放',
    quote: '“让一让，蓝小哥过。”',
    catchphrase: '“蓝的都到。”',
    defeat: '“…… 这单，超时了。”',
    speedMul: 1.03,
    tipMul: 1.0,
    invulnBonus: 0.06,
    starBonus: 0,
  },
  xiaoman: {
    id: 'xiaoman',
    name: '奶茶妹',
    title: '奶盖特调',
    role: '社交 · 好评 · 靠笑脸打天下',
    accent: '#6fc7b4',
    stats: { 速度: 78, 耐力: 72, 好评: 95, 抗压: 85 },
    skill: '甜度加持',
    skillType: 'passive',
    skillKey: '被动',
    skillDesc: '送达微笑评级：好评 +40%，小费更高，有机会解锁隐藏小费',
    skillHint: '被动生效',
    quote: '“您的奶盖已到，请查收～”',
    catchphrase: '“记得摇一摇哦。”',
    defeat: '“小心，别洒了…… 啊，洒了。”',
    speedMul: 0.99,
    tipMul: 1.4,
    invulnBonus: 0,
    starBonus: 1,
  },
};

export function riderProfile(id) {
  return RIDER_PROFILES[id === 'alan' ? 'alan' : 'xiaoman'];
}
