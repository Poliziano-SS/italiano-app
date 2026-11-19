// Testes de lógica: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, normalize, speechScore, tokenize } from '../js/check.js';
import { newCard, review, isDue, dueIds, summary, State } from '../js/srs.js';
import { computeStreak, weekly, recordActivity, lessonXP, dayKey, addDays, weekStart } from '../js/stats.js';
import { indexCourse, parseSentence } from '../js/course.js';
import { lessonExercises, reviewExercises, errorExercises, rng } from '../js/exercises.js';
import { reportMarkdown, defaultState, validateBackup, migrate, backupJSON } from '../js/store.js';
import curso from '../data/curso-a1.js';

const idx = indexCourse(curso);

// ---------------- correção ----------------
test('normaliza maiúsculas, pontuação e apóstrofos', () => {
  assert.equal(normalize('  Ciao,   Marco! '), 'ciao marco');
  assert.equal(normalize('Un’amica'), "un'amica");
  assert.equal(normalize("L' aula è grande."), "l'aula è grande");
});

test('resposta exata e com pontuação/maiúsculas diferentes', () => {
  assert.equal(checkAnswer('ciao marco', ['Ciao, Marco!']).ok, true);
  assert.equal(checkAnswer('CIAO MARCO!!', ['Ciao, Marco!']).warning, null);
});

test('acento faltando: aceita com aviso e indica a palavra', () => {
  const r = checkAnswer('Lui e stanco', ['Lui è stanco.']);
  assert.equal(r.ok, true);
  assert.equal(r.warning, 'acento');
  assert.deepEqual(r.words, ['è']);
  assert.equal(checkAnswer('Oggi e lunedi', ['Oggi è lunedì.']).warning, 'acento');
});

test('pronome sujeito opcional (io/tu/lui...)', () => {
  assert.equal(checkAnswer('sono stanco', ['Io sono stanco.']).ok, true);
  assert.equal(checkAnswer('io parlo portoghese e inglese', ['Parlo portoghese e inglese.']).ok, true);
});

test('alternativas aceitas', () => {
  assert.equal(checkAnswer("Anch'io mi chiamo Luca", ['Anche io mi chiamo Luca.', "Anch'io mi chiamo Luca."]).ok, true);
  assert.equal(checkAnswer('Ho 25 anni', ['Ho venticinque anni.', 'Ho 25 anni.']).ok, true);
});

test('apóstrofo faltando gera aviso', () => {
  const r = checkAnswer('Giulia è un amica', ["Giulia è un'amica."]);
  assert.equal(r.ok, true);
  assert.equal(r.warning, 'apostrofo');
});

test('erro de digitação em palavra longa é aceito com aviso', () => {
  const r = checkAnswer('La biblioteca apre alle nouve', ['La biblioteca apre alle nove.']);
  assert.equal(r.ok, false, 'palavra curta (nove) não tem tolerância');
  const r2 = checkAnswer('Il supermercatto è chiuso', ['Il supermercato è chiuso.'], { vocab: idx.vocab });
  assert.equal(r2.ok, true);
  assert.equal(r2.warning, 'digitacao');
});

test('não aceita outra palavra real como erro de digitação (sono × sonno)', () => {
  const r = checkAnswer('Lui ha sono', ['Lui ha sonno.'], { vocab: idx.vocab });
  assert.equal(r.ok, false);
});

test('respostas erradas', () => {
  assert.equal(checkAnswer('Io ho stanco', ['Io sono stanco.']).ok, false);
  assert.equal(checkAnswer('', ['Ciao']).ok, false);
  assert.equal(checkAnswer('sono fame', ['Ho fame!']).ok, false);
});

test('fala: pontuação por palavras reconhecidas', () => {
  assert.equal(speechScore('buongiorno signora', 'Buongiorno, signora!'), 1);
  assert.ok(speechScore('buongiorno', 'Buongiorno, signora!') < 0.7);
});

test('tokenize remove pontuação e mantém apóstrofos', () => {
  assert.deepEqual(tokenize("Un bicchiere d'acqua, per favore."), ['Un', 'bicchiere', "d'acqua", 'per', 'favore']);
});

// ---------------- conteúdo ----------------
test('curso: ≥8 unidades, 4–5 lições cada, lacunas válidas', () => {
  assert.ok(curso.unidades.length >= 8);
  const ids = new Set();
  for (const u of curso.unidades) {
    assert.ok(u.licoes.length >= 4 && u.licoes.length <= 5, u.id);
    for (const l of u.licoes) {
      assert.ok(!ids.has(l.id), 'id repetido ' + l.id); ids.add(l.id);
      assert.ok(l.palavras.length >= 4, l.id + ' palavras');
      assert.ok(l.frases.length >= 6, l.id + ' frases');
      assert.ok(l.dica.length > 40, l.id + ' dica');
      for (const [raw, pt] of l.frases) {
        assert.ok(pt && pt.length, raw);
        const { text, gap } = parseSentence(raw);
        assert.ok(!/[{}|]/.test(text), raw);
        if (gap) {
          assert.ok(text.includes(gap.answer), raw);
          assert.ok(!gap.distractors.includes(gap.answer), raw);
        }
      }
    }
  }
});

test('exercícios da lição cobrem os 6 tipos (+falar opcional)', () => {
  for (const l of idx.lessons) {
    const ex = lessonExercises(idx, l, { listen: true, speak: true }, rng(42));
    const types = new Set(ex.map((e) => e.type));
    for (const t of ['escolher', 'montar', 'digitar', 'ouvir', 'pares', 'lacuna', 'falar']) assert.ok(types.has(t), `${l.id} sem ${t}`);
    for (const e of ex) {
      if (e.type === 'escolher' || e.type === 'lacuna') {
        assert.ok(e.options.includes(e.answer));
        assert.equal(new Set(e.options).size, e.options.length, `${l.id} opções repetidas`);
      }
      if (e.type === 'montar') {
        // as peças certas existem no banco
        const bank = e.tiles.map((t) => t.t);
        for (const w of tokenize(e.expected[0])) assert.ok(bank.includes(w), `${l.id}: ${w}`);
      }
    }
  }
  const noAudio = lessonExercises(idx, idx.lessons[0], { listen: false, speak: false }, rng(1));
  assert.ok(!noAudio.some((e) => e.type === 'ouvir' || e.type === 'falar'));
});

// ---------------- FSRS ----------------
test('FSRS: cartão novo + Bom agenda para dias depois; De novo agenda antes', () => {
  const now = new Date('2026-11-19T18:00:00');
  const good = review(newCard(now), 'good', now);
  const again = review(newCard(now), 'again', now);
  assert.equal(good.reps, 1);
  assert.ok(new Date(good.due) > new Date(again.due));
  assert.ok(new Date(good.due) - now >= 24 * 3600e3, 'Bom: pelo menos 1 dia');
  assert.equal(isDue(good, now), false);
  // na data de vencimento fica pendente; acertar de novo aumenta o intervalo
  const later = new Date(good.due);
  assert.equal(isDue(good, later), true);
  const g2 = review(good, 'good', later);
  assert.ok(g2.stability > good.stability);
  assert.ok(new Date(g2.due) - later > new Date(good.due) - now);
  assert.equal(g2.state, State.Review);
});

test('FSRS: errar um cartão maduro reduz a estabilidade e conta lapso', () => {
  let c = newCard(new Date('2026-01-01T10:00:00'));
  let t = new Date('2026-01-01T10:00:00');
  for (let i = 0; i < 4; i++) { c = review(c, 'good', t); t = new Date(c.due); }
  const lapse = review(c, 'again', t);
  assert.equal(lapse.lapses, 1);
  assert.ok(lapse.stability < c.stability);
  // cartão sobrevive a JSON (localStorage)
  const back = JSON.parse(JSON.stringify(lapse));
  assert.doesNotThrow(() => review(back, 'good', new Date(back.due)));
});

test('FSRS: dueIds ordena os mais atrasados e respeita limite', () => {
  const now = new Date('2026-11-19T12:00:00');
  const cards = {
    a: { ...newCard(now), due: '2026-11-10T00:00:00.000Z' },
    b: { ...newCard(now), due: '2026-11-18T00:00:00.000Z' },
    c: { ...newCard(now), due: '2026-12-30T00:00:00.000Z' },
  };
  assert.deepEqual(dueIds(cards, now), ['a', 'b']);
  assert.deepEqual(dueIds(cards, now, 1), ['a']);
  assert.equal(summary(cards, now).due, 2);
  const ex = reviewExercises(idx, [...idx.items.keys()].slice(0, 10), {}, {}, rng(3));
  assert.equal(ex.length, 10);
  assert.equal(errorExercises(idx, [...idx.items.keys()].slice(0, 6), {}, rng(3)).length, 6);
});

// ---------------- ofensiva / semana ----------------
const act = (keys) => Object.fromEntries(keys.map((k) => [k, { xp: 20, sessions: 1, exercises: 10, correct: 9, seconds: 300 }]));

test('ofensiva: dias seguidos até hoje', () => {
  const s = computeStreak(act(['2026-11-17', '2026-11-18', '2026-11-19']), '2026-11-19');
  assert.deepEqual(s, { current: 3, best: 3, doneToday: true });
});

test('ofensiva: hoje ainda sem lição mantém a de ontem', () => {
  const s = computeStreak(act(['2026-11-17', '2026-11-18']), '2026-11-19');
  assert.equal(s.current, 2);
  assert.equal(s.doneToday, false);
});

test('ofensiva: um dia sem estudo zera; melhor ofensiva fica guardada', () => {
  const s = computeStreak(act(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-17']), '2026-11-19');
  assert.equal(s.current, 0);
  assert.equal(s.best, 4);
});

test('ofensiva: virada de mês e de horário de verão', () => {
  const s = computeStreak(act(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']), '2026-11-02');
  assert.equal(s.current, 4);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('dia só com exercícios avulsos (sem sessão concluída) não conta', () => {
  const days = { '2026-11-19': { xp: 0, sessions: 0, exercises: 3 } };
  assert.equal(computeStreak(days, '2026-11-19').current, 0);
});

test('semana: compara com a semana anterior até o mesmo dia', () => {
  let days = {};
  days = recordActivity(days, { xp: 30, session: true }, new Date('2026-11-10T10:00:00')); // terça passada
  days = recordActivity(days, { xp: 50, session: true }, new Date('2026-11-14T10:00:00')); // sábado passado
  days = recordActivity(days, { xp: 40, session: true }, new Date('2026-11-17T10:00:00')); // terça
  days = recordActivity(days, { xp: 5 }, new Date('2026-11-17T11:00:00'));
  const w = weekly(days, '2026-11-19'); // quinta
  assert.equal(weekStart('2026-11-19'), '2026-11-16');
  assert.equal(w.thisTotal, 45);
  assert.equal(w.lastTotal, 80);
  assert.equal(w.lastSoFar, 30);
  assert.equal(w.todayIdx, 3);
  assert.equal(days['2026-11-17'].sessions, 1);
});

test('XP da lição', () => {
  assert.equal(lessonXP({ correctFirst: 12, total: 12, mistakes: 0 }), 25);
  assert.equal(lessonXP({ correctFirst: 8, total: 12, mistakes: 4 }), 18);
});

// ---------------- backup e relatório ----------------
test('backup: valida, exporta e reimporta', () => {
  const s = defaultState();
  s.days[dayKey()] = { xp: 10, sessions: 1, exercises: 5, correct: 4, seconds: 120 };
  const back = JSON.parse(backupJSON(s));
  assert.equal(validateBackup(back), null);
  assert.ok(validateBackup({ foo: 1 }));
  const m = migrate(back);
  assert.equal(m.settings.dailyGoal, 30);
  assert.equal(m.days[dayKey()].xp, 10);
});

test('relatório para o Poliziano inclui erros e lições', () => {
  const s = defaultState();
  const l = idx.lessons[0];
  s.lessons[l.id] = { completed: 1, bestAccuracy: 90, lastAt: new Date().toISOString() };
  const id = l.itemIds.find((x) => x.startsWith('f:'));
  s.errors[id] = { itemId: id, type: 'digitar', prompt: 'Bom dia, senhora!', expected: 'Buongiorno, signora!', given: 'Buongiorno signore', count: 2, lastAt: new Date().toISOString(), resolved: false };
  s.days[dayKey()] = { xp: 25, sessions: 1, exercises: 12, correct: 10, seconds: 400 };
  const md = reportMarkdown(s, idx);
  assert.match(md, /Relatório de italiano/);
  assert.match(md, /Ciao e buongiorno/);
  assert.match(md, /Buongiorno signore/);
  assert.match(md, /Erros para trabalhar \(1 em aberto\)/);
});
