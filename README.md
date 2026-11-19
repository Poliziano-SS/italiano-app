# Italiano A1 — app pessoal (estilo Duolingo)

App de estudo de italiano feito para o Gabriel: **100% gratuito, sem servidor, sem conta, sem IA**.
É uma PWA estática (HTML + CSS + JavaScript puro, sem build) que roda no navegador do celular,
funciona **offline** e guarda tudo **só no aparelho**.

## O que tem

- **Trilha A1** com 9 unidades e 43 lições, do pré-A1 ao A1: saudações, apresentação, números,
  essere/avere, artigos e família, bar e mensa, cidade (Pavia, trem Milão–Pavia), rotina e universidade
  (incluindo vocabulário leve de Odontoiatria). São 312 palavras e 266 frases, todas com tradução em português.
- **Dica de gramática** curta em cada lição (botão 📖 Dicas na unidade e "Por quê?" quando você erra).
- **6 tipos de exercício**: escolher a tradução, montar a frase com banco de palavras, digitar a tradução,
  ouvir e digitar, combinar pares e completar a lacuna. **Falar a frase** é opcional, onde o navegador permitir.
- A correção aceita **maiúsculas, pontuação e pronome sujeito opcional** (io/tu/lui...). Se faltar um
  **acento** ou **apóstrofo**, a resposta conta como certa, mas o app avisa. Também tolera 1 erro de digitação
  numa palavra longa, desde que ele não forme outra palavra (por exemplo, "sono" no lugar de "sonno" conta como erro).
- **Áudio** com a voz italiana do próprio aparelho (`speechSynthesis`), com botão normal e 🐢 lento.
- **Revisão espaçada FSRS** (biblioteca `ts-fsrs` v4.7.1, MIT, incluída em `vendor/`, ou seja, offline).
  Cada palavra e frase vira um cartão, e a **revisão diária** traz o que está vencido.
- **Revisar meus erros**: lista dos erros em aberto. Quando você acerta o item na revisão, ele sai da lista.
- **XP**, **meta diária** configurável, **ofensiva** (🔥 dias seguidos) e **você × semana passada**
  (no lugar das ligas). **Sem corações**.
- **Backup** (exportar/importar JSON) e **relatório para o Poliziano** (Markdown com ofensiva, XP,
  lições, acertos por tipo de exercício e erros em aberto). Dá para baixar, compartilhar ou copiar.

## Estrutura

```
index.html              página única
styles.css              visual (mobile-first)
manifest.webmanifest    PWA (nome, ícones, tela cheia)
sw.js                   service worker (offline)
icons/                  ícones 192/512/maskable/apple-touch
data/curso-a1.js        CONTEÚDO do curso (fácil de ampliar, veja abaixo)
js/app.js               interface e telas
js/exercises.js         gera os exercícios a partir do conteúdo
js/check.js             correção (acentos, pontuação, pronomes, digitação)
js/srs.js               revisão espaçada (FSRS)
js/stats.js             XP, ofensiva, comparação semanal
js/store.js             dados no aparelho, backup e relatório
js/speech.js            voz (falar e ouvir) do navegador
js/course.js            indexa o conteúdo
vendor/ts-fsrs.mjs      biblioteca FSRS (MIT)
tests/                  testes automáticos (lógica + navegador)
screenshots/            telas em 390x844
```

## Rodar no computador

Não precisa instalar nada além de Python (ou qualquer servidor estático):

```bash
cd italiano-app
python3 -m http.server 8000
# abra http://localhost:8000
```

> Abrir o `index.html` direto (file://) não funciona, porque os navegadores bloqueiam módulos JS e o service worker fora de um servidor.

Para testar no celular **na mesma rede Wi-Fi**, abra `http://IP-DO-COMPUTADOR:8000`. O app funciona,
mas o modo offline e a instalação só valem em **HTTPS** (ou localhost). Por isso, para usar de verdade,
publique numa das hospedagens grátis abaixo.

## Testes

```bash
node --test tests/unit.test.mjs         # 25 testes: correção, FSRS, ofensiva, semana, conteúdo, backup, relatório
cd tests && npm install && node e2e.mjs # Chrome headless 390x844: joga uma lição inteira, testa offline e tira screenshots
```

(`e2e.mjs` usa `/usr/bin/google-chrome`; para outro caminho, use `CHROME=/caminho/do/chrome node e2e.mjs`.)

## Hospedagem grátis (nada disso foi feito; são só as opções)

Qualquer hospedagem de site estático com HTTPS serve. É só enviar a pasta (sem `tests/` e `screenshots/`, que são opcionais).

1. **GitHub Pages**: crie um repositório (pode ser privado só em planos pagos; no grátis, o site do Pages é público),
   envie os arquivos e ative *Settings → Pages → Deploy from branch → main / root*. Endereço: `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.
   O app usa caminhos relativos, então funciona em subpasta.
2. **Cloudflare Pages**: *Workers & Pages → Create → Pages → Upload assets* e arraste a pasta. Não tem build.
   Endereço `https://NOME.pages.dev`. Dá para proteger com Cloudflare Access (grátis até 50 usuários) se quiser que só você entre.
3. **Netlify**: em *app.netlify.com/drop*, arraste a pasta. Endereço `https://NOME.netlify.app`.

Como os dados ficam no aparelho e não há senha nem chave no código, o site publicado não expõe nada pessoal.
Quem abrir o link vê só o curso, com o próprio progresso vazio.

**Ao atualizar o app** depois de publicado, aumente `VERSAO` em `sw.js`. Assim o celular baixa a versão nova,
que aparece na segunda vez que o app for aberto.

## Instalar no celular

- **Android (Chrome)**: abra o link e toque em *⋮ → Instalar app* (ou *Adicionar à tela inicial*).
- **iPhone (Safari)**: abra o link e toque em *Compartilhar → Adicionar à Tela de Início*.

## Limitações conhecidas

- **iPhone / Safari**
  - Se você usar só numa aba do Safari, sem adicionar à Tela de Início, o iOS pode **apagar os dados após cerca de 7 dias sem abrir o site**.
    Instale na Tela de Início, porque aí isso não acontece, e exporte o backup de vez em quando.
  - O **reconhecimento de fala** (exercício "falar") no iOS é instável, principalmente no app instalado, e usa a internet.
    Quando não funciona, o exercício some ou dá para tocar em "Não posso falar agora". Os outros 6 tipos funcionam normalmente.
  - Se o áudio não tocar na primeira vez, toque no 🔊 (o iOS só libera som depois de um toque).
    Para ter uma voz italiana boa, vá em *Ajustes → Acessibilidade → Conteúdo Falado → Vozes → Italiano* e baixe a "Alice" (ou outra).
  - Não há lembrete por notificação. Web push no iPhone exige servidor, e o app não tem servidor.
- **Android**: funciona melhor no Chrome. O reconhecimento de fala precisa de internet (usa o serviço do Google).
  Se não houver voz italiana, instale em *Configurações → Acessibilidade → Texto para fala → Google → Instalar dados de voz → Italiano*.
- Qualidade da voz: é a do sistema, não uma voz neural paga. Não existe nota de pronúncia.
- **Sem sincronização** entre aparelhos: para trocar de celular, use exportar/importar backup.
- Sem IA: não há conversa livre nem explicação gerada. As dicas e notas são fixas, escritas no conteúdo.
- O conteúdo foi escrito à mão e conferido, mas vale o Poliziano revisar. Correções vão em `data/curso-a1.js`.

## Como ampliar o conteúdo

Edite `data/curso-a1.js` (ou crie `data/curso-a2.js` com o mesmo formato e importe em `js/app.js`):

```js
L('u10l1', 'Título da lição',
  'Dica de gramática em português, pode usar <b>negrito</b>.',
  [['parola', 'palavra'], ...],                       // palavras: [italiano, português]
  [
    ['Io {sono|sei|è} stanco.', 'Eu estou cansado.'],  // {certa|errada|errada} = lacuna e opções
    ['Ho 25 anni.', 'Tenho 25 anos.', { alt: ['Ho venticinque anni.'], nota: 'Idade usa avere.' }],
  ]),
```

Os exercícios (todos os 6 tipos) são gerados automaticamente. O progresso fica ligado ao **texto em italiano**,
então corrigir a tradução em português não apaga nada. Depois de editar, rode `node --test tests/unit.test.mjs`,
que confere o formato de todas as lições.
