"use client";

import { QrCode, RefreshCw, Unplug } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import { useRealtime } from "@/components/realtime-provider";

type Estado = "DESCONECTADO" | "AGUARDANDO_QRCODE" | "CONECTADO";

interface StatusDaEvolution {
  instance: string;
  estado: Estado;
  qrCode: string | null;
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
  const { canal } = useRealtime();

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
   * Quando esta aba viu a conexão acontecer.
   *
   * É o que sustenta o aviso de sincronização: assim que o aparelho é
   * vinculado, o WhatsApp entrega o histórico em lote, e isso leva de
   * segundos a alguns minutos. Sem dizer nada, a tela mostrava "Conectado"
   * sobre um Inbox vazio, e a leitura natural era que não estava
   * funcionando — quando estava, só ainda não tinha chegado.
   *
   * Nulo enquanto a conexão não acontece NESTA aba: quem abre a tela com
   * o WhatsApp já ligado há dias não tem nada a sincronizar.
   */
  const [sincronizandoAte, setSincronizandoAte] = useState(false);
  const jaAvisou = useRef(false);

  /** O aviso de conectado sai UMA vez, venha ele do socket ou da consulta. */
  const avisarConectado = useCallback(() => {
    if (jaAvisou.current) return;
    jaAvisou.current = true;
    setSincronizandoAte(true);
    toast.success("WhatsApp conectado.");
  }, []);

  /**
   * O aviso se apaga sozinho depois de três minutos.
   *
   * Um relógio, e não uma comparação na hora de desenhar: nada re-renderiza
   * esta tela quando o tempo passa, então a conta só mudaria de resultado
   * por acaso, no próximo evento que chegasse. Três minutos é estimativa
   * honesta — ninguém nos avisa que a sincronização terminou, e é por isso
   * que a frase na tela diz "pode levar alguns minutos" em vez de prometer
   * um prazo.
   */
  useEffect(() => {
    if (!sincronizandoAte) return;
    const timer = setTimeout(() => setSincronizandoAte(false), 3 * 60_000);
    return () => clearTimeout(timer);
  }, [sincronizandoAte]);

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

  async function conectar() {
    setConectando(true);
    try {
      // Sem corpo: o servidor de mensagens é da plataforma, e a API já
      // sabe qual é. Ver evolution-servidor.ts, do lado de lá.
      await apiFetch("/whatsapp/evolution", { method: "POST" });
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
      await apiFetch("/whatsapp/evolution/qrcode", { method: "POST" });
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
  const sincronizando = conectado && sincronizandoAte;
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
                  ? "Trazendo as conversas do aparelho — isso pode levar alguns minutos."
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
            {status?.qrCode ? (
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
              No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho. O código expira em
              cerca de um minuto.
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
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => void conectar()}
              disabled={conectando}
              className="self-start"
            >
              {conectando ? <Spinner className="size-4" /> : <QrCode className="size-4" />}
              {jaConfigurado ? "Gerar novo QR code" : "Conectar WhatsApp"}
            </Button>
            {/* Um botão, e nenhum campo.
                
                A tela pedia o endereço do servidor de mensagens e a chave
                da API dele, e as duas coisas saíram. A primeira é
                infraestrutura nossa — quem contrata um atendimento no
                WhatsApp não tem por que saber por qual servidor a mensagem
                passa, e um endereço colado errado produz o pior sintoma
                que existe aqui: conecta, o QR code funciona, e nada chega.
                
                A segunda era mais séria que uma questão de tela: a chave
                da Evolution é global, e quem a tem apaga a sessão de
                qualquer empresa do servidor. */}
            <p className="text-xs text-muted-foreground text-pretty">
              É só ler o código com o celular que vai atender. Nada para configurar.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
