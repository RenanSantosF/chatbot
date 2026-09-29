import {
  Ban,
  Check,
  CheckCheck,
  Forward,
  Reply,
  SmilePlus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { resumoDaMensagem } from "@/lib/mensagem";
import { MessageAttachment } from "./message-attachment";
import type { ConversationMessage, MessageStatus } from "@/lib/types";

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Tiques no padrão do WhatsApp: um tique = saiu daqui, dois tiques = chegou
 * no aparelho, dois tiques azuis = o cliente leu. Só aparece em mensagem que
 * a empresa mandou — mensagem de cliente não tem status de entrega nosso.
 */
function DeliveryTicks({ status, motivo }: { status: MessageStatus; motivo?: string }) {
  if (status === "FAILED") {
    return (
      <span
        title={motivo ? `Não entregue: ${motivo}` : "Falha ao entregar"}
        className="text-destructive"
      >
        <TriangleAlert className="size-3.5" />
      </span>
    );
  }

  if (status === "PENDING") {
    return (
      <span title="Enviando" className="opacity-70">
        <Check className="size-3.5 opacity-50" />
      </span>
    );
  }

  if (status === "SENT") {
    return (
      <span title="Enviada" className="opacity-70">
        <Check className="size-3.5" />
      </span>
    );
  }

  return (
    <span
      title={status === "READ" ? "Lida" : "Entregue"}
      className={cn(status === "READ" ? "text-sky-500" : "opacity-60")}
    >
      <CheckCheck className="size-3.5" />
    </span>
  );
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "🙏"];

/** O "1" num círculo tracejado, o mesmo sinal que o WhatsApp usa. */
function IconeDeVisualizacaoUnica({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <circle
        cx="12"
        cy="12"
        r="9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeDasharray="44 4"
        strokeLinecap="round"
      />
      <path
        d="M10.6 9.2 12.6 8v8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const NOME_DA_VISUALIZACAO_UNICA = { IMAGE: "uma foto", VIDEO: "um vídeo", AUDIO: "um áudio" };

/** O aviso no lugar do conteúdo, nas palavras do WhatsApp. */
function avisoDeVisualizacaoUnica(tipo: "IMAGE" | "VIDEO" | "AUDIO", recebida: boolean) {
  const oQue = NOME_DA_VISUALIZACAO_UNICA[tipo] ?? "uma mensagem";
  return recebida
    ? `Você recebeu ${oQue} de visualização única. Por privacidade, só dá pra abrir no seu celular.`
    : `Você enviou ${oQue} de visualização única pelo celular.`;
}

/**
 * O visual dos botões da barra que flutua sobre o balão.
 *
 * Alvo de 28px com ícone de 16 dentro: dá pra acertar com o mouse sem que
 * quatro botões coloridos disputem atenção com a conversa. A cor é apagada
 * em repouso e só firma no hover — em repouso eles são atalhos, não parte
 * da mensagem.
 */
const ACAO_DA_BARRA =
  "flex size-7 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground";

/**
 * O botão de reagir, e as carinhas atrás dele.
 *
 * Antes os cinco emojis coloridos apareciam de uma vez ao passar o mouse.
 * Cinco figuras coloridas pulando em cima de cada balão viram festa visual
 * numa tela que a pessoa encara o dia inteiro, e o alvo real — responder,
 * encaminhar, apagar — ficava espremido do lado delas.
 *
 * Agora é o caminho do WhatsApp Web: passa o mouse e aparece uma carinha
 * discreta; quem quer reagir clica nela e escolhe. Um passo a mais para
 * quem reage, silêncio para quem não vai reagir — que é a maioria das
 * vezes que o mouse passa por cima de um balão.
 */
function BotaoDeReagir({
  onPick,
  alinharADireita,
}: {
  onPick: (emoji: string) => void;
  alinharADireita: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!aberto) return;

    const foraDaqui = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setAberto(false);
    };
    const noEsc = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Na captura, pra o Esc não fechar a conversa junto da tira de
      // reações (mesma mecânica do seletor de etiquetas).
      event.stopPropagation();
      setAberto(false);
    };

    document.addEventListener("mousedown", foraDaqui);
    document.addEventListener("keydown", noEsc, true);
    return () => {
      document.removeEventListener("mousedown", foraDaqui);
      document.removeEventListener("keydown", noEsc, true);
    };
  }, [aberto]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        title="Reagir"
        aria-label="Reagir a esta mensagem"
        aria-expanded={aberto}
        onClick={() => setAberto((estava) => !estava)}
        className={cn(
          "flex size-7 items-center justify-center rounded-full transition-colors",
          aberto
            ? "bg-muted text-foreground"
            : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
        )}
      >
        <SmilePlus className="size-4" />
      </button>

      {aberto ? (
        <div
          className={cn(
            "reacoes-abrindo absolute bottom-full z-20 mb-2 flex items-center gap-0.5 rounded-full border bg-popover p-1 shadow-[0_4px_16px_oklch(0_0_0/20%)]",
            alinharADireita ? "right-0" : "left-0",
          )}
        >
          {QUICK_REACTIONS.map((emoji, indice) => (
            <button
              key={emoji}
              type="button"
              title={`Reagir com ${emoji}`}
              onClick={() => {
                onPick(emoji);
                setAberto(false);
              }}
              // O escalonamento da entrada é dado aqui, e não no CSS: são
              // cinco itens fixos, e uma variável por índice seria mais
              // código que o próprio atraso.
              style={{ animationDelay: `${indice * 22}ms` }}
              className="emoji-entrando group/emoji flex size-8 items-center justify-center rounded-full transition-colors hover:bg-muted"
            >
              {/* 24px inteiro e SEM escalar no hover: a fonte de emoji do
                  Windows é bitmap, e qualquer `scale` reescala o desenho —
                  era daí que vinha o serrilhado. O destaque agora é o
                  círculo atrás, que é vetor e amplia limpo. */}
              <span className="emoji text-[24px] transition-transform duration-150 group-hover/emoji:-translate-y-0.5">
                {emoji}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Pinta os trechos que casam com a busca. Divide pelo termo em vez de usar
 * innerHTML: o conteúdo vem do cliente e não pode virar marcação.
 */
function Highlighted({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={index} className="rounded-xs bg-amber-300/70 text-inherit dark:bg-amber-400/40">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

/**
 * O espaço que a hora ocupa no fim da última linha do texto.
 *
 * É o truque do WhatsApp: a hora não ganha uma linha só pra ela. Um
 * espaço invisível do tamanho dela entra no fim do texto; se couber na
 * última linha, a hora se encaixa ali, ao lado da última palavra; se não
 * couber, o espaço quebra pra baixo e leva a hora junto. Uma linha a
 * menos em quase todo balão — é daí que vem boa parte da diferença de
 * altura entre uma conversa aqui e lá.
 */
function larguraDaHora(message: ConversationMessage, fromCustomer: boolean) {
  let largura = 40; // "14:05" + folga até a última palavra
  if (!fromCustomer) largura += 18; // tiques
  if (message.senderType === "AI") largura += 16; // "IA"
  return largura;
}

/**
 * Memorizado: a conversa aberta é redesenhada a cada mensagem nova, tique
 * de entrega ou tecla no campo de texto — e sem isto cada uma dessas
 * redesenhava TODOS os balões da conversa, o que numa conversa longa
 * aberta o dia inteiro é o que faz o digitar começar a atrasar.
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  inicioDoGrupo = true,
  animar = false,
  highlight = "",
  isCurrentMatch = false,
  onReply,
  onReact,
  onForward,
  onDelete,
  autorDaCitada = "Cliente",
  onIrParaCitada,
}: {
  message: ConversationMessage;
  /**
   * Primeira de uma sequência do mesmo remetente. Só ela leva o nome de
   * quem escreveu e o canto "de bico"; as seguintes grudam nela, como no
   * WhatsApp — o nome repetido em cada balão era ruído, não informação.
   */
  inicioDoGrupo?: boolean;
  /**
   * Anima a entrada do balão. Só vale pra mensagem que chegou com a
   * conversa já aberta: animar o histórico inteiro na abertura fazia a tela
   * parecer que estava rolando sozinha.
   */
  animar?: boolean;
  /** Termo buscado na conversa, pra pintar dentro do balão. */
  highlight?: string;
  /** Resultado em foco na navegação da busca. */
  isCurrentMatch?: boolean;
  onReply?: (message: ConversationMessage) => void;
  onReact?: (messageId: string, emoji: string) => Promise<void>;
  onForward?: (message: ConversationMessage) => void;
  onDelete?: (message: ConversationMessage) => void;
  /** Quem escreveu a mensagem citada — o nome do contato como está salvo, ou "Você". */
  autorDaCitada?: string;
  /** Clique na citação: leva até a mensagem original. */
  onIrParaCitada?: (messageId: string) => void;
}) {
  // Apagada: sobra a tarja. Ocupa o mesmo lugar na linha do tempo, porque
  // sumir por completo faria a conversa mentir sobre o que aconteceu — quem
  // lê depois veria um pulo sem explicação.
  if (message.deletedAt) {
    return (
      <div
        data-message-id={message.id}
        className={cn(
          "flex max-w-[75%] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] italic",
          message.senderType === "CUSTOMER"
            ? "self-start bg-bubble-in/60 text-muted-foreground"
            : "self-end bg-bubble-out/50 text-bubble-out-foreground/70",
        )}
      >
        <Ban className="size-3.5 shrink-0" />
        Mensagem apagada
        <span className="ml-1 text-[11px] not-italic opacity-70">
          {timeLabel(message.createdAt)}
        </span>
      </div>
    );
  }

  // Aviso do sistema: "Fulano assumiu", "encaminhada para o Financeiro". Usa
  // a mesma tarja do separador de dia de propósito — os dois são marcos na
  // linha do tempo, não fala de ninguém, e ler igual ajuda a bater o olho e
  // entender por que a conversa mudou de mão.
  if (message.senderType === "SYSTEM") {
    return (
      <div className="flex justify-center py-1.5">
        <span className="max-w-[80%] rounded-full bg-bubble-in px-3 py-1 text-center text-xs font-medium text-muted-foreground shadow-xs">
          {message.content}
        </span>
      </div>
    );
  }

  const fromCustomer = message.senderType === "CUSTOMER";
  /*
   * Figurinha não usa balão.
   *
   * É como o WhatsApp faz, e não é capricho: figurinha tem fundo
   * transparente, e o retângulo colorido atrás dela anulava a
   * transparência inteira — a carinha vinha recortada num quadrado verde.
   * Sem o balão, o papel de parede aparece através dela, que é o efeito
   * que ela foi desenhada pra ter.
   *
   * A hora e os tiques continuam, soltos embaixo: sem eles não dá pra
   * saber se a figurinha saiu.
   */
  const figurinha =
    message.messageType === "IMAGE" &&
    !message.deletedAt &&
    (message.metadata?.mimeType?.startsWith("image/webp") ?? false);
  /*
   * Foto vai quase encostada na borda do balão.
   *
   * Com o recuo normal de texto em volta, o verde fazia uma moldura
   * grossa — mais grossa, proporcionalmente, quanto menor a foto. O resto
   * do balão (nome, legenda, hora) ganha o recuo de volta em cada linha.
   */
  const foto =
    (message.messageType === "IMAGE" || message.messageType === "VIDEO") &&
    !message.deletedAt &&
    !figurinha;
  const recuo = foto ? "px-1.5" : undefined;
  const unica = message.metadata?.visualizacaoUnica;
  const temTexto =
    Boolean(message.content) && message.messageType !== "LOCATION" && !unica;
  /*
   * Onde a hora vai:
   *   - no fim do texto, quando há texto (ver `larguraDaHora`);
   *   - por cima da foto sem legenda, no canto, como no WhatsApp;
   *   - numa linha própria no resto (áudio, documento, figurinha).
   */
  const horaNoTexto = (temTexto || Boolean(unica)) && !figurinha;
  // Só na foto: no vídeo o canto de baixo é da barra de controles.
  const horaSobreAFoto = foto && !temTexto && message.messageType === "IMAGE";
  const reactions = Object.entries(message.reactions ?? {}).filter(
    ([, who]) => Array.isArray(who) && who.length > 0,
  );

  return (
    <div
      data-message-id={message.id}
      className={cn(
        // `select-text` devolve a seleção AQUI dentro: a faixa ao redor tem
        // `select-none` pra o duplo clique no vazio não selecionar o texto
        // do balão vizinho (e o navegador não abrir o menu dele por cima).
        // Dentro da mensagem, copiar continua sendo o gesto normal.
        "group/msg relative flex max-w-[85%] min-w-0 flex-col select-text md:max-w-[75%] 2xl:max-w-[65%]",
        fromCustomer ? "self-start" : "self-end",
        isCurrentMatch && "rounded-lg ring-2 ring-amber-400/70",
      )}
    >
      {onReply || onReact || onForward || onDelete ? (
        <div
          className={cn(
            // Fica inteiro acima do balão (bottom-full), não por cima dele.
            // Sem borda: a sombra já destaca, e o traço em volta de um menu
            // pequeno vira moldura. Emoji em 20px porque abaixo disso o
            // navegador rasteriza a fonte de emoji e ela sai serrilhada.
            // `focus-within` também segura a barra visível: sem ele, abrir
            // o seletor de reação e mover o mouse pra escolher fazia a
            // barra inteira sumir junto com ele.
            "pointer-events-none absolute bottom-full z-10 mb-1 flex items-center gap-0.5 rounded-full border bg-popover/95 p-0.5 opacity-0 shadow-[0_2px_10px_oklch(0_0_0/14%)] backdrop-blur-sm transition-opacity group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100",
            // Invisível também não pode ser clicável: com os balões
            // grudados, a barra (escondida) do balão de baixo ficava por
            // cima do de cima e roubava o clique nele.
            fromCustomer ? "left-2" : "right-2",
          )}
        >
          {onReact ? (
            <BotaoDeReagir
              alinharADireita={!fromCustomer}
              onPick={(emoji) => void onReact(message.id, emoji)}
            />
          ) : null}
          {onReply ? (
            <button
              type="button"
              title="Responder"
              aria-label="Responder esta mensagem"
              onClick={() => onReply(message)}
              className={ACAO_DA_BARRA}
            >
              <Reply className="size-4" />
            </button>
          ) : null}
          {onForward ? (
            <button
              type="button"
              title="Encaminhar"
              aria-label="Encaminhar esta mensagem"
              onClick={() => onForward(message)}
              className={ACAO_DA_BARRA}
            >
              <Forward className="size-4" />
            </button>
          ) : null}
          {/* Só no que a empresa mandou. Apagar fala do cliente seria
              adulterar o registro do que ele disse — e é justamente esse
              registro que protege a empresa numa reclamação. */}
          {onDelete && !fromCustomer ? (
            <button
              type="button"
              title="Apagar"
              aria-label="Apagar esta mensagem"
              onClick={() => onDelete(message)}
              className={cn(ACAO_DA_BARRA, "hover:text-destructive")}
            >
              <Trash2 className="size-4" />
            </button>
          ) : null}
        </div>
      ) : null}

    <div
      className={cn(
        // Sombra rasa e anel finíssimo: o balão precisa se destacar do
        // papel de parede sem parecer um cartão empilhado. O verde de saída
        // no escuro é dessaturado de propósito — o verde cheio do app
        // brigava com o cinza da interface.
        // cursor-text: a linha em volta é clicável pra responder e usa
        // cursor-pointer; dentro do balão o cursor volta ao de texto pra não
        // parecer que o texto não pode ser selecionado.
        //
        // As medidas são as do WhatsApp Web: 14,5px com entrelinha de 19px,
        // recuo de 6 a 9px e canto de 8px. Antes eram 15px com entrelinha
        // de 24px e recuo de 14px — a mesma conversa ocupava quase o dobro
        // da altura.
        "relative flex min-w-0 cursor-text flex-col gap-0.5 overflow-hidden text-[14.5px] leading-[19px]",
        figurinha
          ? "items-start"
          : cn(
              "rounded-lg shadow-[0_1px_0.5px_oklch(0_0_0/13%)]",
              foto ? "p-1" : "pt-1.5 pr-[7px] pb-2 pl-[9px]",
              fromCustomer
                ? cn("bg-bubble-in text-bubble-in-foreground", inicioDoGrupo && "rounded-tl-[3px]")
                : cn("bg-bubble-out text-bubble-out-foreground", inicioDoGrupo && "rounded-tr-[3px]"),
            ),
        animar &&
          (fromCustomer
            ? "duration-200 ease-out animate-in fade-in slide-in-from-left-2"
            : "duration-200 ease-out animate-in fade-in slide-in-from-right-2"),
      )}
    >
      {/* Quem respondeu, em negrito no topo do balão. Numa conversa que
          passou por três pessoas o balão verde sozinho não conta a
          história: quem lê depois não sabe quem prometeu o quê. */}
      {message.senderName && inicioDoGrupo ? (
        <span className={cn("text-[12.5px] leading-[18px] font-medium text-bubble-out-foreground/75", recuo)}>
          {message.senderName}
        </span>
      ) : null}

      {/* Quem falou, dentro de um GRUPO.

          Sem isto a conversa de grupo é ilegível: quinze mensagens de gente
          diferente, todas do mesmo lado do balão, sem nada dizendo quem
          disse o quê. Cor da marca e não a do texto, como o WhatsApp faz —
          é uma etiqueta de autoria, não conteúdo da mensagem.

          Só nas recebidas: o que a empresa manda sai pelo painel e já tem o
          `senderName` acima dizendo qual atendente escreveu. */}
      {fromCustomer && message.metadata?.participante && inicioDoGrupo ? (
        <span className={cn("text-[12.5px] leading-[18px] font-medium text-primary", recuo)}>
          {message.metadata.participante}
        </span>
      ) : null}

      {message.replyTo ? (
        // Botão: clicar leva até a original (ver irParaMensagem no
        // ChatPanel). Citação de mensagem apagada também leva — a tarja
        // "Mensagem apagada" continua no lugar dela na conversa.
        <button
          type="button"
          onClick={() => message.replyTo && onIrParaCitada?.(message.replyTo.id)}
          disabled={!onIrParaCitada}
          title="Ir para a mensagem"
          className={cn(
            "mb-1 min-w-0 cursor-pointer rounded-md border-l-2 px-2 py-1 text-left text-xs transition-colors disabled:cursor-default",
            foto && "mb-0.5",
            fromCustomer
              ? "border-primary/60 bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
              : "border-primary-foreground/60 bg-black/10 hover:bg-black/15",
          )}
        >
          {/* `span` em bloco, e não `p`: parágrafo dentro de botão é HTML inválido. */}
          <span className="block truncate font-medium opacity-80">{autorDaCitada}</span>
          {/* Citação de mensagem apagada não mostra o texto — o conteúdo
              nem vem mais da API (ver `esconderApagada`), e sem este ramo
              a tarjinha diria "Anexo" pra uma frase que foi apagada. */}
          <span className={cn("line-clamp-2 opacity-70", message.replyTo.deletedAt && "italic")}>
            {message.replyTo.deletedAt
              ? "Mensagem apagada"
              : resumoDaMensagem(message.replyTo.content, message.replyTo.messageType)}
          </span>
        </button>
      ) : null}

      {message.messageType !== "TEXT" && !unica ? <MessageAttachment message={message} /> : null}
      {unica ? (
        <span className="flex items-start gap-2 text-[13.5px] italic opacity-75">
          <IconeDeVisualizacaoUnica className="mt-px size-4.5 shrink-0" />
          <span>
            {avisoDeVisualizacaoUnica(unica, fromCustomer)}
            <span
              aria-hidden
              className="inline-block"
              style={{ width: larguraDaHora(message, fromCustomer) }}
            />
          </span>
        </span>
      ) : null}
      {/* Localização não repete o texto: o cartão acima já mostra o lugar e
          as coordenadas. Antes vinham os dois — o cartão e, embaixo,
          "Localização: -20.3620781, -40.4308282" — e o balão ficava com
          cara de log em vez de mensagem. */}
      {temTexto ? (
        <span className={cn("whitespace-pre-wrap break-words", recuo, foto && "pt-0.5 pb-1")}>
          <Highlighted text={message.content} term={highlight} />
          {horaNoTexto ? (
            <span
              aria-hidden
              className="inline-block"
              style={{ width: larguraDaHora(message, fromCustomer) }}
            />
          ) : null}
        </span>
      ) : null}
      <span
        className={cn(
          "flex items-center justify-end gap-1 text-[11px] leading-none",
          horaNoTexto
            ? // Encaixada no fim da última linha, no espaço reservado acima.
              cn("absolute bottom-[5px]", foto ? "right-2.5" : "right-[7px]")
            : horaSobreAFoto
              ? // Sobre a foto, com um fundo que garante leitura em
                // qualquer imagem.
                "absolute right-2.5 bottom-2.5 rounded-full bg-black/35 px-1.5 py-1 text-white"
              : recuo,
          horaSobreAFoto
            ? null
            : // Sem balão atrás, a hora precisa do próprio contraste contra o
              // papel de parede.
              figurinha
              ? "w-full text-muted-foreground"
              : fromCustomer
                ? "text-muted-foreground"
                : "text-bubble-out-foreground/70",
        )}
      >
        {message.senderType === "AI" ? <span className="font-medium">IA</span> : null}
        <span>{timeLabel(message.createdAt)}</span>
        {fromCustomer ? null : (
          <DeliveryTicks status={message.status} motivo={message.metadata?.falha} />
        )}
      </span>
    </div>

    {/* A recusa por extenso, embaixo do balão. O triângulo sozinho diz que
        deu errado; sem o motivo, quem atende não sabe se reenvia o mesmo
        arquivo, troca o formato ou chama alguém — e o log do servidor está
        fora do alcance dela. */}
    {message.status === "FAILED" && message.metadata?.falha ? (
      <p className={cn("mt-0.5 max-w-full text-[11px] text-destructive", fromCustomer ? "pl-2" : "pr-2 text-right")}>
        Não entregue: {message.metadata.falha}
      </p>
    ) : null}

      {reactions.length > 0 ? (
        <div className={cn("-mt-1.5 flex gap-1", fromCustomer ? "self-start pl-2" : "self-end pr-2")}>
          {reactions.map(([emoji, who]) => (
            <span
              key={emoji}
              className="flex items-center gap-0.5 rounded-full border bg-popover px-1.5 py-0.5 text-[11px] shadow-xs"
            >
              <span className="emoji text-[13px]">{emoji}</span>
              {who.length > 1 ? <span className="text-muted-foreground">{who.length}</span> : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
});
