"use client";

import { QrCode, RefreshCw, Smartphone, Unplug } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { useRealtime } from "@/components/realtime-provider";
import { cn } from "@/lib/utils";

type Estado = "DESCONECTADO" | "AGUARDANDO_QRCODE" | "CONECTADO";

interface StatusDaEvolution {
  instance: string;
  estado: Estado;
  qrCode: string | null;
  /** O código de 8 caracteres, quando o pareamento foi pedido por número. */
  pairingCode: string | null;
  connectedPhone: string | null;
  lastSeenAt: string | null;
  lastError: string | null;
}

/**
 * De quanto em quanto tempo perguntar se já conectou.
 *
 * Virou REDE DE SEGURANÇA, e não o caminho principal. O servidor agora
 * empurra cada mudança por websocket (ver `canal.estado`), e é dali que a
 * tela reage de imediato. Isto aqui cobre o caso de a conexão de tempo
 * real ter caído justamente durante a leitura do código — daí o intervalo
 * mais folgado do que era.
 */
const INTERVALO_MS = 8_000;

/**
 * Conectar o WhatsApp lendo um QR code, sem passar pela Meta.
 *
 * Vale dizer por que a tela insiste nos avisos: este caminho não é
 * homologado pelo WhatsApp. Funciona, custa menos e conecta em dois
 * minutos — e pode ser interrompido pela Meta a qualquer momento, com o
 * número bloqueado junto. Quem escolhe isso precisa escolher sabendo, e
 * esconder o risco atrás de um botão bonito seria vender o problema junto
 * com a solução.
 */
export function ConectarEvolution() {
  const [status, setStatus] = useState<StatusDaEvolution | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [conectando, setConectando] = useState(false);
  /**
   * Como parear: mostrando a imagem ou informando o número.
   *
   * O padrão é a imagem no computador e o CÓDIGO no celular, e a escolha
   * não é estética: no telefone não dá pra escanear a própria tela. Abrir
   * já na opção que funciona no aparelho em uso poupa a descoberta.
   */
  const [modo, setModo] = useState<"QRCODE" | "CODIGO">(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches
      ? "CODIGO"
      : "QRCODE",
  );
  const [numero, setNumero] = useState("");
  const { canal, historico } = useRealtime();

  /** Relê o estado depois de uma ação de quem está olhando a tela. */
  const carregar = useCallback(async () => {
    const atual = await apiFetch<StatusDaEvolution | null>("/whatsapp/evolution").catch(
      () => null,
    );
    setStatus(atual);
  }, []);

  useEffect(() => {
    // A busca fica escrita aqui, e não numa chamada a `carregar`, porque o
    // estado precisa mudar DENTRO da resposta da promessa — mudá-lo no
    // corpo do efeito faria a tela renderizar duas vezes a cada montagem.
    apiFetch<StatusDaEvolution | null>("/whatsapp/evolution")
      .then(setStatus)
      // Silêncio de propósito: esta é a tela de quem AINDA não conectou, e
      // um erro vermelho na primeira visita assusta sem informar nada.
      .catch(() => undefined)
      .finally(() => setCarregando(false));
  }, []);

  /**
   * A trazida das conversas quem conta é o SERVIDOR.
   *
   * Aqui havia um cronômetro de três minutos no navegador, e ele mentia
   * dos dois lados. Dizia "trazendo as conversas" sem que houvesse
   * importação nenhuma acontecendo — o sistema nem assinava o evento que
   * traz o histórico —, e numa aba de celular em segundo plano, onde o
   * Chrome congela o temporizador, ele nunca terminava: o giro passava
   * quase uma hora na tela.
   *
   * Agora o estado vem de `useRealtime`, alimentado pelos lotes que
   * chegam de verdade e por um limite de paciência calculado no servidor
   * a cada leitura (ver EstadoDoCanalService). Sobrevive a recarregar a
   * página e a aba nenhuma estar acordada.
   */
  const jaAvisou = useRef(false);

  /** O aviso de conectado sai UMA vez, venha ele do socket ou da consulta. */
  const avisarConectado = useCallback(() => {
    if (jaAvisou.current) return;
    jaAvisou.current = true;
    toast.success("WhatsApp conectado.");
  }, []);

  /**
   * O que o servidor empurrou vale na hora.
   *
   * Duas esperas que eram longas somem aqui. O QR code chega no instante
   * em que nasce, em vez de esperar a criação da sessão terminar de
   * responder — a Evolution avisa por webhook bem antes disso, e era essa
   * diferença que fazia a imagem levar uns vinte segundos pra aparecer. E
   * a queda da sessão aparece sem ninguém recarregar nada.
   *
   * Só mexe no que o evento traz: um aviso de conexão não apaga o QR code
   * que está na tela, e um QR code novo não muda o telefone conectado.
   */
  useEffect(() => {
    if (!canal) return;

    setStatus((atual) =>
      atual
        ? {
            ...atual,
            estado: canal.estado,
            ...(canal.qrCode !== undefined ? { qrCode: canal.qrCode } : {}),
            ...(canal.pairingCode !== undefined
              ? { pairingCode: canal.pairingCode }
              : {}),
            ...(canal.lastError !== undefined
              ? { lastError: canal.lastError }
              : {}),
          }
        : atual,
    );

    if (canal.estado === "CONECTADO") {
      avisarConectado();
      // Uma leitura só, pra buscar o que o evento não carrega — o telefone
      // conectado, que é o que a tela mostra pra pessoa conferir se
      // vinculou o aparelho certo.
      void carregar();
    }
  }, [canal, carregar, avisarConectado]);

  // Rede de segurança pro caso de a conexão de tempo real ter caído
  // justamente durante a leitura do código.
  useEffect(() => {
    if (status?.estado !== "AGUARDANDO_QRCODE") return;

    const timer = setInterval(() => {
      void apiFetch<{ estado: Estado }>("/whatsapp/evolution/conferir")
        .then((resultado) => {
          if (resultado.estado === "CONECTADO") avisarConectado();
          return carregar();
        })
        .catch(() => {
          /* Oscilação de rede não precisa virar aviso na tela. */
        });
    }, INTERVALO_MS);

    return () => clearInterval(timer);
  }, [status?.estado, carregar, avisarConectado]);

  /** Só os dígitos — é o que a API valida e o que o WhatsApp entende. */
  const digitos = numero.replace(/\D/g, "");
  const numeroValido = /^\d{10,15}$/.test(digitos);

  async function conectar() {
    setConectando(true);
    try {
      // O servidor de mensagens é da plataforma, e a API já sabe qual é
      // (ver evolution-servidor.ts). O único dado que sai daqui é o
      // telefone, e só quando o pareamento é por código.
      await apiFetch("/whatsapp/evolution", {
        method: "POST",
        body: JSON.stringify(
          modo === "CODIGO" ? { numero: digitos } : {},
        ),
      });
      await carregar();
    } catch (erro) {
      toast.error(
        erro instanceof ApiError ? erro.message : "Não deu pra conectar ao servidor.",
      );
    } finally {
      setConectando(false);
    }
  }

  async function novoQrCode() {
    try {
      // Mantém o jeito atual: quem está esperando um código não quer
      // receber uma imagem ao pedir outro.
      await apiFetch("/whatsapp/evolution/qrcode", {
        method: "POST",
        body: JSON.stringify(modo === "CODIGO" ? { numero: digitos } : {}),
      });
      await carregar();
    } catch (erro) {
      toast.error(erro instanceof ApiError ? erro.message : "Não deu pra gerar o QR code.");
    }
  }

  async function desconectar() {
    try {
      await apiFetch("/whatsapp/evolution", { method: "DELETE" });
      await carregar();
      toast.success("WhatsApp desconectado. A empresa voltou para o canal oficial.");
    } catch (erro) {
      toast.error(erro instanceof ApiError ? erro.message : "Não deu pra desconectar.");
    }
  }

  if (carregando) return null;

  const conectado = status?.estado === "CONECTADO";
  const sincronizando = conectado && Boolean(historico?.importando);
  const aguardando = status?.estado === "AGUARDANDO_QRCODE";
  // Já existe sessão: o botão deixa de ser "conectar" e passa a ser
  // "gerar novo QR code", que é o que ele de fato faz nesse ponto.
  const jaConfigurado = Boolean(status?.instance);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="size-4" />
          Conectar lendo um QR code
        </CardTitle>
        <CardDescription className="text-pretty">
          Liga o WhatsApp da sua empresa lendo um QR code, como um aparelho conectado. Leva menos de
          um minuto.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {conectado ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
            <span className="flex min-w-0 items-center gap-2">
              {/* O giro fica junto do rótulo, e não no lugar dele: a
                  conexão JÁ existe e o aparelho já envia. O que ainda está
                  a caminho é o histórico. */}
              {sincronizando ? <Spinner className="size-4 shrink-0" /> : null}
              <span className="min-w-0">
              <span className="block text-sm font-medium">
                Conectado{status?.connectedPhone ? ` · ${status.connectedPhone}` : ""}
              </span>
              <span className="block text-xs text-muted-foreground">
                {sincronizando
                  ? historico && historico.mensagens > 0
                    ? `Trazendo as conversas do aparelho — ${historico.mensagens.toLocaleString("pt-BR")} mensagens até agora.`
                    : "Trazendo as conversas do aparelho — isso pode levar alguns minutos."
                  : "As mensagens desta empresa saem por este aparelho."}
              </span>
              </span>
            </span>
            <Button variant="outline" size="sm" onClick={() => void desconectar()}>
              <Unplug className="size-4" />
              Desconectar
            </Button>
          </div>
        ) : null}

        {aguardando ? (
          <div className="flex flex-col items-center gap-3 rounded-md border p-4">
            {status?.pairingCode ? (
              /* O código é para ser LIDO EM VOZ ALTA e digitado noutro
                 aparelho, então é grande, espaçado e monoespaçado — zero e
                 O, 1 e I precisam ser distinguíveis à primeira vista. */
              <p className="font-mono text-3xl font-semibold tracking-[0.2em] select-all">
                {status.pairingCode}
              </p>
            ) : status?.qrCode ? (
              <Image
                src={status.qrCode}
                alt="QR code para conectar o WhatsApp"
                width={240}
                height={240}
                unoptimized
                className="rounded-md bg-white p-2"
              />
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Spinner />
                {/* Sem esta frase, a espera é indistinguível de travamento:
                    o código pode simplesmente ainda não ter sido gerado
                    pelo servidor, e a saída é pedir outro. */}
                <p className="text-center text-xs text-muted-foreground text-pretty">
                  O servidor ainda não devolveu um código. Se demorar, peça outro abaixo.
                </p>
              </div>
            )}
            <p className="text-center text-xs text-muted-foreground text-pretty">
              {status?.pairingCode
                ? "No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone. O código expira em cerca de um minuto."
                : "No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho. O código expira em cerca de um minuto."}
            </p>
            <Button variant="outline" size="sm" onClick={() => void novoQrCode()}>
              <RefreshCw className="size-4" />
              Gerar outro código
            </Button>
          </div>
        ) : null}

        {status?.lastError ? (
          <p className="text-xs text-destructive text-pretty">{status.lastError}</p>
        ) : null}

        {!conectado ? (
          <div className="flex flex-col gap-3">
            {/* Dois caminhos para o mesmo pareamento.

                A imagem é mais rápida no computador. O código existe pelo
                que ela não resolve: NO CELULAR NÃO DÁ PRA ESCANEAR A
                PRÓPRIA TELA — e é assim que boa parte do uso real
                acontece. Serve também quando quem contrata não é quem tem
                o aparelho: um código se dita por telefone, um QR code
                não. */}
            <div
              role="radiogroup"
              aria-label="Como conectar"
              className="flex items-center gap-1 rounded-lg bg-muted p-0.5"
            >
              <OpcaoDeModo
                ativa={modo === "QRCODE"}
                onClick={() => setModo("QRCODE")}
                icone={QrCode}
                rotulo="Ler QR code"
              />
              <OpcaoDeModo
                ativa={modo === "CODIGO"}
                onClick={() => setModo("CODIGO")}
                icone={Smartphone}
                rotulo="Usar código"
              />
            </div>

            {modo === "CODIGO" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="evolution-numero">Número que vai atender</Label>
                <Input
                  id="evolution-numero"
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                  placeholder="5527999998888"
                  inputMode="tel"
                  autoComplete="tel"
                />
                {/* O engano aqui não dá erro: sem o 55, o WhatsApp gera um
                    código que nunca reconhece, a pessoa digita no celular e
                    não acontece nada. */}
                <p className="text-xs text-muted-foreground text-pretty">
                  Com o código do país e o DDD, só números. Precisa ser o mesmo
                  número do celular que vai ler o código.
                </p>
              </div>
            ) : null}

            <Button
              onClick={() => void conectar()}
              disabled={conectando || (modo === "CODIGO" && !numeroValido)}
              className="self-start"
            >
              {conectando ? <Spinner className="size-4" /> : <QrCode className="size-4" />}
              {jaConfigurado ? "Gerar novo pareamento" : "Conectar WhatsApp"}
            </Button>

            {modo === "QRCODE" ? (
              <p className="text-xs text-muted-foreground text-pretty">
                É só ler o código com o celular que vai atender. Nada para configurar.
              </p>
            ) : null}
          </div>
        ) : null}

      </CardContent>
    </Card>
  );
}

/**
 * Uma das duas formas de parear, no mesmo interruptor de duas posições da
 * ordem do Inbox.
 *
 * Duas opções lado a lado com a atual acesa, e não um botão que alterna:
 * lendo "Usar código" num botão só não dá pra saber se é onde estou ou pra
 * onde vou.
 */
function OpcaoDeModo({
  ativa,
  onClick,
  icone: Icone,
  rotulo,
}: {
  ativa: boolean;
  onClick: () => void;
  icone: typeof QrCode;
  rotulo: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativa}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
        ativa
          ? "bg-background text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icone className="size-3.5 shrink-0" />
      {rotulo}
    </button>
  );
}
