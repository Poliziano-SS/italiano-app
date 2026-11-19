// Monta os exercícios das lições e das revisões a partir do conteúdo. Sem IA.
import { tokenize, normalize } from './check.js';

export const TYPES = {
  escolher: 'Escolher a tradução',
  montar: 'Montar a frase',
  digitar: 'Digitar a tradução',
  ouvir: 'Ouvir e digitar',
  pares: 'Combinar pares',
  lacuna: 'Completar a lacuna',
  falar: 'Falar a frase',
};

export function rng(seed = Date.now()) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle(arr, r = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const pickN = (arr, n, r) => shuffle(arr, r).slice(0, n);

function expectedIt(item) { return [item.it, ...(item.alt || [])]; }

// Distratores: preferir itens do mesmo tipo da mesma lição/unidade, depois do curso todo.
function distractors(idx, item, field, n, r) {
  const same = [];
  const rest = [];
  for (const other of idx.items.values()) {
    if (other.id === item.id || other.kind !== item.kind) continue;
    const v = other[field];
    if (normalize(v) === normalize(item[field])) continue;
    (other.lessonId.slice(0, 2) === item.lessonId.slice(0, 2) ? same : rest).push(v);
  }
  const uniq = [...new Set(shuffle(same, r))];
  const out = uniq.slice(0, n);
  if (out.length < n) for (const v of shuffle(rest, r)) { if (out.length >= n) break; if (!out.includes(v)) out.push(v); }
  return out;
}

export function makeEscolher(idx, item, r, dir = 'it-pt') {
  const field = dir === 'it-pt' ? 'pt' : 'it';
  const answer = item[field];
  const options = shuffle([answer, ...distractors(idx, item, field, 3, r)], r);
  return { type: 'escolher', itemId: item.id, dir, prompt: dir === 'it-pt' ? item.it : item.pt, audio: dir === 'it-pt' ? item.it : null, options, answer };
}

export function makeMontar(idx, item, r) {
  const tokens = tokenize(item.it);
  const own = new Set(tokens.map((t) => t.toLowerCase()));
  const pool = [];
  for (const other of idx.items.values()) {
    if (other.kind !== 'f' || other.id === item.id) continue;
    for (const t of tokenize(other.it)) if (!own.has(t.toLowerCase()) && t.length > 1) pool.push(t);
  }
  const extra = [...new Set(shuffle(pool, r))].slice(0, Math.min(4, Math.max(2, Math.ceil(tokens.length / 2))));
  const tiles = shuffle([...tokens, ...extra], r).map((t, i) => ({ id: i, t }));
  return { type: 'montar', itemId: item.id, prompt: item.pt, tiles, expected: expectedIt(item) };
}

export function makeDigitar(item) {
  return { type: 'digitar', itemId: item.id, prompt: item.pt, expected: expectedIt(item) };
}

export function makeOuvir(item) {
  return { type: 'ouvir', itemId: item.id, audio: item.it, pt: item.pt, expected: expectedIt(item) };
}

export function makeFalar(item) {
  return { type: 'falar', itemId: item.id, prompt: item.it, pt: item.pt, audio: item.it, expected: item.it };
}

export function makePares(items, r) {
  const pairs = items.slice(0, 5).map((i) => ({ itemId: i.id, it: i.it, pt: i.pt }));
  return { type: 'pares', itemIds: pairs.map((p) => p.itemId), left: shuffle(pairs, r), right: shuffle(pairs, r) };
}

export function makeLacuna(idx, item, r) {
  let gap = item.gap;
  if (!gap) {
    // escolhe automaticamente a palavra mais longa que é vocabulário conhecido
    const toks = tokenize(item.it);
    const cand = [...toks].sort((a, b) => b.length - a.length)[0];
    const pos = item.it.indexOf(cand);
    gap = { before: item.it.slice(0, pos), after: item.it.slice(pos + cand.length), answer: cand, distractors: [] };
  }
  let wrong = gap.distractors.slice(0, 3);
  if (wrong.length < 2) {
    const pool = [];
    for (const other of idx.items.values()) for (const t of tokenize(other.it)) {
      if (normalize(t) !== normalize(gap.answer) && Math.abs(t.length - gap.answer.length) <= 3 && t.length > 1) pool.push(t.toLowerCase());
    }
    for (const t of shuffle([...new Set(pool)], r)) { if (wrong.length >= 3) break; if (!wrong.includes(t)) wrong.push(t); }
  }
  const options = shuffle([gap.answer, ...wrong], r);
  return { type: 'lacuna', itemId: item.id, before: gap.before, after: gap.after, answer: gap.answer, options, pt: item.pt, full: item.it };
}

/**
 * Exercícios de uma lição (~12-14), do fácil ao difícil, como no Duolingo:
 * reconhecer → combinar → completar → montar → ouvir → digitar → falar.
 */
export function lessonExercises(idx, lesson, opts = {}, r = Math.random) {
  const { listen = true, speak = false } = opts;
  const items = lesson.itemIds.map((id) => idx.items.get(id));
  const words = shuffle(items.filter((i) => i.kind === 'w'), r);
  const sents = shuffle(items.filter((i) => i.kind === 'f'), r);
  const ex = [];
  // 1) reconhecer palavras novas
  words.slice(0, 2).forEach((w) => ex.push(makeEscolher(idx, w, r, 'it-pt')));
  if (words[2]) ex.push(makeEscolher(idx, words[2], r, 'pt-it'));
  // 2) combinar pares
  if (words.length >= 4) ex.push(makePares(shuffle(words, r), r));
  // 3) frases: escolher, completar, montar, ouvir, digitar
  const s = (i) => sents[i % sents.length];
  if (sents.length) {
    ex.push(makeEscolher(idx, s(0), r, 'it-pt'));
    ex.push(makeLacuna(idx, s(1), r));
    ex.push(makeMontar(idx, s(2), r));
    ex.push(makeLacuna(idx, s(3), r));
    ex.push(makeMontar(idx, s(4), r));
    if (listen) ex.push(makeOuvir(s(5))); else ex.push(makeEscolher(idx, s(5), r, 'pt-it'));
    ex.push(makeDigitar(s(0)));
    if (words[3]) ex.push(makeDigitar(words[3]));
    if (speak) ex.push(makeFalar(s(1)));
    else ex.push(makeMontar(idx, s(1), r));
  }
  return ex;
}

/**
 * Revisão diária: um exercício por cartão vencido. Quanto mais maduro o cartão,
 * mais difícil o exercício (reconhecer → produzir).
 */
export function reviewExercises(idx, ids, cards, opts = {}, r = Math.random) {
  const { listen = true } = opts;
  const out = [];
  for (const id of ids) {
    const item = idx.items.get(id);
    if (!item) continue;
    const reps = cards[id]?.reps || 0;
    const roll = r();
    if (item.kind === 'w') {
      if (reps < 2) out.push(makeEscolher(idx, item, r, roll < 0.5 ? 'it-pt' : 'pt-it'));
      else out.push(makeDigitar(item));
    } else if (reps < 2) {
      out.push(roll < 0.5 ? makeLacuna(idx, item, r) : makeMontar(idx, item, r));
    } else if (listen && roll < 0.35) out.push(makeOuvir(item));
    else if (roll < 0.6) out.push(makeMontar(idx, item, r));
    else out.push(makeDigitar(item));
  }
  return shuffle(out, r);
}

/** Revisão de erros: refaz o item com um exercício de produção (mais exigente). */
export function errorExercises(idx, ids, opts = {}, r = Math.random) {
  const { listen = true } = opts;
  return shuffle(ids.map((id) => idx.items.get(id)).filter(Boolean).map((item, i) => {
    if (item.kind === 'w') return i % 2 ? makeDigitar(item) : makeEscolher(idx, item, r, 'pt-it');
    const k = i % 3;
    if (k === 0) return makeDigitar(item);
    if (k === 1) return listen ? makeOuvir(item) : makeMontar(idx, item, r);
    return item.gap ? makeLacuna(idx, item, r) : makeMontar(idx, item, r);
  }), r);
}
