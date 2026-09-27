// decisao.mjs — o que o olho de fora FAZ com o que viu. Função pura, sem rede.
//
// Separada do resto de propósito: a decisão é a parte que erra em silêncio e
// que ninguém consegue provar quando está grudada num fetch. Aqui ela se prova
// sem subir nada e sem depender do GitHub estar de pé.
//
// A regra, do pedido da regência de 27/09: duas falhas seguidas alertam; volta
// ao normal avisa uma vez; e NÃO repete a cada 5 min — que é o antipadrão que
// treina qualquer um a silenciar o alarme.

// Quantas falhas seguidas antes de falar. Duas, com cron de 5 min, são 10 min.
export const FALHAS_PARA_ALERTAR = 2;

// Escada de repetição do aviso, em minutos desde o primeiro. Enquanto o serviço
// segue fora, só reavisa quando cruza um destes marcos.
//
// Por que não "a cada 10 min por 1 h, depois de hora em hora" como o vigia de
// dentro: lá o intervalo é fixo e o processo é contínuo. Aqui cada execução é um
// processo novo que só sabe o que está gravado — marcos absolutos desde o início
// da queda são a única forma de não depender de contar execuções, que o GitHub
// atrasa e agrupa quando a fila dele está cheia.
export const MARCOS_MIN = [0, 10, 20, 40, 60, 120, 180, 240, 300, 360];

// O próximo marco ainda não avisado, dado quanto tempo a queda já tem.
function marcoDevido(minutosDeQueda, ultimoMarcoAvisado) {
  let devido = null;
  for (const m of MARCOS_MIN) {
    if (m <= minutosDeQueda && (ultimoMarcoAvisado === null || m > ultimoMarcoAvisado)) devido = m;
  }
  return devido;
}

/**
 * Decide o que fazer com UM serviço.
 *
 * @param {object} p
 * @param {boolean} p.dePe            o que a sonda viu AGORA
 * @param {object|null} p.estado      o que ficou gravado da execução anterior
 * @param {Date} p.agora
 * @param {number} p.falhasParaAlertar
 * @returns {{acao: 'nada'|'avisar-queda'|'reavisar'|'avisar-volta', estado: object|null, motivo: string}}
 */
export function decidir({ dePe, estado, agora = new Date(), falhasParaAlertar = FALHAS_PARA_ALERTAR }) {
  const anterior = estado || { falhasSeguidas: 0, desde: null, avisado: false, ultimoMarco: null };

  if (dePe) {
    // Voltou — mas só avisa "voltou" se alguém foi acordado. Serviço que falhou
    // uma vez e voltou na seguinte nunca gerou aviso; anunciar a volta de algo
    // que ninguém soube que caiu é ruído puro.
    if (anterior.avisado) {
      return {
        acao: 'avisar-volta',
        estado: null,
        motivo: `voltou depois de ${minutos(anterior.desde, agora)} min fora`,
      };
    }
    return { acao: 'nada', estado: null, motivo: anterior.falhasSeguidas > 0 ? 'falha isolada, já normalizou' : 'normal' };
  }

  // Está fora.
  const falhas = anterior.falhasSeguidas + 1;
  // `desde` é o instante da PRIMEIRA falha da sequência, não o do alerta. É o
  // número que o livro de disponibilidade precisa, e é diferente de quando nós
  // soubemos — a distância entre os dois é a nossa cegueira.
  const desde = anterior.desde || agora.toISOString();

  if (falhas < falhasParaAlertar) {
    return {
      acao: 'nada',
      estado: { falhasSeguidas: falhas, desde, avisado: false, ultimoMarco: null },
      motivo: `${falhas}ª falha — espero confirmar (preciso de ${falhasParaAlertar})`,
    };
  }

  const minutosDeQueda = minutos(desde, agora);

  if (!anterior.avisado) {
    return {
      acao: 'avisar-queda',
      estado: { falhasSeguidas: falhas, desde, avisado: true, ultimoMarco: 0 },
      motivo: `${falhas} falhas seguidas confirmam a queda`,
    };
  }

  const marco = marcoDevido(minutosDeQueda, anterior.ultimoMarco);
  if (marco !== null) {
    return {
      acao: 'reavisar',
      estado: { falhasSeguidas: falhas, desde, avisado: true, ultimoMarco: marco },
      motivo: `segue fora há ${minutosDeQueda} min (marco de ${marco} min)`,
    };
  }

  return {
    acao: 'nada',
    estado: { falhasSeguidas: falhas, desde, avisado: true, ultimoMarco: anterior.ultimoMarco },
    motivo: `segue fora há ${minutosDeQueda} min, sem marco novo — silêncio de propósito`,
  };
}

export function minutos(desde, ate) {
  if (!desde) return 0;
  return Math.round((new Date(ate) - new Date(desde)) / 60_000);
}

/** Texto do aviso. Direto e técnico: quem lê é o dono da casa. */
export function texto({ acao, servico, rotulo, url, minutosDeQueda, ultimoErro, maquinaInteira }) {
  const cabeca = maquinaInteira
    ? '🔴 TUDO FORA — a máquina inteira não responde'
    : acao === 'avisar-volta'
      ? `🟢 ${rotulo || servico}: VOLTOU`
      : `🔴 ${rotulo || servico}: FORA DO AR`;

  const linhas = [cabeca, ''];

  if (acao === 'avisar-volta') {
    linhas.push(`Ficou ${minutosDeQueda} min fora. ${url}`);
    linhas.push('');
    linhas.push('Visto de fora da nossa máquina (GitHub Actions).');
    return linhas.join('\n');
  }

  linhas.push(`${url}`);
  linhas.push(`Fora há ${minutosDeQueda} min (confirmado por 2 verificações seguidas).`);
  if (ultimoErro) linhas.push(`Último erro: ${ultimoErro}`);
  linhas.push('');
  if (maquinaInteira) {
    linhas.push('NENHUM serviço responde — isto é a VM ou a rede, não um app.');
    linhas.push('O vigia de dentro e a autocura estão indisponíveis junto.');
  } else {
    linhas.push('Visto de FORA da nossa máquina. O vigia de dentro pode estar tentando curar.');
  }
  return linhas.join('\n');
}

/**
 * Quando TODOS os serviços caem juntos, não são N problemas — é um.
 * Um aviso agregado em vez de cinco, pela mesma razão que o vigia de dentro
 * agrega queda em massa: cinco mensagens no celular de madrugada não são cinco
 * vezes mais informação, são cinco vezes mais chance de você ignorar.
 */
export function ehMaquinaInteira(resultados) {
  const criticos = resultados.filter((r) => r.critico);
  return criticos.length >= 2 && criticos.every((r) => !r.dePe);
}
