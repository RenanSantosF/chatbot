import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { AiCredentialsResolver } from '../ai/providers/ai-credentials.resolver';
import { AI_EMBEDDING_PROVIDER, type AiEmbeddingProvider } from '../ai/providers/ai-provider.interface';
import { chunkText } from './parsing/chunk-text';
import { extractText } from './parsing/extract-text';

/** Guarda-chuva contra um documento gigante travando o processamento síncrono. */
const MAX_CHUNKS_PER_DOCUMENT = 500;
const SEARCH_RESULT_LIMIT = 5;

interface UploadedFileInput {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

interface RelevantChunk {
  content: string;
  documentTitle: string;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly credentials: AiCredentialsResolver,
    @Inject(AI_EMBEDDING_PROVIDER) private readonly embeddingProvider: AiEmbeddingProvider,
  ) {}

  list() {
    return this.prisma.db.knowledgeDocument.findMany({ orderBy: { createdAt: 'desc' } });
  }

  private async requireDocument(id: string) {
    const document = await this.prisma.db.knowledgeDocument.findFirst({ where: { id } });
    if (!document) {
      throw new NotFoundException('Documento não encontrado.');
    }
    return document;
  }

  async remove(id: string) {
    await this.requireDocument(id);
    // KnowledgeChunk tem onDelete: Cascade — apaga os chunks junto.
    await this.prisma.db.knowledgeDocument.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Processa o upload de ponta a ponta, de forma síncrona: extrai texto,
   * divide em chunks, gera embeddings, grava. Aceitável pro volume de
   * documentos de um MVP; se virar gargalo com arquivos grandes, é o
   * candidato natural pra fila em background (BullMQ/Redis já estão na
   * arquitetura prevista pro projeto).
   */
  async uploadDocument(file: UploadedFileInput, title?: string) {
    const { credentials } = await this.credentials.resolve();
    if (!credentials) {
      throw new BadRequestException(
        'Configure a API key da IA em Configurações > IA antes de enviar documentos.',
      );
    }

    const document = await this.prisma.db.knowledgeDocument.create({
      data: {
        tenantId: this.prisma.tenantId,
        title: title?.trim() || file.originalname,
        fileName: file.originalname,
        mimeType: file.mimetype,
        status: 'PROCESSING',
      },
    });

    try {
      const text = await extractText(file.buffer, file.mimetype);
      const chunks = chunkText(text).slice(0, MAX_CHUNKS_PER_DOCUMENT);

      if (chunks.length === 0) {
        return this.prisma.db.knowledgeDocument.update({
          where: { id: document.id },
          data: { status: 'FAILED', errorMessage: 'Não encontramos texto legível neste arquivo.' },
        });
      }

      const embeddings = await this.embeddingProvider.embed({
        texts: chunks,
        apiKey: credentials.apiKey,
        taskType: 'RETRIEVAL_DOCUMENT',
      });

      for (let i = 0; i < chunks.length; i += 1) {
        await this.prisma.db.$executeRaw`
          INSERT INTO knowledge_chunks (id, "tenantId", "documentId", content, embedding, "createdAt")
          VALUES (${randomUUID()}, ${this.prisma.tenantId}, ${document.id}, ${chunks[i]}, ${toVectorLiteral(embeddings[i])}::vector, now())
        `;
      }

      return this.prisma.db.knowledgeDocument.update({
        where: { id: document.id },
        data: { status: 'READY' },
      });
    } catch (error) {
      this.logger.error(
        `Falha ao processar documento ${document.id}`,
        error instanceof Error ? error.stack : error,
      );
      const message = error instanceof Error ? error.message : 'Falha ao processar o documento.';
      return this.prisma.db.knowledgeDocument.update({
        where: { id: document.id },
        data: { status: 'FAILED', errorMessage: message },
      });
    }
  }

  /**
   * Busca semântica: devolve só os trechos relevantes pra pergunta, nunca a
   * base inteira (ver AiContextBuilder, que consome isto). Retorna []
   * silenciosamente sem credencial ou sem chunks — RAG é um complemento
   * opcional, sua ausência não deve impedir a IA de responder.
   */
  async searchRelevantChunks(query: string): Promise<RelevantChunk[]> {
    const { credentials } = await this.credentials.resolve();
    if (!credentials) {
      return [];
    }

    let queryEmbedding: number[];
    try {
      const [embedding] = await this.embeddingProvider.embed({
        texts: [query],
        apiKey: credentials.apiKey,
        taskType: 'RETRIEVAL_QUERY',
      });
      queryEmbedding = embedding;
    } catch (error) {
      this.logger.warn(`Falha ao gerar embedding da busca: ${error instanceof Error ? error.message : error}`);
      return [];
    }

    const vectorLiteral = toVectorLiteral(queryEmbedding);

    // SQL raw não passa pela extensão de isolamento por tenant — o filtro
    // de tenantId aqui é manual e obrigatório.
    return this.prisma.db.$queryRaw<RelevantChunk[]>`
      SELECT kc.content, kd.title as "documentTitle"
      FROM knowledge_chunks kc
      JOIN knowledge_documents kd ON kd.id = kc."documentId"
      WHERE kc."tenantId" = ${this.prisma.tenantId}
      ORDER BY kc.embedding <=> ${vectorLiteral}::vector
      LIMIT ${SEARCH_RESULT_LIMIT}
    `;
  }
}
