import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';

/** Minutos que um link de anexo vive. Curto: ele vaza fácil (histórico,
 *  print, encaminhamento) e não deve valer nada depois da visita. */
const VALIDADE_DO_LINK_EM_SEGUNDOS = 10 * 60;

/**
 * Guarda os anexos das conversas em armazenamento próprio.
 *
 * Existe por um motivo concreto: a Meta apaga a mídia depois de 30 dias.
 * Até aqui o sistema guardava só o ponteiro, então uma procuração enviada
 * hoje simplesmente não abria no mês seguinte — perda de documento, não
 * inconveniência de tela.
 *
 * O bucket é da plataforma e nunca é público. Cada empresa vive sob o
 * próprio prefixo, e o painel recebe link assinado de vida curta em vez do
 * arquivo direto.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly cliente: S3Client | null;
  private readonly bucket: string | null;

  constructor() {
    const bucket = process.env.S3_BUCKET;
    const region = process.env.S3_REGION;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      // Sem configuração o sistema continua funcionando como antes,
      // buscando da Meta. É o que permite ligar isto sem parar nada.
      this.cliente = null;
      this.bucket = null;
      this.logger.warn(
        'Armazenamento de anexos desligado: faltam variáveis S3_*. Anexos seguem vindo da Meta e somem em 30 dias.',
      );
      return;
    }

    this.bucket = bucket;
    this.cliente = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      // Endpoint próprio permite trocar a AWS por Cloudflare R2 ou
      // MinIO sem mexer em código — os três falam o mesmo protocolo.
      ...(process.env.S3_ENDPOINT
        ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
        : {}),
    });
  }

  get ligado(): boolean {
    return this.cliente !== null;
  }

  /**
   * Caminho do arquivo dentro do bucket.
   *
   * Começa pelo tenant porque é isso que permite, um dia, apagar ou exportar
   * tudo de uma empresa com uma operação só — e porque uma política de IAM
   * por prefixo fica possível se algum cliente exigir separação dura.
   * A data no meio evita milhões de objetos num diretório só.
   */
  private caminho(tenantId: string, mediaId: string, extensao: string) {
    const agora = new Date();
    const ano = agora.getUTCFullYear();
    const mes = String(agora.getUTCMonth() + 1).padStart(2, '0');
    return `${tenantId}/${ano}/${mes}/${mediaId}${extensao}`;
  }

  /**
   * Sobe o binário e devolve a chave onde ele ficou. Devolve null quando o
   * armazenamento está desligado — quem chama segue sem ele.
   */
  async guardar(entrada: {
    tenantId: string;
    mediaId: string;
    buffer: Buffer;
    mimeType: string;
    fileName?: string;
  }): Promise<string | null> {
    if (!this.cliente || !this.bucket) return null;

    const extensao = entrada.fileName?.includes('.')
      ? entrada.fileName.slice(entrada.fileName.lastIndexOf('.'))
      : '';
    const chave = this.caminho(entrada.tenantId, entrada.mediaId, extensao);

    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: chave,
        Body: entrada.buffer,
        ContentType: entrada.mimeType,
        // O nome original volta no download sem precisar de outra consulta.
        ...(entrada.fileName
          ? { Metadata: { nome: encodeURIComponent(entrada.fileName) } }
          : {}),
      }),
    );

    this.logger.log(`Anexo guardado: ${chave} (${entrada.buffer.length} bytes).`);
    return chave;
  }

  /** Link temporário pro navegador buscar direto, sem passar pela API. */
  async linkTemporario(chave: string): Promise<string | null> {
    if (!this.cliente || !this.bucket) return null;
    return getSignedUrl(
      this.cliente,
      new GetObjectCommand({ Bucket: this.bucket, Key: chave }),
      { expiresIn: VALIDADE_DO_LINK_EM_SEGUNDOS },
    );
  }

  /** Baixa de volta. Usado quando o painel prefere servir pela API. */
  async buscar(chave: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    if (!this.cliente || !this.bucket) return null;

    const saida = await this.cliente.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: chave }),
    );
    if (!saida.Body) return null;

    return {
      buffer: Buffer.from(await saida.Body.transformToByteArray()),
      mimeType: saida.ContentType ?? 'application/octet-stream',
    };
  }

  async apagar(chave: string): Promise<void> {
    if (!this.cliente || !this.bucket) return;
    await this.cliente.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: chave }),
    );
  }

  /**
   * Tudo o que é de uma empresa, de uma vez.
   *
   * É pra isso que o caminho começa pelo tenant (ver `caminho`). Sem esta
   * varredura, apagar a conta apagaria as linhas do banco e deixaria os
   * arquivos no bucket pra sempre: ninguém mais saberia que existem, a
   * conta segue sendo paga, e são documentos de cliente de uma empresa
   * que pediu pra sumir.
   *
   * Em páginas de mil, que é o teto do `DeleteObjects` da API S3, e
   * devolve quantos saíram — o número vai pro log de quem apagou a conta.
   */
  async apagarDaEmpresa(tenantId: string): Promise<number> {
    if (!this.cliente || !this.bucket) return 0;

    let apagados = 0;
    let continuacao: string | undefined;

    do {
      const pagina = await this.cliente.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${tenantId}/`,
          ContinuationToken: continuacao,
        }),
      );

      const chaves = (pagina.Contents ?? [])
        .map((objeto) => objeto.Key)
        .filter((chave): chave is string => Boolean(chave));

      if (chaves.length > 0) {
        await this.cliente.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: chaves.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        apagados += chaves.length;
      }

      // `IsTruncated` diz que ficou coisa pra trás; sem seguir o token, um
      // bucket grande ficaria com tudo depois do milésimo arquivo.
      continuacao = pagina.IsTruncated ? pagina.NextContinuationToken : undefined;
    } while (continuacao);

    this.logger.log(`Anexos da empresa ${tenantId} apagados: ${apagados}.`);
    return apagados;
  }
}
