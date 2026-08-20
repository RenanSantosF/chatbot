import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { EncryptionService } from '../../../../common/crypto/encryption.service';
import { CustomersService } from '../../../customers/customers.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../../../common/prisma/tenant-prisma.service';
import * as evolution from './evolution.client';
import {
  normalizarEndereco,
  servidorDaPlataforma,
} from './evolution-servidor';

/**
 * A tela de conectar o WhatsApp pela Evolution.
 *
 * O fluxo inteiro é: a empresa informa o servidor, a gente cria uma sessão
 * lá, mostra o QR code, e a pessoa lê com o celular. Da leitura em diante
 * quem avisa que deu certo é o webhook — este serviço nunca fica esperando
 * a conexão acontecer.
 *
 * Isso é de propósito. Ler o QR code leva de segundos a minutos (achar o
 * celular, abrir o menu certo), e uma requisição HTTP pendurada esse tempo
 * todo é uma requisição que o balanceador derruba no meio.
 */
/**
 * Por quanto tempo um pareamento recém-emitido continua valendo.
 *
 * O código do WhatsApp dura cerca de um minuto, e o QR um pouco menos.
 * Enquanto estiver dentro disso, pedir "de novo" devolve o mesmo — é o
 * que impede que um segundo clique, ou a tela consultando o estado,
 * derrube o pareamento que a pessoa está no meio de digitar.
 */
const VALIDADE_DO_PAREAMENTO_MS = 60_000;

@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly global: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly customers: CustomersService,
  ) {}

  /**
   * O endereço que a Evolution vai chamar quando chegar mensagem.
   *
   * Precisa ser público: é um servidor de fora batendo aqui. Em
   * desenvolvimento isso quer dizer um túnel — e falhar cedo, com esta
   * mensagem, evita a hora perdida procurando por que "conectou mas não
   * chega nada".
   *
   * O `/api` NÃO é enfeite: toda a API vive sob esse prefixo global (ver
   * `setGlobalPrefix` em main.ts), e `API_PUBLIC_URL` guarda só o domínio.
   * Sem ele o endereço registrado na Evolution aponta pra uma rota que não
   * existe, ela entrega tudo em 404, e o sintoma é exatamente o que esta
   * função existe pra evitar: conecta, o QR code funciona, e nenhuma
   * mensagem aparece no painel.
   */
  private urlDoWebhook(secret: string): string {
    const bruto = process.env.API_PUBLIC_URL?.trim().replace(/\/+$/, '');
    // Sem esquema não é endereço, é texto. O Railway mostra o domínio
    // pelado ("algo.up.railway.app") e é exatamente assim que ele é
    // copiado pra variável — o servidor de mensagens então guarda um
    // destino que não dá pra chamar, e o sintoma é o de sempre: tudo
    // conectado e nenhuma mensagem no painel.
    const base = bruto && !/^https?:\/\//i.test(bruto) ? `https://${bruto}` : bruto;
    if (!base) {
      throw new BadRequestException(
        'Configure API_PUBLIC_URL com o endereço público desta API antes de conectar: é para lá que o servidor de mensagens envia o que chega.',
      );
    }
    return `${base}/api/webhooks/evolution/${secret}`;
  }

  async status() {
    const config = await this.prisma.db.evolutionSettings.findFirst();
    if (!config) return null;

    return {
      // O endereço do servidor NÃO sai daqui: é infraestrutura nossa, e o
      // painel não tem o que fazer com ele além de expor onde as
      // mensagens de todo mundo passam.
      instance: config.instance,
      estado: config.estado,
      qrCode: config.qrCode,
      pairingCode: config.pairingCode,
      connectedPhone: config.connectedPhone,
      lastSeenAt: config.lastSeenAt,
      lastError: config.lastError,
    };
  }

  /**
   * Cria a sessão no servidor e devolve o QR code.
   *
   * Guarda ANTES de chamar o servidor, e não depois. Se a criação der
   * certo lá e a gravação falhar aqui, fica uma sessão órfã consumindo
   * memória do servidor que ninguém sabe apagar — e o nome dela, que é
   * aleatório, se perde junto.
   */
  async conectar(numero?: string | null) {
    const existente = await this.prisma.db.evolutionSettings.findFirst();

    /*
     * O servidor é o da plataforma — o cliente não informa nem vê.
     *
     * A configuração por empresa continua tendo precedência pra quem já
     * conectou com servidor próprio: trocar o endereço debaixo de uma
     * sessão viva a mataria, e o nome dela só existe lá.
     */
    const plataforma = servidorDaPlataforma();
    const servidor = existente
      ? {
          baseUrl: existente.baseUrl,
          apiKey: this.encryption.decrypt(existente.apiKeyEncrypted),
        }
      : plataforma;

    if (!servidor) {
      throw new BadRequestException(
        'A conexão por QR code não está disponível nesta instalação. Fale com o suporte.',
      );
    }

    const { apiKey } = servidor;
    const baseUrl = normalizarEndereco(servidor.baseUrl);
    const apiKeyEncrypted = this.encryption.encrypt(apiKey);

    // O nome da sessão é sorteado, e não derivado do nome da empresa: ele
    // é único na plataforma inteira, e nome de empresa se repete. Uma vez
    // sorteado, nunca muda — trocá-lo abandonaria a sessão antiga no
    // servidor.
    /*
     * Código de pareamento novo exige SOCKET novo — e socket novo, aqui,
     * quer dizer NOME novo.
     *
     * O servidor só pede um código ao WhatsApp quando o socket emite o
     * evento de pareamento, o que acontece uma vez, ao subir. Depois
     * disso ele devolve o que está guardado na memória dele: o mesmo
     * código de antes, já vencido. A tela mostra oito caracteres
     * novinhos, a pessoa digita, e o WhatsApp recusa — sempre, e sem
     * nunca dizer que o código já tinha morrido.
     *
     * Apagar a instância e recriar com o MESMO nome não resolve: o
     * servidor apaga a linha e mantém o socket vivo, que segue tentando
     * gravar num registro inexistente (`P2025`) e nunca completa o
     * pareamento. Nome novo evita a colisão inteira — a sessão velha
     * morre sozinha e a nova nasce limpa, com registro próprio.
     *
     * Só quando não está conectada, e só quando não há pareamento recém
     * emitido: rotacionar o nome de uma sessão viva a abandonaria no
     * servidor, com o atendimento junto.
     */
    const pareamentoFresco =
      Boolean(existente?.pairingCode || existente?.qrCode) &&
      Boolean(existente?.updatedAt) &&
      Date.now() - existente!.updatedAt.getTime() < VALIDADE_DO_PAREAMENTO_MS;

    const precisaDeSocketNovo =
      Boolean(existente) && existente!.estado !== 'CONECTADO' && !pareamentoFresco;

    if (precisaDeSocketNovo) {
      // Melhor esforço: o servidor guarda a sessão velha sem uso nenhum, e
      // falhar aqui não pode impedir a nova de nascer.
      await evolution
        .apagarInstancia({
          baseUrl,
          apiKey,
          instance: existente!.instance,
        })
        .catch(() => undefined);
    }

    const instance =
      !existente || precisaDeSocketNovo
        ? `inteliwa-${randomUUID()}`
        : existente.instance;
    const webhookSecret = existente?.webhookSecret ?? randomBytes(24).toString('hex');

    const config = existente
      ? await this.prisma.db.evolutionSettings.update({
          where: { id: existente.id },
          data: {
            baseUrl,
            apiKeyEncrypted,
            instance,
            estado: 'AGUARDANDO_QRCODE',
            qrCode: null,
            lastError: null,
          },
        })
      : await this.prisma.db.evolutionSettings.create({
          data: {
            tenantId: this.prisma.tenantId,
            baseUrl,
            apiKeyEncrypted,
            instance,
            webhookSecret,
            estado: 'AGUARDANDO_QRCODE',
          },
        });

    if (pareamentoFresco) {
      this.logger.log(
        `Sessão ${config.instance}: pareamento ainda válido, devolvido sem recriar.`,
      );
      return {
        instance: config.instance,
        qrCode: existente!.qrCode,
        pairingCode: existente!.pairingCode,
        estado: 'AGUARDANDO_QRCODE' as const,
      };
    }

    const credenciais = { baseUrl, apiKey, instance: config.instance };
    const url = this.urlDoWebhook(config.webhookSecret);

    /*
     * NÃO apague a instância pra "começar limpa".
     *
     * Isto já esteve aqui, com a intenção de garantir um socket novo a
     * cada pareamento, e o resultado foi pior que o problema: a Evolution
     * apaga a linha no banco dela mas mantém o socket vivo em memória.
     * Ele segue gerando código e tentando gravar num registro que não
     * existe mais — `P2025: No record was found for an update` — e o
     * pareamento nunca completa. O celular nem chega a receber o pedido
     * de conexão, então o erro que aparece é "não foi possível conectar o
     * dispositivo", que aponta pro lugar errado.
     *
     * Quando uma sessão precisar mesmo ser recriada, o caminho é
     * desconectar pela tela (que faz logout ANTES de apagar, terminando o
     * socket) e conectar de novo.
     */

    // Criar dá 403 quando a sessão já existe — o que, depois da limpeza
    // acima, só acontece com uma sessão VIVA. Aí o caminho é pedir o
    // material de pareamento da que já está lá.
    let resposta = await evolution.criarInstancia(credenciais, url, numero);
    const jaExistia = !resposta.ok && resposta.status === 403;
    if (jaExistia) {
      resposta = await evolution.conectar(credenciais, numero);
    }

    if (!resposta.ok) {
      await this.prisma.db.evolutionSettings.update({
        where: { id: config.id },
        data: { estado: 'DESCONECTADO', lastError: resposta.erro },
      });
      throw new BadRequestException(
        resposta.erro ?? 'Não deu pra criar a sessão no servidor de mensagens.',
      );
    }

    // O endereço é registrado SEMPRE, e não só quando a sessão nasce.
    //
    // Criar leva o webhook junto; reconectar numa sessão que já existe,
    // não — aquele caminho só pede o QR code. Sem esta chamada, a segunda
    // conexão em diante ficava com o endereço de antes, ou sem endereço
    // nenhum, e o sintoma era o pior que existe: sessão conectada,
    // mensagem chegando no servidor, e silêncio absoluto no painel.
    //
    // Como é sempre, uma troca de domínio da API também se conserta
    // sozinha na próxima conexão.
    const registro = await evolution.definirWebhook(credenciais, url);
    if (!registro.ok) {
      await this.prisma.db.evolutionSettings.update({
        where: { id: config.id },
        data: { estado: 'DESCONECTADO', lastError: registro.erro },
      });
      throw new BadRequestException(
        `A sessão subiu, mas o servidor não aceitou o endereço de retorno: ${registro.erro}. Sem ele, nenhuma mensagem chega no painel.`,
      );
    }

    /*
     * O pedido de histórico, também sempre.
     *
     * Sem `await` no resultado a ponto de travar a conexão: se o servidor
     * recusar (versão antiga, rota diferente), o painel continua
     * funcionando — só começa sem as conversas antigas. Derrubar o
     * pareamento inteiro por causa disso seria trocar um defeito grande
     * por um maior.
     */
    const historico = await evolution.pedirHistoricoCompleto(credenciais);
    if (!historico.ok) {
      this.logger.warn(
        `O servidor não aceitou o pedido de histórico completo: ${historico.erro}. ` +
          'A conexão segue; as conversas antigas do aparelho podem não vir.',
      );
    }

    /*
     * A agenda, lida agora em vez de esperada por evento.
     *
     * O evento de contatos chega uma vez, no pareamento. Quem já está
     * conectado não o recebe de novo — então, sem esta leitura, uma
     * empresa que pareou antes de a importação funcionar ficaria sem os
     * nomes até desconectar e ler o QR code outra vez. Com ela, apertar
     * "conectar" basta.
     *
     * Falha aqui não derruba nada: o painel funciona mostrando telefone
     * onde falta nome, que é como ele já vivia.
     */
    const agenda = await evolution.buscarContatos(credenciais);
    if (agenda.ok && Array.isArray(agenda.dados)) {
      const { recebidos, salvos } = await this.customers.importarAgenda(
        agenda.dados,
      );
      this.logger.log(
        `Agenda do servidor: ${salvos} de ${recebidos} contatos salvos.`,
      );
    } else if (!agenda.ok) {
      this.logger.warn(
        `Não deu pra ler a agenda no servidor de mensagens: ${agenda.erro}`,
      );
    }

    // O estado sai do SERVIDOR, e não de um palpite.
    //
    // Reconectar numa sessão que já está de pé não devolve QR code nenhum
    // — não há o que parear. Assumir "aguardando QR code" nesse caso
    // deixava a tela girando pra sempre esperando uma imagem que nunca
    // vinha, numa sessão que estava funcionando o tempo todo.
    const qrCode = resposta.dados?.qrcode?.base64 ?? null;
    const pairingCode = evolution.codigoDePareamento(resposta.dados);
    const situacao = await evolution.estado(credenciais);
    // Qualquer um dos dois significa "esperando alguém parear". Olhar só o
    // QR code deixaria a tela do pareamento por número achando que nada
    // aconteceu.
    const estado =
      qrCode || pairingCode
        ? ('AGUARDANDO_QRCODE' as const)
        : traduzirEstado(situacao.dados?.instance?.state);

    await this.prisma.db.evolutionSettings.update({
      where: { id: config.id },
      data: {
        qrCode,
        pairingCode,
        estado,
        lastError: null,
        ...(estado === 'CONECTADO' ? { lastSeenAt: new Date() } : {}),
      },
    });

    this.logger.log(
      `Sessão ${config.instance} pronta pro tenant ${this.prisma.tenantId} (${estado}); retorno em ${url}.`,
    );

    // A empresa passa a ser da Evolution assim que a sessão existe, e não
    // quando o QR code é lido: se a troca esperasse a conexão, as
    // mensagens do intervalo sairiam pela Meta, que é justamente o canal
    // que ela está deixando.
    await this.global.client.tenant.update({
      where: { id: this.prisma.tenantId },
      data: { canal: 'EVOLUTION' },
    });

    return { instance: config.instance, qrCode, pairingCode, estado };
  }

  /**
   * Um pareamento novo — o anterior expira em cerca de um minuto.
   *
   * Com número, devolve código; sem número, QR code. É a mesma chamada,
   * então o botão "gerar outro" serve aos dois jeitos sem ramificação.
   */
  async renovarQrCode(numero?: string | null) {
    const { config, credenciais } = await this.credenciais();

    /*
     * Pede ao servidor o material da sessão que já existe.
     *
     * Não recria nada: recriar exigiria apagar a instância, e apagar
     * deixa o socket órfão em memória — ver o aviso longo em `conectar`.
     * Pra trocar de QR pra código (ou o contrário) numa sessão que não
     * pareou, o caminho é desconectar pela tela e conectar de novo.
     */
    const resposta = await evolution.conectar(credenciais, numero);
    if (!resposta.ok) {
      throw new BadRequestException(
        resposta.erro ?? 'Não deu pra gerar um código novo.',
      );
    }

    const qrCode = resposta.dados?.qrcode?.base64 ?? null;
    const pairingCode = evolution.codigoDePareamento(resposta.dados);
    await this.prisma.db.evolutionSettings.update({
      where: { id: config.id },
      data: { qrCode, pairingCode, estado: 'AGUARDANDO_QRCODE', lastError: null },
    });

    return { qrCode, pairingCode };
  }

  /**
   * Confere no servidor em que pé está a sessão.
   *
   * Existe além do webhook porque o webhook pode ter se perdido — o
   * servidor reiniciou, a rede oscilou, a URL mudou. Sem esta conferência
   * sob demanda, o painel diria "conectado" para uma sessão que caiu horas
   * atrás, e ninguém entenderia por que as mensagens não saem.
   */
  async conferir() {
    const { config, credenciais } = await this.credenciais();

    const resposta = await evolution.estado(credenciais);
    if (!resposta.ok) {
      await this.prisma.db.evolutionSettings.update({
        where: { id: config.id },
        data: { lastError: resposta.erro },
      });
      return { estado: config.estado, lastError: resposta.erro };
    }

    const estado = traduzirEstado(resposta.dados?.instance?.state);

    await this.prisma.db.evolutionSettings.update({
      where: { id: config.id },
      data: {
        estado,
        lastError: null,
        ...(estado === 'CONECTADO'
          ? { lastSeenAt: new Date(), qrCode: null, pairingCode: null }
          : {}),
      },
    });

    return { estado, lastError: null };
  }

  /**
   * Desvincula o aparelho e volta a empresa pro canal oficial.
   *
   * A sessão é APAGADA no servidor, não só desconectada: sessão parada
   * continua ocupando memória lá, e uma que ninguém vai reconectar é só
   * custo. O registro daqui fica, com o nome da sessão, pra reconectar
   * depois sem sobrar órfã.
   */
  async desconectar() {
    const { config, credenciais } = await this.credenciais();

    await evolution.desconectar(credenciais);
    const apagada = await evolution.apagarInstancia(credenciais);
    if (!apagada.ok) {
      this.logger.warn(
        `Sessão ${config.instance} desconectada, mas não apagada no servidor: ${apagada.erro}`,
      );
    }

    await this.prisma.db.evolutionSettings.update({
      where: { id: config.id },
      data: {
        estado: 'DESCONECTADO',
        qrCode: null,
        pairingCode: null,
        connectedPhone: null,
        lastError: null,
      },
    });
    await this.global.client.tenant.update({
      where: { id: this.prisma.tenantId },
      data: { canal: 'META_CLOUD' },
    });

    return { estado: 'DESCONECTADO' as const };
  }

  private async credenciais() {
    const config = await this.prisma.db.evolutionSettings.findFirst();
    if (!config) {
      throw new NotFoundException(
        'Esta empresa ainda não tem uma conexão com servidor de mensagens.',
      );
    }

    return {
      config,
      credenciais: {
        baseUrl: config.baseUrl,
        apiKey: this.encryption.decrypt(config.apiKeyEncrypted),
        instance: config.instance,
      },
    };
  }
}

/**
 * O vocabulário de estado do servidor traduzido pro nosso.
 *
 * `connecting` vira "aguardando QR code" porque é o que ele significa na
 * prática pra quem está olhando: a sessão existe e está esperando alguém
 * parear. Qualquer outra coisa é desconectado — inclusive `refused`, que
 * é a sessão recusada pelo WhatsApp.
 */
function traduzirEstado(
  bruto: string | undefined,
): 'CONECTADO' | 'AGUARDANDO_QRCODE' | 'DESCONECTADO' {
  if (bruto === 'open') return 'CONECTADO';
  if (bruto === 'connecting') return 'AGUARDANDO_QRCODE';
  return 'DESCONECTADO';
}
