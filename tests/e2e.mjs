// Teste no navegador (Chrome headless, tela de celular 390x844) + screenshots.
// Uso: cd tests && npm i && node e2e.mjs   (precisa do google-chrome instalado)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots');
const PORT = 8765;
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
mkdirSync(OUT, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--lang=pt-BR'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36');
  const shot = async (name, full = false) => { await sleep(250); await page.screenshot({ path: path.join(OUT, name), fullPage: full }); console.log('  📸', name); };

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  ok(await page.$('.node.current'), 'trilha carrega com a lição atual destacada');
  await shot('01-trilha-inicio.png');

  // ---------- abre a primeira lição ----------
  await page.click('.node.current');
  await page.waitForSelector('.sheet');
  await shot('02-licao-dica.png');
  await page.click('[data-act=start-lesson]');

  // ---------- joga a lição inteira pela interface ----------
  const seen = new Set();
  let madeMistake = false;
  for (let guard = 0; guard < 40; guard++) {
    const info = await page.evaluate(() => {
      const s = window.__italiano.session;
      if (!s || s.finished) return null;
      return { ex: s.queue[s.pos], fb: !!s.feedback };
    });
    if (!info) break;
    const ex = info.ex;
    if (info.fb) { await page.click('[data-act=next]'); continue; }
    const first = !seen.has(ex.type); seen.add(ex.type);
    if (first) await shot(`03-exercicio-${ex.type}.png`);

    if (ex.type === 'escolher' || ex.type === 'lacuna') {
      await page.$$eval('[data-act=pick]', (bs, ans) => bs.find((b) => b.dataset.val === ans).click(), ex.answer);
      if (ex.type === 'lacuna' && first) await shot('03-exercicio-lacuna-escolhida.png');
    } else if (ex.type === 'montar') {
      const words = ex.expected[0].replace(/[.,!?;:…]/g, ' ').split(/\s+/).filter(Boolean);
      const used = new Set();
      for (const w of words) {
        const id = ex.tiles.find((t) => t.t === w && !used.has(t.id)).id; used.add(id);
        await page.click(`.bank [data-act=tile][data-id="${id}"]`);
      }
      if (first) await shot('03-exercicio-montar-preenchido.png');
    } else if (ex.type === 'digitar' || ex.type === 'ouvir') {
      if (!madeMistake && ex.type === 'digitar') {
        await page.type('textarea.answer', 'sbagliato');
        madeMistake = true;
        await page.click('[data-act=check]');
        await shot('04-feedback-erro.png');
        await page.click('[data-act=next]');
        continue;
      }
      await page.type('textarea.answer', ex.expected[0]);
    } else if (ex.type === 'pares') {
      for (const p of ex.left) {
        await page.click(`[data-side=L][data-id="${p.itemId}"]`);
        await page.click(`[data-side=R][data-id="${p.itemId}"]`);
      }
      await shot('03-exercicio-pares-feito.png');
      await page.click('[data-act=next]');
      continue;
    } else if (ex.type === 'falar') {
      await page.click('[data-act=skip-one]');
      continue;
    }
    await page.click('[data-act=check]');
    if (!seen.has('ok-shot')) { seen.add('ok-shot'); await shot('04-feedback-acerto.png'); }
    await page.click('[data-act=next]');
  }
  await page.waitForSelector('.done');
  await shot('05-licao-concluida.png');
  const after = await page.evaluate(() => {
    const s = window.__italiano.state;
    return { lesson: s.lessons.u1l1, cards: Object.keys(s.cards).length, errors: Object.keys(s.errors).length, xp: Object.values(s.days)[0]?.xp, sessions: Object.values(s.days)[0]?.sessions };
  });
  ok(after.lesson?.completed === 1, 'lição marcada como concluída');
  ok(after.cards === 13, `itens da lição viraram cartões FSRS (${after.cards})`);
  ok(after.errors === 1, 'erro proposital foi para a lista de erros');
  ok(after.xp > 10 && after.sessions === 1, `XP registrado (${after.xp}) e ofensiva iniciada`);
  ok(['escolher', 'montar', 'digitar', 'ouvir', 'pares', 'lacuna'].every((t) => seen.has(t)), 'os 6 tipos apareceram na lição: ' + [...seen].join(', '));
  await page.click('[data-act=close-session]');
  ok(await page.$eval('.pill.fogo', (e) => e.textContent.trim()) === '🔥 1', 'ofensiva = 1 no topo');
  await shot('06-trilha-apos-licao.png');

  // ---------- aviso de acento e "falar" (exercícios montados direto) ----------
  await page.evaluate(async () => {
    const m = await import('./js/exercises.js');
    const app = window.__italiano;
    const item = [...app.idx.items.values()].find((i) => i.it === 'Lei è a casa.');
    const fal = [...app.idx.items.values()].find((i) => i.it === 'Piacere, io sono Giulia.');
    app.startEx([m.makeDigitar(item), m.makeFalar(fal)], 'u4l1');
  });
  await page.type('textarea.answer', 'lei e a casa');
  await page.click('[data-act=check]');
  const warn = await page.$eval('.s-foot', (e) => e.textContent);
  ok(/acento/i.test(warn), 'resposta sem acento aceita com aviso de acento');
  await shot('07-feedback-acento.png');
  await page.click('[data-act=next]');
  await shot('08-exercicio-falar.png');
  await page.click('[data-act=quit]');

  // ---------- estado de demonstração: 2 semanas de histórico ----------
  await page.evaluate(() => {
    const app = window.__italiano;
    const s = JSON.parse(JSON.stringify(app.state));
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const now = new Date();
    for (let i = 1; i <= 16; i++) {
      if (i === 9 || i === 12) continue;
      const d = new Date(now); d.setDate(d.getDate() - i);
      const xp = [35, 22, 48, 30, 15, 41, 28, 33][i % 8];
      s.days[key(d)] = { xp, exercises: 14, correct: 12, seconds: 900 + i * 60, sessions: 2 };
    }
    s.days[key(now)].xp += 6;
    const ls = app.idx.lessons.slice(0, 7);
    ls.forEach((l, i) => {
      s.lessons[l.id] = { completed: 1 + (i % 2), bestAccuracy: 80 + i * 2, lastAt: now.toISOString() };
      for (const id of l.itemIds) if (!s.cards[id]) s.cards[id] = { ...s.cards[Object.keys(s.cards)[0]], due: new Date(now.getTime() - (i % 3) * 864e5).toISOString() };
    });
    const its = [...app.idx.items.values()];
    for (const [it, given, n] of [['Ho fame!', 'Sono fame', 3], ['Lui ha sonno.', 'Lui ha sono', 2], ["Giulia è un'amica.", 'Giulia è una amica', 1]]) {
      const item = its.find((x) => x.it === it);
      if (item) s.errors[item.id] = { itemId: item.id, type: 'digitar', prompt: item.pt, expected: item.it, given, count: n, lastAt: now.toISOString(), resolved: false };
    }
    app.setState(s);
    app.setTab('trilha');
  });
  await shot('09-trilha-com-progresso.png');
  await page.evaluate(() => window.__italiano.setTab('praticar'));
  await shot('10-praticar.png');
  await page.evaluate(() => window.__italiano.setTab('progresso'));
  await shot('11-progresso.png');
  await page.addStyleTag({ content: 'nav.bottom{display:none}' });
  await shot('11b-progresso-completo.png', true);
  await page.evaluate(() => document.querySelectorAll('style').forEach((x) => x.textContent.includes('nav.bottom{display:none}') && x.remove()));
  await page.evaluate(() => window.__italiano.setTab('ajustes'));
  await shot('12-ajustes.png');
  await page.evaluate(() => { window.__italiano.setTab('trilha'); document.querySelector('[data-act=guide]').click(); });
  await shot('13-dicas-unidade.png');

  // ---------- revisão diária ----------
  await page.evaluate(() => window.__italiano.setTab('praticar'));
  await page.click('[data-act=start-review]');
  ok(await page.$('.session'), 'revisão diária abre com cartões vencidos');
  await shot('14-revisao-diaria.png');
  await page.click('[data-act=quit]');
  await page.click('[data-act=start-errors]');
  ok(await page.$('.session'), 'revisão de erros abre');
  await page.click('[data-act=quit]');

  // ---------- relatório e backup ----------
  const rep = await page.evaluate(async () => {
    const m = await import('./js/store.js');
    return m.reportMarkdown(window.__italiano.state, window.__italiano.idx);
  });
  ok(/Sono fame/.test(rep) && /Ofensiva/.test(rep), 'relatório markdown gerado com erros e ofensiva');

  // ---------- offline (service worker) ----------
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await sleep(500);
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.topbar', { timeout: 5000 }).catch(() => {});
  ok(await page.$('.topbar'), 'app abre OFFLINE pelo service worker');
  ok(await page.evaluate(() => Object.keys(window.__italiano.state.lessons).length) >= 7, 'dados preservados após recarregar offline');
  await page.setOfflineMode(false);

  // manifesto
  const man = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
  ok(man.icons.length >= 3 && man.display === 'standalone', 'manifesto PWA com ícones e display standalone');

  ok(errors.length === 0, 'sem erros de JavaScript no console' + (errors.length ? ': ' + errors.join(' | ') : ''));
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} falha(s)` : '\nTudo certo ✔');
process.exit(failures ? 1 : 0);
