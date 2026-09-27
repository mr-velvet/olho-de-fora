# olho de fora

Vigia os serviços críticos da [agnts](https://agnts.did.lu) **de fora da máquina deles**, a cada 5 minutos, pelo GitHub Actions.

## Por que existe

Em 26/09/2026 o Hub da agnts ficou **2h19 fora do ar** por uma publicação que subiu uma imagem que não liga. Ninguém foi avisado — e não por falta de vigia. O vigia da casa detectou a queda em 3 minutos e tentou avisar **28 vezes pelo próprio Hub caído**. O alarme tocou dentro do prédio em chamas e o som não passou da parede.

Depois daquilo a casa ganhou três coisas: um vigia com saída própria de emergência, autocura com limites contados, e um livro de disponibilidade. As três moram **dentro da VM**. Se a VM inteira desaparecer — pane, rede, zona — as três somem juntas e o silêncio de duas horas volta por outro caminho.

Este repositório é a peça que não compartilha o destino do que vigia.

## Como funciona

Um workflow agendado faz `GET` em cada serviço listado em [`servicos.json`](servicos.json), como um cliente faria.

- **Duas falhas seguidas** (10 min) confirmam a queda e disparam o aviso. Uma só não alerta: o runner do GitHub roda em rede compartilhada e um timeout isolado é ruído, não incidente.
- O aviso sai pelo **Telegram e por e-mail**, independentes, direto pelas APIs — sem passar por nada da agnts, que é justamente o que pode estar fora.
- Depois do primeiro aviso, a repetição segue uma **escada de marcos** (10, 20, 40, 60 min, depois de hora em hora até 6 h) e **para**. Alarme que repete a cada 5 minutos é alarme que se aprende a silenciar — e aí não existe mais.
- Quando normaliza, sai **um aviso de volta**. Quem foi acordado precisa saber que acabou.
- Quando **todos** os críticos caem juntos, sai **um** aviso agregado em vez de cinco. Cinco mensagens de madrugada não são cinco vezes mais informação.

O estado vive numa **issue** deste repositório (`🩺 olho de fora — estado dos serviços críticos`), que também é o registro: aberta quando há queda, fechada quando tudo normaliza. O estado aberto/fechado da issue é, ele mesmo, a resposta para "estamos bem?".

`200` não é o mesmo que "funcionando": para o Hub o olho confere que o corpo traz `"ok":true`, porque um proxy de pé devolvendo a própria página de erro responde 200 com o app morto por trás.

## O que ele NÃO faz, de propósito

**Não cura.** Curar exige poder sobre a máquina, e dar esse poder a um workflow é a troca errada. O vigia de dentro cura, com privilégio mínimo e limites contados; este só enxerga e fala.

## Por que é público

Em repositório público o GitHub Actions é ilimitado e gratuito. Em privado a cota é 2.000 min/mês e o GitHub cobra por minuto **iniciado** — um job de 25 s a cada 5 min custa 8.640 min/mês, 4,3x a cota, e nenhum intervalo útil cabe. A régua era custo zero, então mudou a casa, não o intervalo.

E pode ser público sem custo de segredo: aqui há uma lista de URLs que já são públicas e a lógica de quando avisar. As credenciais moram em secrets, que o GitHub não expõe nem em pull request de fora.

## Mexer

```bash
node --test .              # as regras do aviso, sem rede e sem banco
node olho.mjs --seco       # sondar de verdade e imprimir, sem avisar ninguém
```

Trocar quem é vigiado é mexer em [`servicos.json`](servicos.json) — não no workflow.

## Segredos

| segredo | o que é |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | o bot que fala com o founder |
| `TELEGRAM_CHAT_ID` | o chat dele |
| `RESEND_API_KEY` | a chave de envio de e-mail do agnts |
| `FOUNDER_EMAIL` | para onde o e-mail vai |
