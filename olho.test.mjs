import test from 'node:test';
import assert from 'node:assert/strict';
import { sondar, lerEstadoDoCorpo, montarCorpo, falarTelegram, falarEmail } from './olho.mjs';

const resposta = (status, corpo = '') => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => corpo,
});

test('sondar: 200 com o trecho esperado é de pé', async () => {
  const r = await sondar(
    { nome: 'agnts', url: 'https://x/health', esperado: 200, contem: '"ok":true' },
    { fetchImpl: async () => resposta(200, '{"ok":true,"t":"..."}') },
  );
  assert.equal(r.dePe, true);
});

test('sondar: 200 SEM o trecho esperado é FORA — responder não é funcionar', async () => {
  // O caso real: o Caddy de pé devolvendo a página de erro dele com 200
  // enquanto o app por trás está morto. Sem a checagem de corpo, isso é verde.
  const r = await sondar(
    { nome: 'agnts', url: 'https://x/health', esperado: 200, contem: '"ok":true' },
    { fetchImpl: async () => resposta(200, '<html>erro</html>') },
  );
  assert.equal(r.dePe, false);
  assert.match(r.erro, /sem "/);
});

test('sondar: 502 é fora, com o código no erro — foi o que o Caddy devolveu 204 vezes em 26/09', async () => {
  const r = await sondar({ nome: 'agnts', url: 'https://x', esperado: 200 }, { fetchImpl: async () => resposta(502) });
  assert.equal(r.dePe, false);
  assert.equal(r.erro, 'HTTP 502');
});

test('sondar: rede caída não estoura — vira erro em texto', async () => {
  const r = await sondar({ nome: 'agnts', url: 'https://x' }, {
    fetchImpl: async () => { throw new Error('fetch failed'); },
  });
  assert.equal(r.dePe, false);
  assert.match(r.erro, /fetch failed/);
});

test('sondar: timeout é fora, não travado para sempre', async () => {
  const r = await sondar({ nome: 'agnts', url: 'https://x' }, {
    fetchImpl: async () => { const e = new Error('abort'); e.name = 'AbortError'; throw e; },
  });
  assert.equal(r.dePe, false);
  assert.match(r.erro, /sem resposta/);
});

test('o estado sobrevive à ida e volta pelo corpo da issue', () => {
  const estados = { agnts: { falhasSeguidas: 3, desde: '2026-09-27T03:00:00.000Z', avisado: true, ultimoMarco: 20 } };
  const corpo = montarCorpo(estados, [{ nome: 'agnts', rotulo: 'o Hub', dePe: false, erro: 'HTTP 502' }], new Date('2026-09-27T03:25:00Z'));
  assert.deepEqual(lerEstadoDoCorpo(corpo), estados);
});

test('corpo de issue sem marca nenhuma lê como estado vazio, não estoura', () => {
  assert.deepEqual(lerEstadoDoCorpo('texto qualquer que alguém editou à mão'), {});
  assert.deepEqual(lerEstadoDoCorpo(null), {});
  assert.deepEqual(lerEstadoDoCorpo('<!-- estado-olho-de-fora {lixo -->'), {});
});

test('o corpo da issue mostra o erro e o tempo fora para quem lê às 3h', () => {
  const corpo = montarCorpo(
    { agnts: { desde: '2026-09-27T03:00:00.000Z', avisado: true } },
    [{ nome: 'agnts', rotulo: 'a plataforma (Hub)', dePe: false, erro: 'HTTP 502' }],
    new Date('2026-09-27T03:25:00Z'),
  );
  assert.match(corpo, /HTTP 502/);
  assert.match(corpo, /25 min/);
});

test('sem credencial, a boca RECUSA em vez de fingir que falou', async () => {
  assert.equal((await falarTelegram({ token: null, chatId: '1', mensagem: 'x' })).ok, false);
  assert.equal((await falarTelegram({ token: 'a', chatId: null, mensagem: 'x' })).ok, false);
  assert.equal((await falarEmail({ apiKey: null, para: 'a@b.c' })).ok, false);
  assert.equal((await falarEmail({ apiKey: 'k', para: null })).ok, false);
});

test('Telegram que responde erro não vira sucesso', async () => {
  const r = await falarTelegram({
    token: 't', chatId: 'c', mensagem: 'x',
    fetchImpl: async () => resposta(401, '{"description":"Unauthorized"}'),
  });
  assert.equal(r.ok, false);
  assert.match(r.erro, /401/);
});

test('e-mail sai com o remetente do agnts e o texto inteiro', async () => {
  let visto = null;
  await falarEmail({
    apiKey: 'k', para: 'founder@x.com', assunto: 'A', mensagem: 'B',
    fetchImpl: async (_u, o) => { visto = JSON.parse(o.body); return resposta(200, '{}'); },
  });
  assert.equal(visto.from, 'Agnts <agnts@did.lu>');
  assert.deepEqual(visto.to, ['founder@x.com']);
  assert.equal(visto.subject, 'A');
  assert.equal(visto.text, 'B');
});
