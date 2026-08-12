import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';

const GRAPH_API_VERSION = 'v21.0';

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
  ) {}

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

  /** Busca o binário de uma mídia recebida, em dois passos como a Meta exige. */
  async download(mediaId: string): Promise<DownloadedMedia> {
    const { accessToken } = await this.credentials();
    const headers = { Authorization: `Bearer ${accessToken}` };

    const lookup = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`,
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
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      },
    );

    const body = await response.text();
    if (!response.ok) {
      this.logger.error(`Falha ao subir mídia (${response.status}): ${body}`);
      return null;
    }

    try {
      return (JSON.parse(body) as { id?: string }).id ?? null;
    } catch {
      return null;
    }
  }
}
