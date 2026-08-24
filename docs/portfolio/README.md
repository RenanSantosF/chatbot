# Portfólio

`portfolio-sistemas.pdf` — as duas folhas: Devolução Inteligente (veio pronta,
não foi tocada) e Inteliwa.

## Como refazer a folha do Inteliwa

`pagina.html` é a fonte. As posições dela saíram da extração do PDF original
(pypdf, `extract_text` com visitor pra pegar coordenada e tamanho de cada
trecho), pra a folha nova cair na mesma grade da que já existia: margem de
52,9px, faixa escura de 267px no rodapé, e a métrica de 794×1123px que é o A4
a 96dpi. As cores são as do original, lidas dos operadores `rg` do fluxo de
conteúdo.

O print é capturado da aplicação rodando de verdade, não é maquete. Dele saem
duas coisas por edição: a faixa vermelha de "WhatsApp desconectado", que só
existe porque o ambiente de preview não tem número ligado, e o botão flutuante
do copiloto, que cobria o canto. O resto é a tela como ela é.

```sh
# 1. subir a aplicação e criar dados de exemplo (ver scripts/dev-preview.sh)
# 2. capturar o print e montar o PDF
node /tmp/preview-tools/hero.mjs "$TOKEN"     # -> hero.png
python3 -c "import base64; ..."               # embute a imagem no HTML
node /tmp/preview-tools/pdf.mjs               # -> inteliwa.pdf
```

A junção usa pypdf e reescala a folha nova pros 594,96×841,92pt exatos da
original — sem isso o PDF fica com páginas de tamanho levemente diferente e
alguns leitores trocam o zoom ao virar a folha.

## Os números da folha, e de onde vêm

- **910 testes**: 886 do `apps/api` (jest) + 24 do `apps/web` (vitest).
- **6 ferramentas da IA**: `ai-tools.service.ts` — buscar cliente, criar
  tarefa, transferir, encerrar, lembrar dados, coletar dados.
- **teto de 30 abordagens/dia**: `TETO_DE_ABORDAGENS_POR_DIA` em
  `conversations.service.ts`.

Se algum desses mudar, a folha mente. Conferir antes de reenviar.
