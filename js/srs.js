// Repetição espaçada com FSRS (ts-fsrs, empacotado em /vendor, funciona offline).
import { fsrs, generatorParameters, createEmptyCard, Rating, State } from '../vendor/ts-fsrs.mjs';

const scheduler = fsrs(generatorParameters({
  request_retention: 0.9,   // ~90% de chance de lembrar na hora da revisão
  maximum_interval: 365,
  enable_fuzz: true,        // espalha um pouco as datas para não acumular revisões
  enable_short_term: false, // a própria lição já é a prática do dia; revisões em dias
}));

export const GRADES = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy };
export { State };

const toJSON = (card) => ({
  ...card,
  due: new Date(card.due).toISOString(),
  last_review: card.last_review ? new Date(card.last_review).toISOString() : null,
});

export function newCard(now = new Date()) {
  return toJSON(createEmptyCard(now));
}

/** Registra uma revisão. grade: 'again' | 'hard' | 'good' | 'easy' */
export function review(card, grade, now = new Date()) {
  const c = { ...card, last_review: card.last_review || undefined };
  const { card: next } = scheduler.next(c, now, GRADES[grade]);
  return toJSON(next);
}

export function isDue(card, now = new Date()) {
  return card && new Date(card.due).getTime() <= now.getTime();
}

/** Lista ids de cartões vencidos, os mais atrasados primeiro. */
export function dueIds(cards, now = new Date(), limit = Infinity) {
  return Object.entries(cards)
    .filter(([, c]) => isDue(c, now))
    .sort((a, b) => new Date(a[1].due) - new Date(b[1].due))
    .slice(0, limit)
    .map(([id]) => id);
}

export function retrievability(card, now = new Date()) {
  if (!card || card.state === State.New) return 0;
  return scheduler.get_retrievability(card, now, false);
}

/** Resumo para o painel e o relatório. */
export function summary(cards, now = new Date()) {
  const s = { total: 0, due: 0, learning: 0, young: 0, mature: 0 };
  for (const c of Object.values(cards)) {
    s.total++;
    if (isDue(c, now)) s.due++;
    if (c.state === State.Learning || c.state === State.Relearning) s.learning++;
    else if (c.state === State.Review && c.scheduled_days >= 21) s.mature++;
    else s.young++;
  }
  return s;
}
