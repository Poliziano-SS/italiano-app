// Correção de respostas digitadas — sem IA, tolerante a maiúsculas, pontuação e acentos.

const PRONOUNS = new Set(['io', 'tu', 'lui', 'lei', 'noi', 'voi', 'loro']);

export function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// minúsculas, apóstrofos uniformes, sem pontuação, espaços simples
export function normalize(s) {
  return String(s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’‘`´ʼ]/g, "'")
    .replace(/(\w)'\s+/g, "$1'")
    .replace(/[.,!?¿¡;:"“”«»()\[\]…–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

// Gera variantes aceitas: com/sem pronome sujeito (o italiano costuma omiti-lo).
function variants(expected) {
  const out = new Set();
  for (const e of expected) {
    const n = normalize(e);
    if (!n) continue;
    out.add(n);
    const [first, ...rest] = n.split(' ');
    if (PRONOUNS.has(first) && rest.length) out.add(rest.join(' '));
  }
  return [...out];
}

function dropLeadingPronoun(n) {
  const [first, ...rest] = n.split(' ');
  return PRONOUNS.has(first) && rest.length ? rest.join(' ') : n;
}

// Encontra as palavras com acento que o aluno errou, para o aviso.
function accentHint(given, target) {
  const g = given.split(' ');
  const t = target.split(' ');
  const words = [];
  t.forEach((w, i) => { if (g[i] !== undefined && g[i] !== w && stripAccents(g[i]) === stripAccents(w)) words.push(w); });
  return words;
}

/**
 * Verifica uma resposta digitada.
 * @param {string} given  resposta do aluno
 * @param {string[]} expected  respostas aceitas (a primeira é a "principal")
 * @param {{vocab?: Set<string>}} opts  vocabulário conhecido (evita aceitar "sono" no lugar de "sonno")
 * @returns {{ok:boolean, warning:null|'acento'|'apostrofo'|'digitacao', words?:string[], best:string}}
 */
export function checkAnswer(given, expected, opts = {}) {
  const best = expected[0];
  const g = normalize(given);
  if (!g) return { ok: false, warning: null, best };
  const gAlts = [g, dropLeadingPronoun(g)];
  const exp = variants(expected);

  // 1. exato
  for (const e of exp) if (gAlts.includes(e)) return { ok: true, warning: null, best, matched: e };
  // 2. só acentos diferentes
  for (const e of exp) for (const ga of gAlts) {
    if (stripAccents(ga) === stripAccents(e)) return { ok: true, warning: 'acento', words: accentHint(ga, e), best, matched: e };
  }
  // 3. só apóstrofo faltando/sobrando (un amica / un'amica)
  const noApo = (s) => stripAccents(s).replace(/'/g, ' ').replace(/\s+/g, ' ').trim();
  for (const e of exp) for (const ga of gAlts) {
    if (noApo(ga) === noApo(e)) return { ok: true, warning: 'apostrofo', best, matched: e };
  }
  // 4. um erro de digitação numa palavra longa, que não vira outra palavra conhecida
  const vocab = opts.vocab || new Set();
  for (const e of exp) for (const ga of gAlts) {
    const gw = stripAccents(ga).split(' ');
    const ew = stripAccents(e).split(' ');
    if (gw.length !== ew.length) continue;
    const diff = [];
    for (let i = 0; i < ew.length; i++) if (gw[i] !== ew[i]) diff.push(i);
    if (diff.length !== 1) continue;
    const i = diff[0];
    if (ew[i].length >= 5 && levenshtein(gw[i], ew[i]) === 1 && !vocab.has(gw[i])) {
      return { ok: true, warning: 'digitacao', words: [e.split(' ')[i]], best, matched: e };
    }
  }
  return { ok: false, warning: null, best };
}

// Para "montar frase": compara a sequência de peças com as respostas aceitas.
export function checkTiles(tiles, expected, opts) {
  return checkAnswer(tiles.join(' '), expected, opts);
}

// Para "falar": aceita se a maioria das palavras foi reconhecida, na ordem.
export function speechScore(heard, expected) {
  const h = stripAccents(normalize(heard)).split(' ').filter(Boolean);
  const e = stripAccents(normalize(expected)).split(' ').filter(Boolean);
  if (!e.length) return 0;
  // maior subsequência comum de palavras
  const dp = Array.from({ length: h.length + 1 }, () => new Array(e.length + 1).fill(0));
  for (let i = 1; i <= h.length; i++) for (let j = 1; j <= e.length; j++)
    dp[i][j] = h[i - 1] === e[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[h.length][e.length] / e.length;
}

// Divide uma frase italiana em peças para o banco de palavras (sem pontuação).
export function tokenize(it) {
  return String(it)
    .replace(/[.,!?¿¡;:"“”«»…–—]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
