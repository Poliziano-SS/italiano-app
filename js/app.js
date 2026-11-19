// Interface do app (sem framework, sem servidor). Tudo roda no aparelho.
import curso from '../data/curso-a1.js';
import { indexCourse } from './course.js';
import { checkAnswer, checkTiles, speechScore, normalize } from './check.js';
import { lessonExercises, reviewExercises, errorExercises, TYPES, shuffle } from './exercises.js';
import { newCard, review, isDue, dueIds, summary } from './srs.js';
import { dayKey, computeStreak, weekly, recordActivity, lessonXP, totalXP, addDays, parseDay } from './stats.js';
import { load, save, backupJSON, validateBackup, migrate, reportMarkdown } from './store.js';
import { initTTS, speak, ttsSupported, sttSupported, italianVoices, currentVoice, setVoice, listenOnce } from './speech.js';

const APP_VERSION = '1.0.0';
const idx = indexCourse(curso);
let state = load();
let tab = 'trilha';
let session = null;
let sheet = null;
let skipAudioUntil = 0;
let skipSpeakUntil = 0;
const $app = document.getElementById('app');
const UNIT_COLORS = ['#58cc02', '#ce82ff', '#1cb0f6', '#ff9600', '#ff4b4b', '#2bc4a8', '#ff86d0', '#7a7aff', '#cc9b00'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const persist = () => { try { save(state); } catch (e) { toast('Não consegui salvar: armazenamento cheio ou bloqueado.'); } };
const today = () => dayKey(new Date());

function toast(msg, ms = 2600) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ---------- sons simples (WebAudio, sem arquivos) ----------
let actx;
function beep(ok) {
  if (!state.settings.sounds) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = ok ? [660, 880] : [220, 180];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(); const g = actx.createGain();
      o.frequency.value = f; o.type = ok ? 'sine' : 'triangle';
      g.gain.setValueAtTime(0.0001, actx.currentTime + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.15, actx.currentTime + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + i * 0.09 + 0.18);
      o.connect(g).connect(actx.destination); o.start(actx.currentTime + i * 0.09); o.stop(actx.currentTime + i * 0.09 + 0.2);
    });
  } catch {}
}

const say = (text, slow = false) => speak(text, { slow, rate: state.settings.rate });
const canListen = () => state.settings.listen && ttsSupported() && Date.now() > skipAudioUntil;
const canSpeak = () => state.settings.speak && sttSupported() && Date.now() > skipSpeakUntil;

// ---------- desbloqueio da trilha ----------
function lessonStatus(lesson) {
  const done = !!state.lessons[lesson.id]?.completed;
  if (done) return 'done';
  if (state.settings.unlockAll || lesson.order === 0) return 'open';
  const prev = idx.lessons[lesson.order - 1];
  return state.lessons[prev.id]?.completed ? 'open' : 'locked';
}
const currentLesson = () => idx.lessons.find((l) => lessonStatus(l) === 'open') || null;

// ---------- topo ----------
function topbar() {
  const st = computeStreak(state.days, today());
  const xp = state.days[today()]?.xp || 0;
  return `<header class="topbar">
    <div class="flag"><span class="flagbar"><i></i><i></i><i></i></span> A1</div>
    <div class="pill fogo ${st.doneToday ? '' : 'off'}" title="Ofensiva">🔥 ${st.current}</div>
    <div class="pill xp" title="XP de hoje">⚡ ${xp}/${state.settings.dailyGoal}</div>
  </header>`;
}

function nav() {
  const b = (id, ic, label) => `<button class="${tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}"><span class="ic">${ic}</span>${label}</button>`;
  return `<nav class="bottom"><div class="wrap">${b('trilha', '🏠', 'Trilha')}${b('praticar', '🏋️', 'Praticar')}${b('progresso', '📈', 'Progresso')}${b('ajustes', '⚙️', 'Ajustes')}</div></nav>`;
}

function goalCard() {
  const xp = state.days[today()]?.xp || 0;
  const goal = state.settings.dailyGoal;
  const p = Math.min(100, Math.round((100 * xp) / goal));
  const due = dueIds(state.cards).length;
  const errs = openErrors().length;
  return `<div class="card goal">
    <div class="ring" style="--p:${p}"><span>${p}%</span></div>
    <div style="flex:1">
      <h3>${xp >= goal ? 'Meta de hoje cumprida! 🎉' : 'Meta de hoje'}</h3>
      <div class="muted small">${xp} de ${goal} XP · ${due} revisão(ões) · ${errs} erro(s) para rever</div>
      ${due ? `<button class="btn azul" style="margin-top:10px;min-height:40px;padding:8px 14px" data-act="start-review">Revisar agora</button>` : ''}
    </div>
  </div>`;
}

function iosHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!ios || standalone || state.settings.hideIosHint) return '';
  return `<div class="notice">📲 <b>No iPhone:</b> toque em <b>Compartilhar → Adicionar à Tela de Início</b>. Assim o app abre offline e o Safari não apaga seus dados. <button class="btn fantasma" style="min-height:0;padding:4px" data-act="hide-ios">OK</button></div>`;
}

// ---------- abas ----------
function viewTrilha() {
  const cur = currentLesson();
  let html = iosHint() + goalCard();
  for (const [ui, u] of curso.unidades.entries()) {
    const color = UNIT_COLORS[ui % UNIT_COLORS.length];
    const lessons = idx.lessons.filter((l) => l.unitId === u.id);
    const done = lessons.filter((l) => state.lessons[l.id]?.completed).length;
    html += `<div class="unit" style="background:${color}">
      <div class="em">${u.icone}</div>
      <div><h3>Unidade ${ui + 1} · ${esc(u.titulo)}</h3><p>${esc(u.subtitulo)} · ${done}/${lessons.length}</p></div>
      <button class="guide" data-act="guide" data-unit="${u.id}">📖 Dicas</button>
    </div><div class="path">`;
    lessons.forEach((l, i) => {
      const s = lessonStatus(l);
      const off = [0, 40, 60, 40, 0, -40, -60, -40][i % 8];
      const icon = s === 'done' ? '✓' : s === 'locked' ? '🔒' : cur && cur.id === l.id ? '★' : '▶';
      html += `<button class="node ${s} ${cur && cur.id === l.id ? 'current' : ''}" style="transform:translateX(${off}px);--cor:${color}" data-act="lesson" data-id="${l.id}">
        <span class="c">${icon}</span><span class="lbl">${esc(l.titulo)}</span></button>`;
    });
    html += `</div>`;
  }
  html += `<p class="muted small" style="text-align:center;margin-top:24px">Mais unidades (A2 → B2) podem ser adicionadas em <code>data/</code>.</p>`;
  return html;
}

function openErrors() { return Object.values(state.errors).filter((e) => !e.resolved); }

function explainItem(item) {
  const lesson = idx.lessonById.get(item?.lessonId);
  return `${item?.nota ? `<div style="margin-bottom:6px">💡 ${esc(item.nota)}</div>` : ''}${lesson ? `<div><b>${esc(lesson.titulo)}:</b> ${lesson.dica}</div>` : ''}`;
}

function viewPraticar() {
  const due = dueIds(state.cards);
  const errs = openErrors().sort((a, b) => b.count - a.count);
  const learned = Object.keys(state.cards).length;
  const next = Object.values(state.cards).map((c) => new Date(c.due)).sort((a, b) => a - b)[0];
  let html = `<h1>Praticar</h1>
  <div class="card"><h3>🧠 Revisão diária (FSRS)</h3>
    <p class="muted small">${due.length ? `${due.length} cartão(ões) para revisar agora. A revisão espaçada traz cada palavra de volta pouco antes de você esquecer.` : learned ? `Tudo em dia! Próxima revisão: ${next ? next.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }) : '—'}.` : 'Conclua a primeira lição para começar a revisar.'}</p>
    <button class="btn full azul" data-act="start-review" ${due.length ? '' : 'disabled'}>Revisar ${due.length ? `(${Math.min(due.length, 20)})` : ''}</button></div>
  <div class="card"><h3>🎯 Revisar meus erros</h3>
    <p class="muted small">${errs.length ? `${errs.length} erro(s) em aberto. Acertou na revisão, sai da lista.` : 'Nenhum erro em aberto. 🎉'}</p>
    <button class="btn full vermelho" data-act="start-errors" ${errs.length ? '' : 'disabled'}>Revisar erros</button></div>
  <div class="card"><h3>🔀 Treino livre</h3>
    <p class="muted small">Mistura aleatória do que você já viu. Não altera o agendamento das revisões.</p>
    <button class="btn full branco" data-act="start-free" ${learned >= 4 ? '' : 'disabled'}>Treinar</button></div>`;
  if (errs.length) {
    html += `<h2>Erros mais frequentes</h2><div class="card errlist">`;
    for (const e of errs.slice(0, 12)) {
      const item = idx.items.get(e.itemId);
      html += `<div class="e"><div class="small muted">${esc(TYPES[e.type] || e.type)} · ${e.count}x</div>
        <div>${esc(e.prompt)}</div>
        <div class="small">${e.given ? `<span class="no">${esc(e.given)}</span> → ` : ''}<span class="ok">${esc(e.expected)}</span></div>
        <details class="small"><summary>Por quê?</summary><div class="fb-why" style="background:#f1faff;margin-top:6px">${explainItem(item)}</div></details></div>`;
    }
    html += `</div>`;
  }
  return html;
}

function viewProgresso() {
  const t = today();
  const st = computeStreak(state.days, t);
  const wk = weekly(state.days, t);
  const srs = summary(state.cards);
  const lessonsDone = idx.lessons.filter((l) => state.lessons[l.id]?.completed).length;
  const words = Object.keys(state.cards).filter((k) => k.startsWith('w:')).length;
  const allEx = Object.values(state.days).reduce((a, d) => a + (d.exercises || 0), 0);
  const allOk = Object.values(state.days).reduce((a, d) => a + (d.correct || 0), 0);
  const max = Math.max(10, ...wk.thisWeek.map((d) => d.xp), ...wk.lastWeek.map((d) => d.xp));
  const diff = wk.thisTotal - wk.lastSoFar;
  const names = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
  let html = `<h1>Progresso</h1>
  <div class="tiles">
    <div class="tilestat"><span class="e">🔥</span><div><b>${st.current}</b><span>dias de ofensiva</span></div></div>
    <div class="tilestat"><span class="e">🏅</span><div><b>${st.best}</b><span>melhor ofensiva</span></div></div>
    <div class="tilestat"><span class="e">⚡</span><div><b>${totalXP(state.days)}</b><span>XP total</span></div></div>
    <div class="tilestat"><span class="e">📘</span><div><b>${lessonsDone}/${idx.lessons.length}</b><span>lições</span></div></div>
    <div class="tilestat"><span class="e">🗂️</span><div><b>${words}</b><span>palavras · ${srs.total - words} frases</span></div></div>
    <div class="tilestat"><span class="e">🎯</span><div><b>${allEx ? Math.round((100 * allOk) / allEx) : 0}%</b><span>de acertos</span></div></div>
  </div>
  <h2>Você × semana passada</h2>
  <div class="card">
    <div class="row"><div><b style="font-size:22px">${wk.thisTotal} XP</b><div class="muted small">nesta semana</div></div><div class="spacer"></div>
    <div style="text-align:right"><b style="font-size:16px;color:${diff >= 0 ? 'var(--verde-esc)' : 'var(--vermelho-esc)'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)} XP</b><div class="muted small">vs. mesmo ponto da semana passada (${wk.lastSoFar})</div></div></div>
    <div class="chart">${wk.thisWeek.map((d, i) => `<div class="day"><div class="b prev" style="height:${(100 * wk.lastWeek[i].xp) / max}%"></div>${i > wk.todayIdx ? '' : `<div class="b now" style="height:${(100 * d.xp) / max}%"></div>`}</div>`).join('')}</div>
    <div class="chart-l">${names.map((n, i) => `<span class="${i === wk.todayIdx ? 't' : ''}">${n}</span>`).join('')}</div>
    <div class="legend"><span><i style="background:var(--verde)"></i>Esta semana</span><span><i style="background:var(--cinza-esc);opacity:.55"></i>Semana passada (${wk.lastTotal} XP)</span></div>
  </div>
  <h2>Últimos 28 dias</h2><div class="card"><div class="heat">`;
  const start = addDays(t, -27);
  for (let i = 0; i < 28; i++) {
    const k = addDays(start, i); const xp = state.days[k]?.xp || 0;
    const lvl = xp === 0 ? '' : xp < state.settings.dailyGoal / 2 ? 'l1' : xp < state.settings.dailyGoal ? 'l2' : 'l3';
    html += `<i class="${lvl} ${k === t ? 'today' : ''}" title="${k}: ${xp} XP">${parseDay(k).getDate()}</i>`;
  }
  html += `</div><div class="legend"><span><i style="background:#ffd9a8"></i>pouco</span><span><i style="background:#ffb24d"></i>quase a meta</span><span><i style="background:var(--laranja)"></i>meta cumprida</span></div></div>
  <h2>Relatório para o Poliziano</h2>
  <div class="card"><p class="muted small" style="margin-top:0">Resumo com ofensiva, XP, lições, acertos por tipo de exercício e a lista de erros em aberto.</p>
    <div class="row wrap"><button class="btn azul" data-act="report-dl">⬇️ Baixar (.md)</button>
    ${navigator.share ? '<button class="btn branco" data-act="report-share">Compartilhar</button>' : ''}
    <button class="btn branco" data-act="report-copy">Copiar</button></div></div>`;
  return html;
}

function viewAjustes() {
  const s = state.settings;
  const voices = italianVoices();
  const v = currentVoice();
  const sw = (key, title, sub, disabled = false) => `<label class="setting"><div class="t"><b>${title}</b><span>${sub}</span></div>
    <span class="switch"><input type="checkbox" data-set="${key}" ${s[key] && !disabled ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span></span></span></label>`;
  return `<h1>Ajustes</h1>
  <div class="card"><h3>Meta diária</h3><p class="muted small" style="margin-top:0">Uma lição vale ~20–25 XP. A ofensiva conta com qualquer lição ou revisão concluída no dia.</p>
    <div class="row wrap">${[10, 20, 30, 50, 80, 120].map((g) => `<button class="chip ${s.dailyGoal === g ? 'on' : ''}" data-act="goal" data-goal="${g}">${g} XP</button>`).join('')}</div></div>
  <div class="card"><h3>Áudio</h3>
    ${ttsSupported() ? `${voices.length ? `<select data-act="voice">${voices.map((x) => `<option value="${esc(x.voiceURI)}" ${v && v.voiceURI === x.voiceURI ? 'selected' : ''}>${esc(x.name)} (${esc(x.lang)})</option>`).join('')}</select>`
      : `<div class="notice">Nenhuma voz italiana encontrada neste aparelho. Instale a voz "Italiano" nas configurações de texto para fala do sistema (Android: Configurações → Acessibilidade → Texto para fala; iPhone: Ajustes → Acessibilidade → Conteúdo Falado → Vozes).</div>`}
      <div class="setting"><div class="t"><b>Velocidade</b><span>${Math.round(s.rate * 100)}%</span></div><input type="range" min="0.6" max="1.3" step="0.05" value="${s.rate}" data-act="rate" style="max-width:160px"></div>
      <button class="btn branco" data-act="test-voice">🔊 Testar: "Buongiorno, come stai?"</button>`
      : '<div class="notice">Este navegador não tem síntese de voz. Os exercícios de ouvir ficam desligados.</div>'}
    ${sw('listen', 'Exercícios de ouvir', 'Ouvir e digitar o que escutou', !ttsSupported())}
    ${sw('autoplay', 'Tocar áudio automaticamente', 'Ao mostrar uma frase em italiano')}
    ${sw('speak', 'Exercícios de falar', sttSupported() ? 'Usa o reconhecimento de voz do navegador (precisa de internet)' : 'Não disponível neste navegador', !sttSupported())}
    ${sw('sounds', 'Sons de acerto e erro', 'Bipes curtos')}
  </div>
  <div class="card"><h3>Trilha</h3>${sw('unlockAll', 'Desbloquear todas as lições', 'Para seguir a ordem das aulas com o Poliziano')}</div>
  <div class="card"><h3>Backup</h3><p class="muted small" style="margin-top:0">Seus dados ficam só neste aparelho. Exporte um backup de vez em quando (e antes de trocar de celular).</p>
    <div class="row wrap"><button class="btn azul" data-act="backup">⬇️ Exportar backup</button>
    <label class="btn branco">⬆️ Importar<input type="file" accept="application/json,.json" data-act="import" hidden></label></div>
    <p class="small muted">Último backup: ${s.lastBackup ? new Date(s.lastBackup).toLocaleString('pt-BR') : 'nunca'}</p>
    <button class="btn fantasma" style="color:var(--vermelho)" data-act="wipe">Apagar todos os dados</button></div>
  <p class="muted small" style="text-align:center">App de italiano v${APP_VERSION} · ${idx.lessons.length} lições · ${idx.items.size} itens<br>Sem servidor, sem conta, sem IA. Funciona offline.</p>`;
}

// ---------- folhas ----------
function sheetLesson(id) {
  const l = idx.lessonById.get(id);
  const s = lessonStatus(l);
  const p = state.lessons[id];
  const words = l.palavras.map(([it, pt]) => `<span class="it">${esc(it)}</span><span>${esc(pt)}</span>`).join('');
  return `<div class="tag">Unidade ${l.unitIndex + 1} · Lição ${l.index + 1}</div>
    <h2 style="margin-top:4px">${esc(l.titulo)}</h2>
    ${p ? `<p class="muted small">Concluída ${p.completed}x · melhor precisão ${p.bestAccuracy}%</p>` : ''}
    <div class="dica">${l.dica}</div>
    <details style="margin:12px 0"><summary><b>Palavras da lição</b></summary><div class="wordlist">${words}</div></details>
    ${s === 'locked' ? '<p class="muted">🔒 Conclua a lição anterior para desbloquear (ou ative "Desbloquear todas" nos Ajustes).</p>'
      : `<button class="btn full" data-act="start-lesson" data-id="${id}">${s === 'done' ? 'Praticar de novo (+XP)' : 'Começar'}</button>`}`;
}

function sheetGuide(unitId) {
  const u = curso.unidades.find((x) => x.id === unitId);
  return `<h2 style="margin-top:0">${u.icone} ${esc(u.titulo)} — dicas</h2>` + u.licoes.map((l) => `<h3 style="margin-top:14px">${esc(l.titulo)}</h3><div class="dica">${l.dica}</div>`).join('');
}

// ---------- sessão de exercícios ----------
function startSession(kind, exercises, extra = {}) {
  if (!exercises.length) return toast('Nada para praticar agora.');
  session = { kind, queue: exercises, pos: 0, total: exercises.length, grades: {}, correctFirst: 0, mistakes: 0, done: 0, ok: 0,
    started: Date.now(), answer: null, feedback: null, retried: new Set(), ...extra };
  sheet = null;
  render();
  autoPlay();
}

const exOpts = () => ({ listen: canListen(), speak: canSpeak() });

function startLesson(id) {
  const l = idx.lessonById.get(id);
  startSession('lesson', lessonExercises(idx, l, exOpts()), { lessonId: id });
}
function startReview() {
  const ids = dueIds(state.cards, new Date(), 20);
  startSession('review', reviewExercises(idx, ids, state.cards, exOpts()));
}
function startErrors() {
  const ids = openErrors().sort((a, b) => b.count - a.count).slice(0, 15).map((e) => e.itemId);
  startSession('erros', errorExercises(idx, ids, exOpts()));
}
function startFree() {
  const ids = shuffle(Object.keys(state.cards)).slice(0, 12);
  const cards = Object.fromEntries(ids.map((id) => [id, { reps: 3 }]));
  startSession('treino', reviewExercises(idx, ids, cards, exOpts()));
}

const cur = () => session.queue[session.pos];

function autoPlay() {
  const ex = session && cur();
  if (!ex || !state.settings.autoplay) return;
  if (ex.type === 'ouvir' || (ex.type === 'escolher' && ex.audio) || ex.type === 'falar') say(ex.audio);
}

const speakerBtns = (text) => `<button class="spk" data-act="say" data-text="${esc(text)}" aria-label="Ouvir">🔊</button>`;

function renderExercise(ex) {
  const a = session.answer;
  const fb = session.feedback;
  switch (ex.type) {
    case 'escolher': {
      const title = ex.dir === 'it-pt' ? 'O que significa?' : 'Como se diz em italiano?';
      return `<div class="tag">✨ ${TYPES.escolher}</div><div class="s-title">${title}</div>
        <div class="prompt">${ex.audio ? speakerBtns(ex.audio) : ''}<div class="bubble">${esc(ex.prompt)}</div></div>
        <div class="options">${ex.options.map((o, i) => {
          let cls = a === o ? 'sel' : '';
          if (fb) cls = o === ex.answer ? 'ok' : a === o ? 'bad' : '';
          return `<button class="opt ${cls}" data-act="pick" data-val="${esc(o)}" ${fb ? 'disabled' : ''}><b style="color:var(--cinza-esc);margin-right:8px">${i + 1}</b>${esc(o)}</button>`;
        }).join('')}</div>`;
    }
    case 'montar': {
      const chosen = a || [];
      return `<div class="tag">🧱 ${TYPES.montar}</div><div class="s-title">Escreva em italiano</div>
        <div class="bubble">${esc(ex.prompt)}</div>
        <div class="line">${chosen.map((id) => `<button class="tile" data-act="untile" data-id="${id}" ${fb ? 'disabled' : ''}>${esc(ex.tiles[id].t)}</button>`).join('')}</div>
        <div class="line"></div>
        <div class="bank">${ex.tiles.map((t) => `<button class="tile ${chosen.includes(t.id) ? 'used' : ''}" data-act="tile" data-id="${t.id}" ${fb ? 'disabled' : ''}>${esc(t.t)}</button>`).join('')}</div>`;
    }
    case 'digitar':
    case 'ouvir': {
      const head = ex.type === 'digitar'
        ? `<div class="tag">⌨️ ${TYPES.digitar}</div><div class="s-title">Escreva em italiano</div><div class="bubble">${esc(ex.prompt)}</div>`
        : `<div class="tag">🎧 ${TYPES.ouvir}</div><div class="s-title">Digite o que você ouvir</div>
           <div class="row" style="justify-content:center;gap:16px"><button class="spk big" data-act="say" data-text="${esc(ex.audio)}">🔊</button>
           <button class="spk slow big" style="width:80px;height:70px;font-size:30px" data-act="say-slow" data-text="${esc(ex.audio)}" aria-label="Devagar">🐢</button></div>`;
      return `${head}<textarea class="answer" lang="it" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false"
        placeholder="Digite em italiano" data-act="type" ${fb ? 'disabled' : ''}>${esc(a || '')}</textarea>
        <div class="accents">${['à', 'è', 'é', 'ì', 'ò', 'ù', "'"].map((c) => `<button data-act="accent" data-c="${c}" ${fb ? 'disabled' : ''}>${c}</button>`).join('')}</div>`;
    }
    case 'pares': {
      const m = session.match || (session.match = { done: [], selL: null, selR: null, wrong: null });
      const btn = (side, p) => {
        const done = m.done.includes(p.itemId);
        const sel = (side === 'L' ? m.selL : m.selR) === p.itemId;
        const bad = m.wrong && m.wrong[side] === p.itemId;
        return `<button class="opt ${done ? 'done' : ''} ${sel ? 'sel' : ''} ${bad ? 'bad' : ''}" data-act="pair" data-side="${side}" data-id="${esc(p.itemId)}">${esc(side === 'L' ? p.it : p.pt)}</button>`;
      };
      return `<div class="tag">🔗 ${TYPES.pares}</div><div class="s-title">Toque nos pares</div>
        <div class="pairs"><div class="col">${ex.left.map((p) => btn('L', p)).join('')}</div><div class="col">${ex.right.map((p) => btn('R', p)).join('')}</div></div>`;
    }
    case 'lacuna': {
      const gapCls = fb ? (fb.ok ? 'ok' : 'bad') : '';
      return `<div class="tag">🧩 ${TYPES.lacuna}</div><div class="s-title">Complete a frase</div>
        <div class="row">${speakerBtns(ex.full)}<div class="cloze">${esc(ex.before)}<span class="gap ${gapCls}">${esc(a || '\u00a0')}</span>${esc(ex.after)}</div></div>
        <div class="muted">${esc(ex.pt)}</div>
        <div class="options">${ex.options.map((o) => `<button class="opt ${a === o ? 'sel' : ''} ${fb && o === ex.answer ? 'ok' : ''}" data-act="pick" data-val="${esc(o)}" ${fb ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>`;
    }
    case 'falar': {
      return `<div class="tag">🎙️ ${TYPES.falar}</div><div class="s-title">Leia em voz alta</div>
        <div class="prompt">${speakerBtns(ex.audio)}<div class="bubble">${esc(ex.prompt)}<div class="muted small">${esc(ex.pt)}</div></div></div>
        <button class="mic ${session.recording ? 'rec' : ''}" data-act="mic" ${fb ? 'disabled' : ''}>${session.recording ? '🎙️ Ouvindo… fale agora' : '🎙️ Toque e fale'}</button>
        ${a ? `<div class="muted small">Ouvi: “${esc(a)}”</div>` : ''}`;
    }
  }
  return '';
}

function hasAnswer(ex) {
  const a = session.answer;
  if (ex.type === 'montar') return a && a.length > 0;
  if (ex.type === 'pares') return false;
  if (ex.type === 'falar') return false;
  return a && String(a).trim().length > 0;
}

function feedbackHTML(ex) {
  const fb = session.feedback;
  const item = idx.items.get(ex.itemId);
  if (fb.ok) {
    const praise = ['Muito bem!', 'Ótimo!', 'Perfeito!', 'Bravo!', 'Isso aí!', 'Esatto!'];
    let note = '';
    if (fb.warning === 'acento') note = `Atenção ao acento: <b>${esc((fb.words || []).join(', ') || fb.best)}</b>. Resposta: ${esc(fb.best)}`;
    if (fb.warning === 'apostrofo') note = `Atenção ao apóstrofo: ${esc(fb.best)}`;
    if (fb.warning === 'digitacao') note = `Erro de digitação em <b>${esc((fb.words || []).join(', '))}</b>. Resposta: ${esc(fb.best)}`;
    if (!note && (ex.type === 'digitar' || ex.type === 'montar') && fb.matched && normalize(fb.best) !== fb.matched) note = `Também se diz: ${esc(fb.best)}`;
    return `<div class="fb-title">✅ ${fb.warning ? 'Quase perfeito!' : praise[Math.floor(Math.random() * praise.length)]}</div>
      ${note ? `<div class="fb-text">${note}</div>` : ''}
      ${ex.type !== 'pares' && item?.it ? `<div class="fb-text small">${esc(item.it)} — ${esc(item.pt)}</div>` : ''}
      <button class="btn full" data-act="next">Continuar</button>`;
  }
  return `<div class="fb-title">❌ Resposta correta:</div><div class="fb-text"><b>${esc(fb.best)}</b>${item && fb.best !== item.pt && ex.type !== 'escolher' ? `<br><span class="small">${esc(item.pt)}</span>` : ''}</div>
    ${fb.heard ? `<div class="fb-text small">Ouvi: “${esc(fb.heard)}”</div>` : ''}
    <details class="fb-why"><summary><b>Por quê?</b></summary><div style="margin-top:6px">${explainItem(item)}</div></details>
    <button class="btn full vermelho" data-act="next">Entendi</button>`;
}

function renderSession() {
  if (session.finished) return renderDone();
  const ex = cur();
  const pct = Math.round((100 * session.done) / (session.total + session.retried.size));
  const fb = session.feedback;
  const canSkip = ex.type === 'ouvir' ? 'Não posso ouvir agora' : ex.type === 'falar' ? 'Não posso falar agora' : '';
  return `<div class="session">
    <div class="s-top"><button class="x" data-act="quit" aria-label="Sair">✕</button><div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="s-body">${renderExercise(ex)}</div>
    <div class="s-foot ${fb ? (fb.ok ? 'ok' : 'bad') : ''}">
      ${fb ? feedbackHTML(ex) : ex.type === 'pares' ? '<button class="btn full" disabled>Verificar</button>'
        : ex.type === 'falar' ? `<button class="btn full branco" data-act="skip-one">Pular</button>`
        : `<button class="btn full" data-act="check" ${hasAnswer(ex) ? '' : 'disabled'}>Verificar</button>`}
      ${!fb && canSkip ? `<button class="skip" data-act="skip-mode">${canSkip}</button>` : ''}
    </div></div>`;
}

function renderDone() {
  const s = session;
  const secs = Math.round((s.endedAt - s.started) / 1000);
  const acc = s.done ? Math.round((100 * s.correctFirst) / s.total) : 0;
  const titles = { lesson: 'Lição concluída!', review: 'Revisão concluída!', erros: 'Erros revisados!', treino: 'Treino concluído!' };
  const st = computeStreak(state.days, today());
  return `<div class="session"><div class="done">
    <div class="big">${acc === 100 ? '🏆' : '🎉'}</div>
    <h1 style="color:var(--amarelo);text-shadow:0 2px 0 #c79c00">${titles[s.kind]}</h1>
    <div class="stats3">
      <div class="stat" style="--c:var(--amarelo)"><div class="h">XP</div><div class="v">⚡ ${s.xp}</div></div>
      <div class="stat" style="--c:var(--verde)"><div class="h">Precisão</div><div class="v">🎯 ${acc}%</div></div>
      <div class="stat" style="--c:var(--azul)"><div class="h">Tempo</div><div class="v">⏱️ ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</div></div>
    </div>
    <div class="card" style="text-align:left"><b>🔥 Ofensiva: ${st.current} dia(s)</b>${s.streakUp ? ' — mais um dia!' : ''}<div class="muted small">Hoje: ${state.days[today()]?.xp || 0} de ${state.settings.dailyGoal} XP</div></div>
    ${s.newErrors ? `<p class="muted small">${s.newErrors} item(ns) foram para a lista de erros. Revise na aba Praticar.</p>` : ''}
  </div><div class="s-foot"><button class="btn full" data-act="close-session">Continuar</button></div></div>`;
}

function gradeOf(prev, g) {
  const order = { good: 0, hard: 1, again: 2 };
  return prev && order[prev] >= order[g] ? prev : g;
}

function registerResult(ex, ok, warning, given) {
  const s = session;
  const first = !s.retried.has(s.pos) && !ex._retry;
  state.byType[ex.type] = state.byType[ex.type] || { done: 0, correct: 0 };
  state.byType[ex.type].done++;
  if (ok) state.byType[ex.type].correct++;
  state.days = recordActivity(state.days, { exercises: 1, correct: ok ? 1 : 0 });
  if (ok && first) s.correctFirst++;
  if (!ok) s.mistakes++;
  if (ex.type !== 'falar' && ex.itemId) {
    s.grades[ex.itemId] = gradeOf(s.grades[ex.itemId], ok ? (warning ? 'hard' : 'good') : 'again');
    if (!ok) {
      const e = state.errors[ex.itemId] || { itemId: ex.itemId, count: 0 };
      const item = idx.items.get(ex.itemId);
      state.errors[ex.itemId] = { ...e, type: ex.type, prompt: item.pt, expected: item.it,
        given: String(given ?? ''), count: e.count + 1, lastAt: new Date().toISOString(), resolved: false };
      if (!e.count) s.newErrors = (s.newErrors || 0) + 1;
    } else if (s.kind === 'erros' && !warning && state.errors[ex.itemId]) {
      state.errors[ex.itemId].resolved = true;
    }
  }
  // errou: o exercício volta no fim da fila uma vez
  if (!ok && !ex._retry) { s.queue.push({ ...ex, _retry: true }); s.retried.add(s.queue.length - 1); }
  persist();
}

function check() {
  const ex = cur();
  const a = session.answer;
  let res;
  if (ex.type === 'escolher' || ex.type === 'lacuna') res = { ok: a === ex.answer, best: ex.answer };
  else if (ex.type === 'montar') res = checkTiles(a.map((id) => ex.tiles[id].t), ex.expected, { vocab: idx.vocab });
  else res = checkAnswer(a, ex.expected, { vocab: idx.vocab });
  if (ex.type === 'lacuna' && res.ok) res.best = ex.full;
  const given = ex.type === 'montar' ? a.map((id) => ex.tiles[id].t).join(' ') : a;
  session.feedback = res;
  registerResult(ex, res.ok, res.warning, given);
  beep(res.ok);
  if (ex.type !== 'ouvir' && (ex.type === 'montar' || ex.type === 'digitar' || ex.type === 'lacuna')) say(idx.items.get(ex.itemId)?.it);
  render();
}

function next() {
  const s = session;
  s.done++;
  s.pos++;
  s.answer = null; s.feedback = null; s.match = null; s.recording = false;
  // pula exercícios de áudio/fala se o aluno desligou por agora
  while (s.pos < s.queue.length && ((s.queue[s.pos].type === 'ouvir' && !canListen()) || (s.queue[s.pos].type === 'falar' && !canSpeak()))) { s.pos++; s.done++; }
  if (s.pos >= s.queue.length) finish();
  render();
  autoPlay();
}

function finish() {
  const s = session;
  const now = new Date();
  s.endedAt = Date.now();
  const before = computeStreak(state.days, today());
  if (s.kind === 'lesson') {
    s.xp = lessonXP({ correctFirst: s.correctFirst, total: s.total, mistakes: s.mistakes });
    const acc = Math.round((100 * s.correctFirst) / s.total);
    const p = state.lessons[s.lessonId] || { completed: 0, bestAccuracy: 0 };
    state.lessons[s.lessonId] = { completed: p.completed + 1, bestAccuracy: Math.max(p.bestAccuracy, acc), lastAt: now.toISOString() };
    // todos os itens da lição entram na revisão espaçada
    const lesson = idx.lessonById.get(s.lessonId);
    for (const id of lesson.itemIds) {
      const g = s.grades[id] || 'good';
      if (!state.cards[id]) state.cards[id] = review(newCard(now), g, now);
      else if (isDue(state.cards[id], now)) state.cards[id] = review(state.cards[id], g, now);
    }
  } else {
    s.xp = s.correctFirst + (s.mistakes === 0 ? 5 : 0);
    if (s.kind === 'review') for (const [id, g] of Object.entries(s.grades)) if (state.cards[id]) state.cards[id] = review(state.cards[id], g, now);
  }
  state.days = recordActivity(state.days, { xp: s.xp, seconds: Math.round((s.endedAt - s.started) / 1000), session: true }, now);
  s.streakUp = !before.doneToday;
  s.finished = true;
  persist();
}

function quitSession() {
  if (session && !session.finished && session.done > 0 && !confirm('Sair agora? O progresso desta lição será perdido (os exercícios feitos contam nas estatísticas).')) return;
  if (session && !session.finished) state.days = recordActivity(state.days, { seconds: Math.round((Date.now() - session.started) / 1000) });
  persist();
  session = null;
  window.speechSynthesis?.cancel();
  render();
}

// ---------- pares ----------
function pairTap(side, id) {
  const m = session.match;
  const ex = cur();
  if (m.done.includes(id)) return;
  m.wrong = null;
  if (side === 'L') { m.selL = id; const p = ex.left.find((x) => x.itemId === id); say(p.it); } else m.selR = id;
  if (m.selL && m.selR) {
    if (m.selL === m.selR) { m.done.push(m.selL); beep(true); }
    else {
      m.wrong = { L: m.selL, R: m.selR }; beep(false);
      session.pairMistakes = (session.pairMistakes || 0) + 1;
      session.grades[m.selL] = gradeOf(session.grades[m.selL], 'hard');
    }
    m.selL = null; m.selR = null;
    if (m.done.length === ex.left.length) {
      const ok = !session.pairMistakes;
      state.byType.pares = state.byType.pares || { done: 0, correct: 0 };
      state.byType.pares.done++; if (ok) state.byType.pares.correct++;
      state.days = recordActivity(state.days, { exercises: 1, correct: 1 });
      session.correctFirst++;
      session.pairMistakes = 0;
      session.feedback = { ok: true, best: '' };
      persist();
    }
  }
  render();
}

// ---------- falar ----------
async function mic() {
  const ex = cur();
  session.recording = true; render();
  try {
    const alts = await listenOnce();
    session.recording = false;
    const best = alts.map((h) => ({ h, s: speechScore(h, ex.expected) })).sort((a, b) => b.s - a.s)[0];
    session.answer = best.h;
    const ok = best.s >= 0.7;
    session.feedback = { ok, best: ex.expected, heard: best.h };
    registerResult(ex, ok, null, best.h);
    beep(ok);
  } catch (e) {
    session.recording = false;
    const msg = { 'not-allowed': 'Permita o microfone para este site.', 'sem-fala': 'Não ouvi nada. Tente de novo.', tempo: 'Não ouvi nada. Tente de novo.', network: 'O reconhecimento de voz precisa de internet.' }[e.message] || 'Não consegui usar o microfone.';
    toast(msg);
  }
  render();
}

// ---------- arquivos ----------
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function importBackup(file) {
  try {
    const obj = JSON.parse(await file.text());
    const err = validateBackup(obj);
    if (err) return toast(err);
    if (!confirm('Substituir todos os dados deste aparelho pelo backup?')) return;
    state = migrate(obj); persist(); setVoice(state.settings.voiceURI); toast('Backup importado ✔'); render();
  } catch { toast('Arquivo inválido.'); }
}

// ---------- render principal ----------
function render() {
  if (session) { $app.innerHTML = renderSession(); return; }
  const views = { trilha: viewTrilha, praticar: viewPraticar, progresso: viewProgresso, ajustes: viewAjustes };
  $app.innerHTML = topbar() + `<main class="tab">${views[tab]()}</main>` + nav() +
    (sheet ? `<div class="sheet-bg" data-act="close-sheet"><div class="sheet" data-stop="1">${sheet}</div></div>` : '');
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.act === 'close-sheet' && e.target.closest('[data-stop]')) return;
  const act = el.dataset.act;
  const s = session;
  switch (act) {
    case 'tab': tab = el.dataset.tab; window.scrollTo(0, 0); render(); break;
    case 'lesson': sheet = sheetLesson(el.dataset.id); render(); break;
    case 'guide': sheet = sheetGuide(el.dataset.unit); render(); break;
    case 'close-sheet': sheet = null; render(); break;
    case 'start-lesson': startLesson(el.dataset.id); break;
    case 'start-review': startReview(); break;
    case 'start-errors': startErrors(); break;
    case 'start-free': startFree(); break;
    case 'hide-ios': state.settings.hideIosHint = true; persist(); render(); break;
    case 'say': say(el.dataset.text); break;
    case 'say-slow': say(el.dataset.text, true); break;
    case 'pick': if (!s.feedback) { s.answer = el.dataset.val; const ex = cur(); if (ex.type === 'escolher' && ex.dir === 'pt-it') say(s.answer); render(); } break;
    case 'tile': if (!s.feedback) { const id = +el.dataset.id; s.answer = [...(s.answer || []), id]; say(cur().tiles[id].t); render(); } break;
    case 'untile': if (!s.feedback) { s.answer = (s.answer || []).filter((x) => x !== +el.dataset.id); render(); } break;
    case 'accent': {
      const ta = document.querySelector('textarea.answer');
      const pos = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, pos) + el.dataset.c + ta.value.slice(ta.selectionEnd ?? pos);
      s.answer = ta.value; ta.focus(); ta.setSelectionRange(pos + 1, pos + 1);
      document.querySelector('[data-act=check]')?.removeAttribute('disabled');
      break;
    }
    case 'pair': pairTap(el.dataset.side, el.dataset.id); break;
    case 'check': check(); break;
    case 'next': next(); break;
    case 'mic': mic(); break;
    case 'skip-one': next(); break;
    case 'skip-mode':
      if (cur().type === 'ouvir') skipAudioUntil = Date.now() + 15 * 60e3; else skipSpeakUntil = Date.now() + 15 * 60e3;
      toast('Ok! Sem exercícios de ' + (cur().type === 'ouvir' ? 'ouvir' : 'falar') + ' por 15 minutos.');
      next(); break;
    case 'quit': quitSession(); break;
    case 'close-session': session = null; tab = 'trilha'; render(); break;
    case 'goal': state.settings.dailyGoal = +el.dataset.goal; persist(); render(); break;
    case 'test-voice': say('Buongiorno, come stai?'); break;
    case 'backup': download(`italiano-backup-${today()}.json`, backupJSON(state), 'application/json'); state.settings.lastBackup = new Date().toISOString(); persist(); render(); break;
    case 'wipe':
      if (confirm('Apagar TODO o progresso deste aparelho? Exporte um backup antes.') && confirm('Tem certeza? Não dá para desfazer.')) { localStorage.removeItem('italiano-app:v1'); state = load(); render(); toast('Dados apagados.'); }
      break;
    case 'report-dl': download(`relatorio-italiano-${today()}.md`, reportMarkdown(state, idx), 'text/markdown'); break;
    case 'report-copy': navigator.clipboard?.writeText(reportMarkdown(state, idx)).then(() => toast('Relatório copiado ✔'), () => toast('Não consegui copiar.')); break;
    case 'report-share': {
      const text = reportMarkdown(state, idx);
      const file = new File([text], `relatorio-italiano-${today()}.md`, { type: 'text/markdown' });
      const data = navigator.canShare?.({ files: [file] }) ? { files: [file], title: 'Relatório de italiano' } : { title: 'Relatório de italiano', text };
      navigator.share(data).catch(() => {});
      break;
    }
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.act === 'type' && session) {
    session.answer = el.value;
    const btn = document.querySelector('[data-act=check]');
    if (btn) btn.disabled = !el.value.trim();
  }
  if (el.dataset.act === 'rate') { state.settings.rate = +el.value; persist(); el.closest('.setting').querySelector('span').textContent = Math.round(el.value * 100) + '%'; }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.set) { state.settings[el.dataset.set] = el.checked; persist(); render(); }
  if (el.dataset.act === 'voice') { state.settings.voiceURI = el.value; setVoice(el.value); persist(); say('Ciao! Io sono la tua voce italiana.'); }
  if (el.dataset.act === 'import' && el.files[0]) importBackup(el.files[0]);
});

document.addEventListener('keydown', (e) => {
  if (!session || session.finished) return;
  const ex = cur();
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (session.feedback) next();
    else if (hasAnswer(ex)) { if (e.target.tagName === 'TEXTAREA') session.answer = e.target.value; check(); }
  } else if (/^[1-4]$/.test(e.key) && ex.type === 'escolher' && !session.feedback && e.target.tagName !== 'TEXTAREA') {
    const o = ex.options[+e.key - 1]; if (o) { session.answer = o; render(); }
  }
});

// ---------- início ----------
initTTS(state.settings.voiceURI, () => { if (tab === 'ajustes' && !session) render(); });
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
navigator.storage?.persist?.().catch(() => {});

// Gancho para testes automatizados (screenshots). Não afeta o uso normal.
window.__italiano = {
  idx, get state() { return state; },
  setState(s) { state = migrate(s); persist(); render(); },
  setTab(t) { tab = t; session = null; sheet = null; render(); },
  openLesson(id) { sheet = sheetLesson(id); render(); },
  demo(type, lessonId = 'u2l1') {
    const l = idx.lessonById.get(lessonId);
    const all = lessonExercises(idx, l, { listen: true, speak: true });
    const ex = all.find((x) => x.type === type);
    startSession('lesson', [ex], { lessonId });
  },
  startEx(exs, lessonId = 'u1l1') { startSession('lesson', exs, { lessonId }); },
  get session() { return session; },
  answer(v) { session.answer = v; render(); },
  check, render,
};
