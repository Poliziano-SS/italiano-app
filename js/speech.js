// Áudio com a voz do próprio navegador (speechSynthesis) e fala com Web Speech API, quando houver.
let voices = [];
let chosen = null;
let preferredURI = '';

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

function refresh() {
  if (!ttsSupported()) return;
  voices = window.speechSynthesis.getVoices().filter((v) => /^it([-_]|$)/i.test(v.lang));
  chosen = voices.find((v) => v.voiceURI === preferredURI) ||
    voices.find((v) => /it[-_]IT/i.test(v.lang) && /(Alice|Federica|Google|Luca|Elsa|Isabella|Diego)/i.test(v.name)) ||
    voices.find((v) => /it[-_]IT/i.test(v.lang)) || voices[0] || null;
}

export function initTTS(uri = '', onChange = () => {}) {
  preferredURI = uri;
  if (!ttsSupported()) return;
  refresh();
  window.speechSynthesis.addEventListener?.('voiceschanged', () => { refresh(); onChange(); });
}

export function setVoice(uri) { preferredURI = uri; refresh(); }
export const italianVoices = () => voices;
export const currentVoice = () => chosen;

export function speak(text, { slow = false, rate = 1 } = {}) {
  if (!ttsSupported() || !text) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'it-IT';
  if (chosen) u.voice = chosen;
  u.rate = slow ? 0.6 * rate : 0.95 * rate;
  synth.speak(u);
  return true;
}

// ---- Reconhecimento de fala (opcional) ----
const Rec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const sttSupported = () => !!Rec;

/** Escuta uma frase em italiano. Resolve com o texto ouvido (ou rejeita). */
export function listenOnce({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!Rec) return reject(new Error('sem-suporte'));
    const rec = new Rec();
    rec.lang = 'it-IT';
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(t); try { rec.stop(); } catch {} fn(v); };
    const t = setTimeout(() => finish(reject, new Error('tempo')), timeoutMs);
    rec.onresult = (e) => {
      const alts = Array.from(e.results[0] || []).map((a) => a.transcript);
      finish(resolve, alts);
    };
    rec.onerror = (e) => finish(reject, new Error(e.error || 'erro'));
    rec.onend = () => finish(reject, new Error('sem-fala'));
    try { rec.start(); } catch (err) { finish(reject, err); }
  });
}
