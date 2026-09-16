import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * O WhatsApp desta empresa está de pé AGORA?
 *
 * Existe porque a resposta estava em três lugares que discordavam, e cada
 * desacordo aparecia como um defeito diferente no painel:
 *
 * 1. A faixa de "WhatsApp desconectado" só nascia de um EVENTO de tempo
 *    real. Quem abria o painel com a sessão já caída não via nada — o
 *    evento tinha passado antes de a página existir. O aviso aparecia por
 *    acaso, quando calhava de a sessão oscilar com a aba aberta, e era
 *    isso que fazia ele "aparecer só às vezes, raramente".
 *
 * 2. A tela de configurações do WhatsApp perguntava direto ao banco e
 *    acertava — daí a contradição de uma tela avisar e a outra não.
 *
 * 3. O passo "Conectar o WhatsApp" dos primeiros passos olhava SÓ a
 *    configuração da Meta. Empresa conectada por QR code nunca cria
 *    aquela linha, então o item ficava eternamente por fazer, mesmo com o
 *    WhatsApp funcionando e conversando.
 *
 * Uma pergunta, uma resposta, e ela sabe dos dois provedores.
 */
/**
 * Até quando faz sentido dizer "trazendo as conversas".
 *
 * Ninguém garante que o aparelho vá mandar o lote final: ele pode ter
 * pouca coisa, pode estar sem bateria, o servidor pode ter reiniciado no
 * meio. Sem um limite, "importando" fica pra sempre — foi exatamente o
 * que aconteceu: quase uma hora girando.
 *
 * A conta é feita na LEITURA, e não por um cronômetro no navegador. Um
 * `setTimeout` de três minutos era o que existia antes, e ele falha de
 * dois jeitos que este não falha: some ao recarregar a página, e numa aba
 * de celular em segundo plano o Chrome congela o temporizador — ele nunca
 * dispara, e o giro fica eterno mesmo com a importação encerrada.
 */
const HISTORICO_PACIENCIA_MS = 10 * 60_000;

@Injectable()
export class EstadoDoCanalService {
  constructor(private readonly prisma: PrismaService) {}

  async doTenant(tenantId: string): Promise<EstadoDoCanal> {
    const config = await this.prisma.client.evolutionSettings.findFirst({
      where: { tenantId },
      select: {
        estado: true,
        lastError: true,
        historicoEstado: true,
        historicoMensagens: true,
        historicoProgresso: true,
        historicoIniciadoEm: true,
      },
    });

    return {
      // Só existe um provedor. Havia uma bifurcação aqui, decidida por um
      // campo `canal` no Tenant, e ela pesava dos dois lados: quando o
      // campo atrasava, a tela relatava o estado de um canal que a empresa
      // não usava. Com um caminho só, o que a tela mostra é sempre o que
      // manda a mensagem.
      provedor: 'EVOLUTION',
      // Sem linha nenhuma, a empresa ainda não pareou: "nunca conectou" é
      // diferente de "caiu", e a tela dos primeiros passos precisa dessa
      // diferença.
      estado: config?.estado ?? 'DESCONECTADO',
      motivo: config?.lastError ?? null,
      jaConectou: Boolean(config),
      historico: historicoDoConfig(config),
    };
  }
}

/**
 * Em que pé está a trazida das conversas do aparelho.
 *
 * `importando` e `expirou` juntos dizem tudo que a tela precisa: os dois
 * falsos é "nada acontecendo" (nunca houve importação, ou ela terminou
 * normalmente); `importando` verdadeiro é "ainda vale esperar";
 * `expirou` verdadeiro é o caso que faltava — a janela de paciência
 * venceu SEM o aparelho confirmar o fim, e a tela precisa dizer isso em
 * vez de simplesmente parar de girar como se nada tivesse acontecido.
 *
 * `expiraEm` é o instante (epoch ms) em que a paciência vence, calculado
 * aqui — no servidor — e não no navegador. Antes o navegador reiniciava a
 * própria contagem a cada montagem do componente (recarregar a página
 * enquanto a importação estava na metade dava outros dez minutos de
 * brinde, e recarregar de novo perto do fim dava mais dez — é a causa
 * mais provável de "fica girando um tempão"). Com o prazo vindo pronto
 * daqui, o navegador só espera até ele, não decide quando ele é.
 */
function historicoDoConfig(
  config: {
    estado: 'CONECTADO' | 'AGUARDANDO_QRCODE' | 'DESCONECTADO';
    historicoEstado: 'NUNCA' | 'IMPORTANDO' | 'CONCLUIDO';
    historicoMensagens: number;
    historicoProgresso: number;
    historicoIniciadoEm: Date | null;
  } | null,
): EstadoDoCanal['historico'] {
  const base = {
    mensagens: config?.historicoMensagens ?? 0,
    progresso: config?.historicoProgresso ?? 0,
  };

  // Sessão fora do ar não está trazendo nada: quem manda o histórico é o
  // aparelho, e ele não tem por onde. Sem esta linha, desconectar deixava
  // as duas faixas na tela ao mesmo tempo — "está desconectado" e "está
  // trazendo as conversas" — que juntas não fazem sentido nenhum.
  if (
    config?.estado !== 'CONECTADO' ||
    config.historicoEstado !== 'IMPORTANDO' ||
    !config.historicoIniciadoEm
  ) {
    return { ...base, importando: false, expiraEm: null, expirou: false };
  }

  const prazo = config.historicoIniciadoEm.getTime() + HISTORICO_PACIENCIA_MS;
  const venceu = Date.now() >= prazo;

  return venceu
    ? { ...base, importando: false, expiraEm: null, expirou: true }
    : { ...base, importando: true, expiraEm: prazo, expirou: false };
}

export interface EstadoDoCanal {
  provedor: 'META_CLOUD' | 'EVOLUTION';
  estado: 'CONECTADO' | 'AGUARDANDO_QRCODE' | 'DESCONECTADO';
  /** Por que caiu, quando o provedor sabe dizer. */
  motivo: string | null;
  /** Já houve conexão alguma vez? Separa "nunca configurou" de "caiu". */
  jaConectou: boolean;
  /** As conversas do aparelho ainda estão chegando? */
  historico: {
    importando: boolean;
    /** Quantas vieram até agora. */
    mensagens: number;
    /**
     * De 0 a 100, contado pelo aparelho.
     *
     * É o que separa "trazendo" de "travado". A contagem de mensagens
     * sozinha não servia: ela sobe sem teto e ninguém sabe se falta muito.
     */
    progresso: number;
    /** Epoch ms em que a paciência vence — só enquanto `importando`. */
    expiraEm: number | null;
    /** A paciência venceu sem o aparelho confirmar o fim da importação. */
    expirou: boolean;
  };
}
