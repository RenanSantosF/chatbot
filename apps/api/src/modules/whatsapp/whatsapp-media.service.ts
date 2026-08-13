import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { StorageService } from '../storage/storage.service';

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
    private readonly encryption: EncryptionService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Acha a mensagem dona de uma mídia pelo id que a Meta deu.
   *
   * O id fica dentro do JSON de metadados, não em coluna própria — é o que
   * permitiu guardar a chave do arquivo sem migração de banco.
   */
  private async mensagemDaMidia(mediaId: string) {
    return this.prisma.db.message.findFirst({
      where: { metadata: { path: ['mediaId'], equals: mediaId } },
      select: { id: true, metadata: true },
    });
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

      const { buffer, mimeType } = await this.baixarDaMeta(mediaId);
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
    if (this.storage.ligado) {
      const mensagem = await this.mensagemDaMidia(mediaId);
      const metadata = (mensagem?.metadata ?? {}) as Record<string, unknown>;

      if (typeof metadata.storageKey === 'string') {
        const guardado = await this.storage.buscar(metadata.storageKey);
        if (guardado) return guardado;
        this.logger.warn(
          `Chave ${metadata.storageKey} não achada no bucket; tentando a Meta.`,
        );
      }

      const daMeta = await this.baixarDaMeta(mediaId);
      void this.arquivar(mediaId, metadata.fileName as string | undefined);
      return daMeta;
    }

    return this.baixarDaMeta(mediaId);
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

  /** Sobe um arquivo pra Meta e devolve o id de mídia usado no envio. */
  async upload(file: {
    buffer: Buffer;
    mimetype: string;
    originalname: string;
  }): Promise<string | null> {
    const { phoneNumberId, accessToken } = await this.credentials();

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', file.mimetype);
    form.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
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
      this.logger.error(`Falha ao subir mídia (${response.status}): ${body}`);
      // O motivo da Meta sobe junto. "A Meta recusou o arquivo" sozinho não
      // diz se o problema é o formato, o tamanho ou o token vencido — e sem
      // isso a única saída de quem atende é tentar de novo até desistir.
      throw new BadRequestException(
        `A Meta recusou o arquivo: ${this.motivoDaMeta(body, response.status)}`,
      );
    }

    try {
      return (JSON.parse(body) as { id?: string }).id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Puxa a explicação de dentro do erro da Meta. Ela nem sempre responde
   * JSON — proxy e gateway dela devolvem HTML em dia ruim —, então o
   * fallback é o código HTTP, que ao menos separa "recusou" de "está fora".
   */
  private motivoDaMeta(body: string, status: number): string {
    try {
      const payload = JSON.parse(body) as {
        error?: { message?: string; error_user_msg?: string };
      };
      const motivo = payload.error?.error_user_msg ?? payload.error?.message;
      if (motivo) return motivo;
    } catch {
      /* resposta não-JSON: cai no código HTTP abaixo */
    }
    return `erro HTTP ${status}`;
  }
}
