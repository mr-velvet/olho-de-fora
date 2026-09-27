// olho.mjs — O OLHO DE FORA. Roda no GitHub Actions, fora da nossa máquina.
//
// ─── Por que ele existe ─────────────────────────────────────────────────────
//
// Tudo o que construímos contra o incidente de 26/09 — o vigia dos limiares, a
// autocura, a saída de emergência do Telegram, o livro de disponibilidade —
// mora DENTRO da VM. Se a VM inteira desaparecer (pane de máquina, rede, zona),
// as quatro coisas somem juntas e voltamos ao silêncio de duas horas por um
// caminho diferente do primeiro.
//
// Este arquivo é a única peça que enxerga de fora. Ele não sabe nada da nossa
// máquina, não tem acesso a ela, e não precisa: faz um GET público em cada
// serviço, como um cliente faria, e fala pelo Telegram e por e-mail direto, sem
// passar por nada nosso.
//
// ─── O que ele NÃO faz, de propósito ────────────────────────────────────────
//
// Não cura. Curar exige poder sobre a máquina, e dar esse poder a um workflow
// público num repositório é a troca errada — o vigia de dentro cura, com
// privilégio mínimo e limites contados. O olho de fora só ENXERGA e FALA.
//
// Não repete a cada execução. A escada de marcos está em decisao.mjs, provada
// por 24 horas simuladas de serviço fora. Alarme que repete a cada 5 min é
// alarme que se aprende a silenciar, e aí não existe mais.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decidir, texto, ehMaquinaInteira, minutos } from './decisao.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 15_000;

// ─── A sonda ────────────────────────────────────────────────────────────────

/**
 * Bate num serviço. Devolve `dePe` e, quando não está, o erro EM TEXTO — porque
 * em 26/09 a causa estava na primeira linha do log e o aviso não a levava.
 */
export async function sondar(servico, { fetchImpl = fetch } = {}) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let r;
    try {
      r = await fetchImpl(servico.url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'user-agent': 'agnts-olho-de-fora/1 (+https://agnts.did.lu)' },
      });
    } finally { clearTimeout(timer); }

    const ms = Date.now() - t0;
    if (r.status !== (servico.esperado || 200)) {
      return { ...servico, dePe: false, erro: `HTTP ${r.status}`, ms };
    }
    if (servico.contem) {
      const corpo = await r.text();
      if (!corpo.includes(servico.contem)) {
        // 200 não é o mesmo que "funcionando". Um Caddy que responde com a
        // página de erro dele devolve 200 e o app por trás está morto.
        return { ...servico, dePe: false, erro: `HTTP 200 mas sem "${servico.contem}" no corpo`, ms };
      }
    }
    return { ...servico, dePe: true, ms };
  } catch (err) {
    const ms = Date.now() - t0;
    const erro = err.name === 'AbortError' ? `sem resposta em ${TIMEOUT_MS / 1000}s` : String(err.message || err);
    return { ...servico, dePe: false, erro, ms };
  }
}

// ─── As bocas ───────────────────────────────────────────────────────────────
//
// Duas, independentes. Se uma falha, a outra sai — foi a lição mais cara do
// incidente: um caminho de saída único é nenhum caminho de saída.

export async function falarTelegram({ token, chatId, mensagem, fetchImpl = fetch }) {
  if (!token || !chatId) return { ok: false, erro: 'credencial do Telegram ausente' };
  try {
    const r = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: mensagem, disable_web_page_preview: true }),
    });
    if (!r.ok) return { ok: false, erro: `Telegram HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (err) { return { ok: false, erro: String(err.message || err) }; }
}

export async function falarEmail({ apiKey, para, assunto, mensagem, fetchImpl = fetch }) {
  if (!apiKey || !para) return { ok: false, erro: 'credencial de e-mail ausente' };
  try {
    const r = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: 'Agnts <agnts@did.lu>',
        to: [para],
        subject: assunto,
        text: mensagem,
      }),
    });
    if (!r.ok) return { ok: false, erro: `Resend HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (err) { return { ok: false, erro: String(err.message || err) }; }
}

// ─── O estado, numa issue do repositório ────────────────────────────────────
//
// A escolha entre cache e issue importa e não é só gosto:
//
//   - O cache do Actions EXPIRA em 7 dias sem uso. Um serviço que fica meses de
//     pé perde o estado e nunca é problema; mas a issue também é o REGISTRO, e
//     um registro que evapora não serve ao livro de disponibilidade.
//   - A issue é legível por humano. Quando o founder recebe o aviso às 3h, ele
//     tem um lugar com a linha do tempo, sem precisar de nós.
//
// Uma issue só, fixa pelo título, com o estado em JSON no corpo dela e a linha
// do tempo nos comentários. Aberta quando há queda, FECHADA quando tudo normaliza
// — o estado aberto/fechado da issue é, ele mesmo, o resumo de "estamos bem?".

const TITULO_ISSUE = '🩺 olho de fora — estado dos serviços críticos';
const MARCA_JSON = '<!-- estado-olho-de-fora';

export function lerEstadoDoCorpo(corpo) {
  if (!corpo) return {};
  const i = corpo.indexOf(MARCA_JSON);
  if (i === -1) return {};
  const fim = corpo.indexOf('-->', i);
  if (fim === -1) return {};
  try { return JSON.parse(corpo.slice(i + MARCA_JSON.length, fim).trim()); } catch { return {}; }
}

export function montarCorpo(estados, resultados, agora) {
  const linhas = [
    '**O olho de fora** verifica os serviços de fora da nossa máquina, a cada 5 minutos, pelo GitHub Actions.',
    '',
    `Última verificação: \`${agora.toISOString()}\``,
    '',
    '| serviço | agora | desde |',
    '| --- | --- | --- |',
  ];
  for (const r of resultados) {
    const e = estados[r.nome];
    const situacao = r.dePe ? '🟢 de pé' : `🔴 fora — ${r.erro}`;
    const desde = e?.desde ? `${minutos(e.desde, agora)} min` : '—';
    linhas.push(`| ${r.rotulo || r.nome} | ${situacao} | ${desde} |`);
  }
  linhas.push('');
  linhas.push('Esta issue é o estado e o registro. Ela fecha sozinha quando tudo normaliza.');
  linhas.push('');
  linhas.push(`${MARCA_JSON}`);
  linhas.push(JSON.stringify(estados, null, 2));
  linhas.push('-->');
  return linhas.join('\n');
}

async function gh(caminho, { token, repo, metodo = 'GET', corpo = null, fetchImpl = fetch }) {
  const r = await fetchImpl(`https://api.github.com/repos/${repo}${caminho}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!r.ok) throw new Error(`GitHub ${metodo} ${caminho} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

export async function acharIssue({ token, repo, fetchImpl = fetch }) {
  // Busca entre as abertas E as fechadas: a issue é reusada, não recriada, para
  // que a linha do tempo dos comentários não se fragmente em N issues.
  const lista = await gh('/issues?state=all&per_page=100&labels=olho-de-fora', { token, repo, fetchImpl });
  return lista.find((i) => i.title === TITULO_ISSUE) || null;
}

// ─── A rodada ───────────────────────────────────────────────────────────────

export async function rodar({
  token,
  repo,
  telegramToken,
  telegramChatId,
  resendKey,
  emailFounder,
  agora = new Date(),
  fetchImpl = fetch,
  seco = false,
} = {}) {
  const cfg = JSON.parse(readFileSync(join(AQUI, 'servicos.json'), 'utf8'));
  const resultados = await Promise.all(cfg.servicos.map((s) => sondar(s, { fetchImpl })));

  const issue = token && repo ? await acharIssue({ token, repo, fetchImpl }) : null;
  const estadoAnterior = issue ? lerEstadoDoCorpo(issue.body) : {};

  const massa = ehMaquinaInteira(resultados);
  const estados = {};
  const avisos = [];

  for (const r of resultados) {
    const d = decidir({
      dePe: r.dePe,
      estado: estadoAnterior[r.nome] || null,
      agora,
      falhasParaAlertar: cfg.falhas_para_alertar,
    });
    if (d.estado) estados[r.nome] = d.estado;
    console.log(`${r.dePe ? '🟢' : '🔴'} ${r.nome.padEnd(12)} ${d.acao.padEnd(14)} ${d.motivo}`);
    if (d.acao !== 'nada') {
      avisos.push({
        acao: d.acao,
        servico: r,
        minutosDeQueda: minutos((estadoAnterior[r.nome] || d.estado)?.desde, agora),
      });
    }
  }

  // Quando é a máquina inteira, um aviso agregado substitui os individuais.
  let mensagens;
  if (massa && avisos.some((a) => a.acao !== 'avisar-volta')) {
    const pior = avisos.find((a) => a.acao !== 'avisar-volta');
    mensagens = [{
      assunto: '🔴 agnts: a máquina inteira não responde',
      corpo: texto({
        acao: 'avisar-queda',
        servico: 'todos',
        url: resultados.filter((r) => r.critico).map((r) => r.url).join('\n'),
        minutosDeQueda: pior.minutosDeQueda,
        ultimoErro: pior.servico.erro,
        maquinaInteira: true,
      }),
    }];
  } else {
    mensagens = avisos.map((a) => ({
      assunto: a.acao === 'avisar-volta'
        ? `🟢 agnts: ${a.servico.rotulo || a.servico.nome} voltou`
        : `🔴 agnts: ${a.servico.rotulo || a.servico.nome} fora do ar`,
      corpo: texto({
        acao: a.acao,
        servico: a.servico.nome,
        rotulo: a.servico.rotulo,
        url: a.servico.url,
        minutosDeQueda: a.minutosDeQueda,
        ultimoErro: a.servico.erro,
      }),
    }));
  }

  for (const m of mensagens) {
    if (seco) { console.log(`\n--- AVISO (seco) ---\n${m.corpo}\n`); continue; }
    const tg = await falarTelegram({ token: telegramToken, chatId: telegramChatId, mensagem: m.corpo, fetchImpl });
    const em = await falarEmail({ apiKey: resendKey, para: emailFounder, assunto: m.assunto, mensagem: m.corpo, fetchImpl });
    console.log(`aviso: telegram=${tg.ok ? 'ok' : tg.erro} email=${em.ok ? 'ok' : em.erro}`);
    // Se AS DUAS bocas falharem, a execução tem que FALHAR — senão o GitHub
    // mostra verde e o aviso foi para o vazio, que é o desfecho de 26/09 outra vez.
    if (!tg.ok && !em.ok) {
      process.exitCode = 1;
      console.error('NENHUMA boca entregou o aviso. Este é o desfecho de 26/09 e a execução falha de propósito.');
    }
  }

  // Grava estado e registro.
  const temQueda = Object.keys(estados).length > 0;
  if (token && repo && !seco) {
    const corpo = montarCorpo(estados, resultados, agora);
    if (issue) {
      await gh(`/issues/${issue.number}`, {
        token, repo, metodo: 'PATCH', fetchImpl,
        corpo: { body: corpo, state: temQueda ? 'open' : 'closed' },
      });
      for (const m of mensagens) {
        await gh(`/issues/${issue.number}/comments`, { token, repo, metodo: 'POST', fetchImpl, corpo: { body: `\`${agora.toISOString()}\`\n\n${m.corpo}` } });
      }
    } else {
      // A issue nasce na PRIMEIRA execução mesmo com tudo de pé: ela é o estado,
      // e estado que só nasce no incidente significa que o primeiro incidente
      // roda sem memória — exatamente quando ela mais importa.
      const nova = await gh('/issues', {
        token, repo, metodo: 'POST', fetchImpl,
        corpo: { title: TITULO_ISSUE, body: corpo, labels: ['olho-de-fora'] },
      });
      if (!temQueda) await gh(`/issues/${nova.number}`, { token, repo, metodo: 'PATCH', fetchImpl, corpo: { state: 'closed' } });
    }
  }

  return { resultados, estados, mensagens, massa };
}

// ─── Entrada ────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const seco = process.argv.includes('--seco');
  rodar({
    token: process.env.GITHUB_TOKEN,
    repo: process.env.GITHUB_REPOSITORY,
    telegramToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    resendKey: process.env.RESEND_API_KEY,
    emailFounder: process.env.FOUNDER_EMAIL,
    seco,
  }).catch((err) => {
    console.error('olho de fora falhou:', err.message);
    process.exit(1);
  });
}
