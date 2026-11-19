// Dados só no aparelho (localStorage). Backup e relatório em arquivos.
import { dayKey, computeStreak, weekly, totalXP } from './stats.js';
import { summary } from './srs.js';
import { TYPES } from './exercises.js';

export const KEY = 'italiano-app:v1';
export const VERSION = 1;

export function defaultState() {
  return {
    app: 'italiano-app',
    version: VERSION,
    createdAt: new Date().toISOString(),
    settings: { dailyGoal: 30, rate: 1, listen: true, speak: true, autoplay: true, unlockAll: false, voiceURI: '', sounds: true },
    lessons: {},   // { [lessonId]: { completed, bestAccuracy, lastAt } }
    cards: {},     // { [itemId]: cartão FSRS }
    errors: {},    // { [itemId]: { itemId, type, prompt, expected, given, count, lastAt, resolved } }
    days: {},      // { 'AAAA-MM-DD': { xp, exercises, correct, seconds, sessions } }
    byType: {},    // { [tipo]: { done, correct } }
  };
}

export function migrate(s) {
  const base = defaultState();
  if (!s || typeof s !== 'object') return base;
  return {
    ...base, ...s,
    settings: { ...base.settings, ...(s.settings || {}) },
    lessons: s.lessons || {}, cards: s.cards || {}, errors: s.errors || {}, days: s.days || {}, byType: s.byType || {},
    version: VERSION,
  };
}

export function load(storage = globalThis.localStorage) {
  try { return migrate(JSON.parse(storage.getItem(KEY))); } catch { return defaultState(); }
}

export function save(state, storage = globalThis.localStorage) {
  storage.setItem(KEY, JSON.stringify(state));
}

export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object') return 'O arquivo não é um backup válido.';
  if (obj.app !== 'italiano-app') return 'Este arquivo não é um backup deste app.';
  for (const k of ['lessons', 'cards', 'days']) if (obj[k] && typeof obj[k] !== 'object') return `Campo "${k}" inválido no backup.`;
  return null;
}

export function backupJSON(state) {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
}

const fmtDay = (k) => k.split('-').reverse().join('/');

/** Relatório para o Poliziano (Markdown, em português). */
export function reportMarkdown(state, idx, now = new Date()) {
  const today = dayKey(now);
  const st = computeStreak(state.days, today);
  const wk = weekly(state.days, today);
  const srs = summary(state.cards, now);
  const doneLessons = idx.lessons.filter((l) => state.lessons[l.id]?.completed);
  const lines = [];
  lines.push(`# Relatório de italiano — ${fmtDay(today)}`, '');
  lines.push('## Resumo', '');
  lines.push(`- Ofensiva: ${st.current} dia(s) (melhor: ${st.best})`);
  lines.push(`- XP total: ${totalXP(state.days)} · meta diária: ${state.settings.dailyGoal} XP`);
  lines.push(`- Esta semana: ${wk.thisTotal} XP · semana passada: ${wk.lastTotal} XP`);
  lines.push(`- Lições concluídas: ${doneLessons.length} de ${idx.lessons.length}`);
  lines.push(`- Cartões de revisão (FSRS): ${srs.total} · vencidos hoje: ${srs.due} · maduros (≥21 dias): ${srs.mature}`, '');

  lines.push('## Últimos 14 dias', '', '| Dia | XP | Minutos | Exercícios | Acertos |', '|---|---|---|---|---|');
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const k = dayKey(d); const v = state.days[k];
    if (!v) continue;
    const acc = v.exercises ? Math.round((100 * v.correct) / v.exercises) : 0;
    lines.push(`| ${fmtDay(k)} | ${v.xp} | ${Math.round(v.seconds / 60)} | ${v.exercises} | ${acc}% |`);
  }
  lines.push('');

  lines.push('## Acertos por tipo de exercício', '', '| Tipo | Feitos | Acertos |', '|---|---|---|');
  for (const [t, label] of Object.entries(TYPES)) {
    const v = state.byType[t]; if (!v) continue;
    lines.push(`| ${label} | ${v.done} | ${v.done ? Math.round((100 * v.correct) / v.done) : 0}% |`);
  }
  lines.push('');

  lines.push('## Lições concluídas', '');
  let lastUnit = '';
  for (const l of doneLessons) {
    if (l.unitTitle !== lastUnit) { lines.push(`**${l.unitTitle}**`); lastUnit = l.unitTitle; }
    const p = state.lessons[l.id];
    lines.push(`- ${l.titulo} — ${p.completed}x, melhor precisão ${p.bestAccuracy}%`);
  }
  if (!doneLessons.length) lines.push('- Nenhuma ainda.');
  lines.push('');

  const errs = Object.values(state.errors).sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
  const open = errs.filter((e) => !e.resolved);
  lines.push(`## Erros para trabalhar (${open.length} em aberto)`, '');
  if (open.length) {
    lines.push('| Vezes | Pedido | Resposta certa | O que escrevi | Lição |', '|---|---|---|---|---|');
    for (const e of open.slice(0, 40)) {
      const l = idx.lessonById.get(idx.items.get(e.itemId)?.lessonId);
      lines.push(`| ${e.count} | ${e.prompt} | ${e.expected} | ${e.given || '—'} | ${l ? l.titulo : ''} |`);
    }
  } else lines.push('Nenhum erro em aberto. 🎉');
  const fixed = errs.filter((e) => e.resolved).length;
  lines.push('', `Erros já corrigidos na revisão: ${fixed}.`, '');
  lines.push('_Gerado pelo app pessoal de italiano (dados só no aparelho)._');
  return lines.join('\n');
}
