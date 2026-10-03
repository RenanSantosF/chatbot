import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { EmailService } from '../../common/email/email.service';
import {
  enderecoDoPainel,
  montarEmail,
  type Destaque,
} from '../../common/email/modelo-de-email';
import { PrismaService } from '../../common/prisma/prisma.service';
import { meiaNoite, partes } from '../../common/utils/fuso';
import { fusoValido } from '../inbox-settings/horario-comercial';
import { CopilotLeituraService } from './copilot-leitura.service';

function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** De quinze em quinze minutos: a hora certa de cada fuso chega na hora. */
const INTERVALO_MS = 15 * 60 * 1000;

/** Segunda-feira, a partir das 8h no relógio da empresa. */
const HORA_DO_ENVIO = 8;

/**
 * Já é hora de mandar o resumo desta semana?
 *
 * Segunda a partir das 8h — ou qualquer dia depois, se a segunda passou com
 * o processo fora do ar: atrasado ainda é melhor que nunca. E uma vez por
 * semana: o último envio anterior à segunda desta semana libera o próximo.
 */
export function horaDoRelatorio(
  fuso: string,
  ultimoEnvio: Date | null,
  agora: Date,
): boolean {
  const p = partes(fuso, agora);
  const diasDesdeSegunda = (p.semana + 6) % 7;
  if (diasDesdeSegunda === 0 && p.hora < HORA_DO_ENVIO) return false;

  const hoje = meiaNoite(fuso, agora);
  const DIA = 24 * 60 * 60 * 1000;
  const estaSegunda = meiaNoite(
    fuso,
    new Date(hoje.getTime() - diasDesdeSegunda * DIA + DIA / 2),
  );
  return !ultimoEnvio || ultimoEnvio < estaSegunda;
}

/**
 * O resumo da semana por e-mail ao dono, toda segunda de manhã.
 *
 * Quem paga a ferramenta raramente é quem atende, e o dono que não vê o
 * que ela faz não sabe por que está pagando. Os números são os mesmos do
 * relatório do assistente (✨), calculados pelo mesmo código: o e-mail e
 * a pergunta "como foi a semana?" nunca discordam.
 *
 * Pode ser desligado em Configurações › Conta.
 */
@Injectable()
export class RelatorioSemanalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RelatorioSemanalService.name);
  private timer?: NodeJS.Timeout;
  private rodando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.enviarOsDevidos(), INTERVALO_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async enviarOsDevidos(agora = new Date()): Promise<void> {
    // Sem e-mail configurado, nem marca como enviado: quando o Resend
    // entrar, o resumo da semana ainda sai.
    if (this.rodando || !this.email.configurado) return;
    this.rodando = true;
    try {
      const empresas = await this.prisma.client.tenant.findMany({
        where: { relatorioSemanal: true, status: { not: 'SUSPENDED' } },
        select: {
          id: true,
          name: true,
          timezone: true,
          relatorioSemanalEm: true,
        },
      });

      for (const empresa of empresas) {
        const fuso = fusoValido(empresa.timezone);
        if (!horaDoRelatorio(fuso, empresa.relatorioSemanalEm, agora)) {
          continue;
        }
        try {
          await this.enviar(empresa, agora);
        } catch (erro) {
          this.logger.warn(
            `Resumo semanal do tenant ${empresa.id} não saiu: ${String(erro)}`,
          );
        }
      }
    } finally {
      this.rodando = false;
    }
  }

  private async enviar(
    empresa: { id: string; name: string; relatorioSemanalEm: Date | null },
    agora: Date,
  ) {
    // Marca antes de mandar, e só se ninguém marcou no meio: um reinício
    // durante o envio não manda o mesmo resumo duas vezes.
    const { count } = await this.prisma.client.tenant.updateMany({
      where: {
        id: empresa.id,
        relatorioSemanalEm: empresa.relatorioSemanalEm,
      },
      data: { relatorioSemanalEm: agora },
    });
    if (count === 0) return;

    const leitura = await this.leituraDa(empresa.id);
    const [numeros, duvidas] = await Promise.all([
      leitura.relatorio({ periodo: 'semanaPassada' }),
      leitura.perguntasQueAIaNaoSoube({ periodo: 'semanaPassada' }),
    ]);

    // Semana sem movimento nenhum não vira e-mail: "0 clientes" toda
    // segunda é o jeito mais rápido de ensinar alguém a ignorar o resumo.
    if (numeros.clientesQueEscreveram === 0) return;

    const donos = await this.prisma.client.user.findMany({
      where: { tenantId: empresa.id, role: 'OWNER', status: 'ACTIVE' },
      select: { name: true, email: true },
    });

    const destaques: Destaque[] = [
      {
        rotulo: 'Clientes que escreveram',
        valor: String(numeros.clientesQueEscreveram),
      },
      {
        rotulo: 'Atendidos só pela IA',
        valor: `${numeros.ia.atendeuSozinha} (${numeros.ia.porcentoDosClientes}%)`,
      },
      {
        rotulo: 'Passados para a equipe',
        valor: String(numeros.ia.passouParaAEquipe),
      },
      ...(numeros.ia.tempoMedioDeResposta
        ? [
            {
              rotulo: 'Tempo de resposta da IA',
              valor: numeros.ia.tempoMedioDeResposta,
            },
          ]
        : []),
      ...(numeros.equipe.tempoMedioDeResposta
        ? [
            {
              rotulo: 'Tempo de resposta da equipe',
              valor: numeros.equipe.tempoMedioDeResposta,
            },
          ]
        : []),
      ...(numeros.aindaSemResposta > 0
        ? [
            {
              rotulo: 'Ainda sem resposta',
              valor: String(numeros.aindaSemResposta),
            },
          ]
        : []),
    ];

    const pico = numeros.horariosDePico[0];
    const movimento = [
      numeros.diaMaisMovimentado
        ? `o dia mais movimentado foi ${numeros.diaMaisMovimentado}`
        : null,
      pico ? `o horário de pico foi ${pico.faixa}` : null,
    ].filter((frase): frase is string => Boolean(frase));
    const paragrafos = [
      `Este é o resumo do atendimento de ${empresa.name} na semana passada (segunda a domingo).`,
      ...(movimento.length
        ? [primeiraMaiuscula(`${movimento.join(' e ')}.`)]
        : []),
    ];

    const perguntas = duvidas.itens
      .slice(0, 5)
      .map((item) => `${item.cliente}: "${item.perguntaDoCliente}"`);

    for (const dono of donos) {
      const nome = dono.name.split(' ')[0] || dono.name;
      const { html, texto } = montarEmail({
        saudacao: `Olá, ${nome}!`,
        paragrafos,
        destaques,
        ...(perguntas.length
          ? {
              lista: {
                titulo:
                  'O que a IA não soube responder (dá pra ensinar pelo ✨ no painel):',
                itens: perguntas,
              },
            }
          : {}),
        botao: { texto: 'Abrir o painel', url: enderecoDoPainel() },
        rodape:
          'Você recebe este resumo toda segunda por ser o responsável pela conta. Para parar, desligue em Configurações › Conta.',
      });
      await this.email.enviar({
        para: dono.email,
        assunto: `Sua semana na Inteliwa: ${numeros.clientesQueEscreveram} ${numeros.clientesQueEscreveram === 1 ? 'cliente atendido' : 'clientes atendidos'}`,
        html,
        texto,
      });
    }
  }

  /**
   * O leitor do assistente, como se fosse uma requisição da empresa.
   *
   * Ele é de escopo de requisição (lê o tenant do usuário logado), e esta
   * rotina roda sem requisição nenhuma. Em vez de duplicar as contas aqui,
   * cria-se um contexto com o tenant certo — o isolamento continua sendo o
   * do TenantPrismaService.
   */
  private async leituraDa(tenantId: string): Promise<CopilotLeituraService> {
    const contexto = ContextIdFactory.create();
    this.moduleRef.registerRequestByContextId({ user: { tenantId } }, contexto);
    return this.moduleRef.resolve(CopilotLeituraService, contexto, {
      strict: false,
    });
  }
}
