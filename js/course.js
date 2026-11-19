// Indexa o conteúdo do curso: transforma palavras e frases em "itens" com id estável.
import { normalize } from './check.js';

export function itemId(kind, it) {
  return (kind === 'w' ? 'w:' : 'f:') + normalize(it.replace(/\{([^}|]*)[^}]*\}/g, '$1'));
}

// "{certa|errada}" -> { text, gap: {start, end, answer, distractors} }
export function parseSentence(raw) {
  const m = raw.match(/\{([^}]*)\}/);
  if (!m) return { text: raw, gap: null };
  const parts = m[1].split('|');
  const answer = parts[0];
  const before = raw.slice(0, m.index).replace(/\{([^}|]*)[^}]*\}/g, '$1');
  const after = raw.slice(m.index + m[0].length).replace(/\{([^}|]*)[^}]*\}/g, '$1');
  return {
    text: before + answer + after,
    gap: { before, after, answer: answer.trim(), distractors: parts.slice(1).map((s) => s.trim()).filter(Boolean) },
  };
}

export function indexCourse(course) {
  const items = new Map();
  const lessons = [];
  const lessonById = new Map();
  const vocab = new Set();
  course.unidades.forEach((u, ui) => {
    u.licoes.forEach((l, li) => {
      const lesson = { ...l, unitId: u.id, unitTitle: u.titulo, unitIndex: ui, index: li, order: lessons.length, itemIds: [] };
      for (const [it, pt, extra] of l.palavras) {
        const id = itemId('w', it);
        if (!items.has(id)) items.set(id, { id, kind: 'w', it, pt, alt: extra?.alt || [], nota: extra?.nota || '', lessonId: l.id });
        lesson.itemIds.push(id);
        it.toLowerCase().split(/\s+/).forEach((t) => vocab.add(normalize(t)));
      }
      for (const [raw, pt, extra] of l.frases) {
        const { text, gap } = parseSentence(raw);
        const id = itemId('f', text);
        if (!items.has(id)) items.set(id, { id, kind: 'f', it: text, pt, gap, alt: extra?.alt || [], nota: extra?.nota || '', lessonId: l.id });
        lesson.itemIds.push(id);
        normalize(text).split(' ').forEach((t) => vocab.add(t));
      }
      lessons.push(lesson);
      lessonById.set(l.id, lesson);
    });
  });
  return { course, items, lessons, lessonById, vocab };
}
