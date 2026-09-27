import test from 'node:test';
import assert from 'node:assert/strict';
import { decidir, texto, ehMaquinaInteira, MARCOS_MIN } from './decisao.mjs';

const T0 = new Date('2026-09-27T03:00:00Z');
const mais = (min) => new Date(T0.getTime() + min * 60_000);

test('primeira falha NÃO alerta — falha isolada é ruído, não incidente', () => {
  const d = decidir({ dePe: false, estado: null, agora: T0 });
  assert.equal(d.acao, 'nada');
  assert.equal(d.estado.falhasSeguidas, 1);
  assert.equal(d.estado.avisado, false);
});

test('segunda falha seguida alerta', () => {
  const um = decidir({ dePe: false, estado: null, agora: T0 });
  const dois = decidir({ dePe: false, estado: um.estado, agora: mais(5) });
  assert.equal(dois.acao, 'avisar-queda');
  assert.equal(dois.estado.avisado, true);
});

test('falha isolada seguida de normal não gera aviso nenhum — nem de queda nem de volta', () => {
  const um = decidir({ dePe: false, estado: null, agora: T0 });
  const volta = decidir({ dePe: true, estado: um.estado, agora: mais(5) });
  assert.equal(volta.acao, 'nada');
  assert.equal(volta.estado, null, 'e o estado tem que ser limpo, senão a próxima falha alerta na primeira');
});

test('o `desde` é a PRIMEIRA falha, não o momento do alerta — é a cegueira que o livro mede', () => {
  const um = decidir({ dePe: false, estado: null, agora: T0 });
  const dois = decidir({ dePe: false, estado: um.estado, agora: mais(5) });
  assert.equal(dois.estado.desde, T0.toISOString());
});

test('NÃO repete a cada execução — o antipadrão que treina a ignorar o alarme', () => {
  let e = decidir({ dePe: false, estado: null, agora: T0 }).estado;
  const d2 = decidir({ dePe: false, estado: e, agora: mais(5) });
  assert.equal(d2.acao, 'avisar-queda');
  e = d2.estado;

  // 5 min depois do aviso: nada (marco de 10 ainda não chegou).
  const d3 = decidir({ dePe: false, estado: e, agora: mais(10) });
  assert.equal(d3.acao, 'reavisar', 'aos 10 min desde a queda o marco de 10 vence');
  e = d3.estado;

  const d4 = decidir({ dePe: false, estado: e, agora: mais(15) });
  assert.equal(d4.acao, 'nada', 'entre marcos, silêncio');
});

test('a escada é de marcos absolutos e cada marco fala UMA vez', () => {
  let e = decidir({ dePe: false, estado: null, agora: T0 }).estado;
  e = decidir({ dePe: false, estado: e, agora: mais(5) }).estado; // avisou, marco 0

  const avisos = [];
  // Simula o olho de fora rodando de 5 em 5 min por 7 horas sobre um serviço
  // que nunca volta. É o equivalente da prova do não-laço da autocura.
  for (let min = 10; min <= 420; min += 5) {
    const d = decidir({ dePe: false, estado: e, agora: mais(min) });
    if (d.acao === 'reavisar') avisos.push(d.estado.ultimoMarco);
    e = d.estado;
  }

  // Sem repetição: cada marco aparece no máximo uma vez.
  assert.deepEqual(avisos, [...new Set(avisos)], 'nenhum marco pode falar duas vezes');
  // E o total é limitado pelo tamanho da escada, não pelo tempo.
  assert.ok(avisos.length <= MARCOS_MIN.length, `${avisos.length} avisos em 7h, escada tem ${MARCOS_MIN.length}`);
  assert.ok(avisos.length >= 5, 'mas fala o suficiente para não ser esquecido');
});

test('em 7 horas fora, no máximo 10 avisos — e depois silêncio absoluto', () => {
  let e = decidir({ dePe: false, estado: null, agora: T0 }).estado;
  e = decidir({ dePe: false, estado: e, agora: mais(5) }).estado;
  let total = 1; // o aviso de queda

  for (let min = 10; min <= 1440; min += 5) { // 24 horas
    const d = decidir({ dePe: false, estado: e, agora: mais(min) });
    if (d.acao !== 'nada') total += 1;
    e = d.estado;
  }
  assert.ok(total <= MARCOS_MIN.length, `${total} avisos em 24h fora — teto é ${MARCOS_MIN.length}`);

  // Depois do último marco, NADA. Nem mais um, por mais 24h.
  for (let min = 1445; min <= 2880; min += 5) {
    const d = decidir({ dePe: false, estado: e, agora: mais(min) });
    assert.equal(d.acao, 'nada', `aviso indevido em ${min} min`);
    e = d.estado;
  }
});

test('voltou depois de avisado: avisa a volta e limpa o estado', () => {
  let e = decidir({ dePe: false, estado: null, agora: T0 }).estado;
  e = decidir({ dePe: false, estado: e, agora: mais(5) }).estado;
  const v = decidir({ dePe: true, estado: e, agora: mais(30) });
  assert.equal(v.acao, 'avisar-volta');
  assert.match(v.motivo, /30 min/);
  assert.equal(v.estado, null);
});

test('depois da volta, o próximo incidente precisa de 2 falhas de novo', () => {
  let e = decidir({ dePe: false, estado: null, agora: T0 }).estado;
  e = decidir({ dePe: false, estado: e, agora: mais(5) }).estado;
  e = decidir({ dePe: true, estado: e, agora: mais(30) }).estado;
  const nova = decidir({ dePe: false, estado: e, agora: mais(60) });
  assert.equal(nova.acao, 'nada', 'estado limpo = a primeira falha volta a ser só uma falha');
});

test('execução perdida pelo GitHub não quebra a escada — marcos são absolutos', () => {
  // O GitHub atrasa e agrupa cron quando a fila está cheia. Se a escada
  // contasse EXECUÇÕES, um salto de 40 min pularia marcos e o aviso sairia
  // errado. Contando minutos desde a queda, ele acerta.
  let e = decidir({ dePe: false, estado: null, agora: T0 }).estado;
  e = decidir({ dePe: false, estado: e, agora: mais(5) }).estado;
  const salto = decidir({ dePe: false, estado: e, agora: mais(65) });
  assert.equal(salto.acao, 'reavisar');
  assert.equal(salto.estado.ultimoMarco, 60, 'pega o marco mais alto vencido, não o próximo da lista');
});

test('queda em massa dos críticos vira UM aviso, não cinco', () => {
  const todosFora = [
    { nome: 'agnts', critico: true, dePe: false },
    { nome: 'conversa', critico: true, dePe: false },
    { nome: 'tt', critico: true, dePe: false },
    { nome: 'saude', critico: false, dePe: false },
  ];
  assert.equal(ehMaquinaInteira(todosFora), true);

  const umFora = [
    { nome: 'agnts', critico: true, dePe: false },
    { nome: 'conversa', critico: true, dePe: true },
  ];
  assert.equal(ehMaquinaInteira(umFora), false);

  // Um crítico só fora não é "a máquina inteira" — senão um app de cliente
  // sozinho no ar geraria o alarme mais grave que existe.
  assert.equal(ehMaquinaInteira([{ nome: 'agnts', critico: true, dePe: false }]), false);
});

test('o texto do aviso traz o erro junto — em 26/09 a causa estava na primeira linha e ninguém leu', () => {
  const t = texto({
    acao: 'avisar-queda',
    servico: 'agnts',
    rotulo: 'a plataforma (Hub)',
    url: 'https://agnts.did.lu/api/health',
    minutosDeQueda: 10,
    ultimoErro: 'HTTP 502',
  });
  assert.match(t, /FORA DO AR/);
  assert.match(t, /10 min/);
  assert.match(t, /HTTP 502/);
  assert.match(t, /agnts\.did\.lu/);
});

test('o texto da máquina inteira diz que a autocura sumiu junto', () => {
  const t = texto({ acao: 'avisar-queda', servico: 'agnts', url: 'x', minutosDeQueda: 10, maquinaInteira: true });
  assert.match(t, /máquina inteira/);
  assert.match(t, /autocura/);
});
