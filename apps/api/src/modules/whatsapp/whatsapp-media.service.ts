import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { EvolutionCanal } from './canal/evolution/evolution.canal';
import { StorageService } from '../storage/storage.service';
import { motivoDaMeta } from './meta-erro';

const GRAPH_API_VERSION = 'v21.0';
// Base sobrescrevível pra apontar num ambiente de teste da Meta ou num
// servidor de mentira em teste automatizado. Em produção fica no padrão.
const GRAPH_BASE = process.env.META_GRAPH_URL ?? 'https://graph.facebook.com';

export interface DownloadedMedia {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Ponte com a API de mídia da Meta. O binário nunca é público: a URL que a
 * Meta devolve exige o token do tenant no header, e ela expira em minutos.
 * Por isso o painel nunca aponta direto pra Meta — ele pede pra cá, e este
 * serviço busca com a credencial certa do tenant da requisição.
 */
@Injectable()
export class WhatsappMediaService {
  private readonly logger = new Logger(WhatsappMediaService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly global: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly storage: StorageService,
    private readonly evolution: EvolutionCanal,
  ) {}

  /**
   * Busca o binário na origem certa.
   *
   * "Origem" mudou de significado quando a Evolution entrou. Na Meta o
   * arquivo fica hospedado 30 dias e o handle é um id que aponta pra ele;
   * na Evolution nada fica hospedado — o handle é a chave da mensagem, e o
   * arquivo é pedido ao WhatsApp na hora, como o aplicativo do celular faz
   * ao abrir uma conversa antiga.
   *
   * Sem esta bifurcação, TODA mídia de empresa conectada por QR code era
   * buscada na Cloud API — que não tem credencial dessa empresa, nem o
   * arquivo. O balão ficava sem imagem e sem explicação.
   */
  private async baixarDaOrigem(handle: string): Promise<DownloadedMedia> {
    const tenant = await this.global.client.tenant.findUnique({
      where: { id: this.prisma.tenantId },
      select: { canal: true },
    });

    if (tenant?.canal !== 'EVOLUTION') return this.baixarDaMeta(handle);

    /*
     * O endereço do arquivo vai junto do pedido, quando a mensagem o tem.
     *
     * Sem ele a Evolution procura a mensagem no banco dela e responde
     * "Message not found" — o caso de tudo que já estava no aparelho
     * antes de conectar, que chegou pela sincronização e ela nunca teve.
     * Ver `evolutionMedia`, em evolution-mensagem.
     */
    const dona = await this.mensagemDaMidia(handle);
    const metadata = (dona?.metadata ?? {}) as Record<string, unknown>;

    const baixada = await this.evolution.baixarMidia(
      handle,
      metadata.evolutionMedia,
    );
    if (!baixada) {
      throw new NotFoundException(
        'Não deu pra buscar este anexo no WhatsApp. Ele pode ter sido apagado no aparelho.',
      );
    }
    return baixada;
  }

  /**
   * Acha a mensagem dona de uma mídia pelo id que a Meta deu.
   *
   * Busca pela COLUNA `mediaId`, não pelo caminho dentro do JSON de
   * metadados. Filtro em campo Json não usa índice, e esta consulta roda em
   * toda abertura de conversa com anexo e em todo arquivamento vindo do
   * webhook — era uma varredura da tabela que mais cresce no sistema, várias
   * vezes por conversa. A coluna é espelho do que continua no metadata (ver
   * `mediaIdDe`, em ConversationsService).
   */
  private async mensagemDaMidia(mediaId: string) {
    return this.prisma.db.message.findFirst({
      where: { mediaId },
      select: { id: true, metadata: true, deletedAt: true },
    });
  }

  /**
   * As figurinhas que já passaram por esta conta.
   *
   * ISTO NÃO É A GAVETA DE FIGURINHAS DO CELULAR, e a diferença importa
   * pra quem espera o WhatsApp Web: os pacotes salvos no aparelho não
   * chegam até aqui. Nem a Evolution nem o Baileys expõem essa coleção —
   * ela vive na sincronização de estado do aplicativo e não tem rota. O
   * que existe, e é o que esta lista devolve, são as figurinhas que a
   * empresa já mandou ou recebeu em alguma conversa.
   *
   * Na prática é a lista que se usa: figurinha de atendimento é quase
   * sempre a mesma meia dúzia, e a que o cliente mandou primeiro é
   * justamente a que se quer devolver.
   *
   * O recorte é por `messageType: 'IMAGE'` com mídia, e o WebP é
   * conferido depois, em memória. O mimetype mora dentro do JSON de
   * metadados, e filtrar por caminho de Json não usa índice — seria uma
   * varredura da maior tabela do sistema pra montar um painelzinho.
   */
  async figurinhas(limite = 40): Promise<{ mediaId: string }[]> {
    const candidatas = await this.prisma.db.message.findMany({
      where: { messageType: 'IMAGE', mediaId: { not: null }, deletedAt: null },
      select: { mediaId: true, metadata: true },
      orderBy: { createdAt: 'desc' },
      // Teto sobre as CANDIDATAS, e não sobre o resultado: numa conta que
      // troca muita foto e pouca figurinha, sem ele a consulta varreria o
      // histórico inteiro atrás de completar a lista.
      take: 400,
    });

    const vistas = new Set<string>();
    const figurinhas: { mediaId: string }[] = [];

    for (const mensagem of candidatas) {
      const metadata = (mensagem.metadata ?? {}) as { mimeType?: string };
      // Toda figurinha do WhatsApp é WebP — está no protocolo, e é o
      // mesmo acordo que o painel usa pra desenhá-las sem moldura.
      if (!metadata.mimeType?.startsWith('image/webp')) continue;

      const mediaId = mensagem.mediaId;
      if (!mediaId || vistas.has(mediaId)) continue;

      vistas.add(mediaId);
      figurinhas.push({ mediaId });
      if (figurinhas.length >= limite) break;
    }

    return figurinhas;
  }

  /**
   * Guarda uma mídia recebida no armazenamento próprio.
   *
   * Chamado sem `await` pelo webhook: a Meta reenvia (e chega a desativar o
   * webhook) se a resposta demorar, e baixar um vídeo de 15 MB no meio do
   * caminho estouraria esse orçamento. Falhar aqui não pode derrubar o
   * recebimento da mensagem — no pior caso o anexo continua vindo da Meta,
   * como antes.
   */
  async arquivar(mediaId: string, fileName?: string): Promise<void> {
    if (!this.storage.ligado) return;

    try {
      const mensagem = await this.mensagemDaMidia(mediaId);
      const metadata = (mensagem?.metadata ?? {}) as Record<string, unknown>;
      if (metadata.storageKey) return; // já guardado

      const { buffer, mimeType } = await this.baixarDaOrigem(mediaId);
      const chave = await this.storage.guardar({
        tenantId: this.prisma.tenantId,
        mediaId,
        buffer,
        mimeType,
        fileName,
      });
      if (!chave || !mensagem) return;

      await this.prisma.db.message.update({
        where: { id: mensagem.id },
        data: { metadata: { ...metadata, storageKey: chave } },
      });
    } catch (erro) {
      this.logger.warn(
        `Não deu pra arquivar a mídia ${mediaId}: ${erro instanceof Error ? erro.message : erro}. Ela segue disponível na Meta por 30 dias.`,
      );
    }
  }

  private async credentials() {
    const settings = await this.prisma.db.whatsAppSettings.findFirst();
    if (!settings) {
      throw new NotFoundException('WhatsApp não está conectado nesta empresa.');
    }
    return {
      phoneNumberId: settings.phoneNumberId,
      accessToken: this.encryption.decrypt(settings.accessTokenEncrypted),
    };
  }

  /**
   * Entrega o binário de uma mídia, preferindo o armazenamento próprio.
   *
   * A ordem importa: passados 30 dias a Meta apaga o arquivo, e a única
   * cópia que resta é a nossa. Se ela ainda não existe (mídia antiga, ou
   * arquivamento recém-ligado), busca da Meta e aproveita pra guardar —
   * assim o acervo se completa sozinho conforme as conversas são abertas.
   */
  async download(mediaId: string): Promise<DownloadedMedia> {
    // Mensagem apagada não entrega mais o anexo. Sem isto, apagar
    // esconderia o balão e deixaria o arquivo acessível por quem tivesse
    // guardado o endereço — apagar pela metade não é apagar.
    const dona = await this.mensagemDaMidia(mediaId);

    /*
     * O anexo é de uma mensagem DESTA empresa, ou não é servido.
     *
     * A busca já é isolada por empresa, então "não achei" aqui quer dizer
     * uma de duas coisas: o identificador não existe, ou existe no painel
     * de outra empresa. Sem esta conferência, o segundo caso seguia adiante
     * e ia pedir o arquivo ao provedor com a credencial de quem pediu —
     * dava errado por sorte (o provedor não acha mensagem de outra sessão),
     * e "por sorte" não é controle de acesso.
     */
    if (!dona) {
      throw new NotFoundException('Anexo não encontrado.');
    }

    if (dona.deletedAt) {
      throw new NotFoundException('Esta mensagem foi apagada.');
    }

    if (this.storage.ligado) {
      const metadata = (dona.metadata ?? {}) as Record<string, unknown>;

      if (typeof metadata.storageKey === 'string') {
        const guardado = await this.storage.buscar(metadata.storageKey);
        if (guardado) return guardado;
        this.logger.warn(
          `Chave ${metadata.storageKey} não achada no bucket; tentando a Meta.`,
        );
      }

      const daOrigem = await this.baixarDaOrigem(mediaId);
      void this.arquivar(mediaId, metadata.fileName as string | undefined);
      return daOrigem;
    }

    return this.baixarDaOrigem(mediaId);
  }

  /** Busca o binário direto da Meta, em dois passos como ela exige. */
  private async baixarDaMeta(mediaId: string): Promise<DownloadedMedia> {
    const { accessToken } = await this.credentials();
    const headers = { Authorization: `Bearer ${accessToken}` };

    const lookup = await fetch(
      `${GRAPH_BASE}/${GRAPH_API_VERSION}/${mediaId}`,
      { headers },
    );
    if (!lookup.ok) {
      this.logger.error(
        `Falha ao localizar mídia ${mediaId}: ${lookup.status} ${await lookup.text()}`,
      );
      throw new NotFoundException('Mídia não encontrada.');
    }

    const meta = (await lookup.json()) as { url?: string; mime_type?: string };
    if (!meta.url) {
      throw new NotFoundException('Mídia sem URL de download.');
    }

    // O segundo GET vai pro CDN da Meta e também exige o Authorization —
    // sem ele responde 401 mesmo com a URL correta.
    const binary = await fetch(meta.url, { headers });
    if (!binary.ok) {
      this.logger.error(
        `Falha ao baixar mídia ${mediaId}: ${binary.status} ${await binary.text()}`,
      );
      throw new NotFoundException('Não deu pra baixar a mídia.');
    }

    return {
      buffer: Buffer.from(await binary.arrayBuffer()),
      mimeType: meta.mime_type ?? 'application/octet-stream',
    };
  }

  /**
   * Sobe um arquivo pra Meta e devolve o id de mídia usado no envio.
   *
   * Tenta primeiro com o tipo completo que recebeu — inclusive o parâmetro
   * de codec, que é o que a Meta exige pra reconhecer ogg como opus. Se ela
   * recusar ESSE formato de declaração (a documentação e o comportamento
   * dela nem sempre batem), tenta de novo com o tipo base antes de desistir:
   * uma declaração mais precisa nunca pode deixar de funcionar o que já
   * funcionava.
   */
  async upload(file: {
    buffer: Buffer;
    mimetype: string;
    originalname: string;
  }): Promise<string | null> {
    const tipoBase = file.mimetype.split(';')[0].trim();
    const tentativas =
      tipoBase === file.mimetype ? [file.mimetype] : [file.mimetype, tipoBase];

    let ultimaFalha = '';
    for (const tipo of tentativas) {
      const resultado = await this.tentarUpload(file, tipo);
      if (resultado.id) {
        if (tipo !== file.mimetype) {
          this.logger.warn(
            `A Meta recusou o tipo "${file.mimetype}"; subiu como "${tipo}".`,
          );
        }
        return resultado.id;
      }
      ultimaFalha = resultado.erro ?? 'motivo não informado';
    }

    // O motivo da Meta sobe junto. "A Meta recusou o arquivo" sozinho não
    // diz se o problema é o formato, o tamanho ou o token vencido — e sem
    // isso a única saída de quem atende é tentar de novo até desistir.
    throw new BadRequestException(`A Meta recusou o arquivo: ${ultimaFalha}`);
  }

  private async tentarUpload(
    file: { buffer: Buffer; mimetype: string; originalname: string },
    tipo: string,
  ): Promise<{ id?: string; erro?: string }> {
    const { phoneNumberId, accessToken } = await this.credentials();

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', tipo);
    form.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], { type: tipo }),
      file.originalname,
    );

    const response = await fetch(
      `${GRAPH_BASE}/${GRAPH_API_VERSION}/${phoneNumberId}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      },
    );

    const body = await response.text();
    if (!response.ok) {
      this.logger.error(
        `Falha ao subir mídia como "${tipo}" (${response.status}): ${body}`,
      );
      return { erro: motivoDaMeta(body, response.status) };
    }

    try {
      const id = (JSON.parse(body) as { id?: string }).id;
      this.logger.log(`Mídia subida como "${tipo}": id=${id ?? 'ausente'}.`);
      return { id: id ?? undefined, erro: id ? undefined : 'sem id na resposta' };
    } catch {
      return { erro: 'resposta da Meta ilegível' };
    }
  }

}
