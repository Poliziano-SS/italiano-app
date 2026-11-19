// XP, meta diária, ofensiva e comparação semanal. Funções puras, fáceis de testar.

export function dayKey(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(key, n) {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Dia "ativo" = pelo menos uma lição ou revisão concluída. */
export function isActive(day) {
  return !!day && (day.sessions || 0) > 0;
}

/**
 * Ofensiva: dias seguidos com atividade. Se hoje ainda não teve atividade,
 * a ofensiva de ontem continua valendo (só quebra se passar um dia inteiro).
 */
export function computeStreak(days, today = dayKey()) {
  const active = (k) => isActive(days[k]);
  let cur = 0;
  let k = active(today) ? today : addDays(today, -1);
  while (active(k)) { cur++; k = addDays(k, -1); }
  // melhor ofensiva histórica
  const keys = Object.keys(days).filter(active).sort();
  let best = 0, run = 0, prev = null;
  for (const key of keys) {
    run = prev && addDays(prev, 1) === key ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return { current: cur, best: Math.max(best, cur), doneToday: active(today) };
}

/** Segunda-feira da semana de `key`. */
export function weekStart(key) {
  const d = parseDay(key);
  const dow = (d.getDay() + 6) % 7; // 0 = segunda
  d.setDate(d.getDate() - dow);
  return dayKey(d);
}

/** XP por dia desta semana e da anterior, para o gráfico que substitui as ligas. */
export function weekly(days, today = dayKey()) {
  const start = weekStart(today);
  const prevStart = addDays(start, -7);
  const pick = (s) => Array.from({ length: 7 }, (_, i) => {
    const k = addDays(s, i);
    return { key: k, xp: days[k]?.xp || 0, minutes: Math.round((days[k]?.seconds || 0) / 60) };
  });
  const thisWeek = pick(start);
  const lastWeek = pick(prevStart);
  const todayIdx = thisWeek.findIndex((d) => d.key === today);
  const sum = (arr) => arr.reduce((a, d) => a + d.xp, 0);
  const thisTotal = sum(thisWeek);
  const lastTotal = sum(lastWeek);
  // mesma altura da semana passada (até o mesmo dia), comparação justa
  const lastSoFar = sum(lastWeek.slice(0, todayIdx + 1));
  return { thisWeek, lastWeek, thisTotal, lastTotal, lastSoFar, todayIdx };
}

/** Registra atividade no dia. Retorna o objeto de dias atualizado (imutável). */
export function recordActivity(days, { xp = 0, exercises = 0, correct = 0, seconds = 0, session = false }, now = new Date()) {
  const k = dayKey(now);
  const d = { xp: 0, exercises: 0, correct: 0, seconds: 0, sessions: 0, ...(days[k] || {}) };
  d.xp += xp;
  d.exercises += exercises;
  d.correct += correct;
  d.seconds += seconds;
  if (session) d.sessions += 1;
  return { ...days, [k]: d };
}

/** XP de uma lição: 10 base + 1 por exercício certo de primeira (máx. 10) + 5 se perfeita. */
export function lessonXP({ correctFirst, total, mistakes }) {
  return 10 + Math.min(10, correctFirst) + (mistakes === 0 && total > 0 ? 5 : 0);
}

export function totalXP(days) {
  return Object.values(days).reduce((a, d) => a + (d.xp || 0), 0);
}
