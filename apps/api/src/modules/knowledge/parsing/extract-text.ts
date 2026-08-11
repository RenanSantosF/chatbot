import { BadRequestException } from '@nestjs/common';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import * as XLSX from 'xlsx';

export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

async function extractFromPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function extractFromSpreadsheet(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    return `## ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}`;
  }).join('\n\n');
}

/**
 * Converte o arquivo enviado em texto puro, pronto pra ser dividido em
 * chunks e embedado. Cada formato tem sua própria forma de extrair texto —
 * PDF escaneado sem camada de texto (imagem pura) sai vazio, é uma
 * limitação conhecida das bibliotecas usadas aqui, não um bug.
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  switch (mimeType) {
    case 'application/pdf':
      return extractFromPdf(buffer);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractFromDocx(buffer);
    case 'text/plain':
    case 'text/csv':
      return buffer.toString('utf-8');
    case 'application/vnd.ms-excel':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return extractFromSpreadsheet(buffer);
    default:
      throw new BadRequestException(
        `Tipo de arquivo não suportado: ${mimeType}. Envie PDF, DOCX, TXT, CSV ou XLSX.`,
      );
  }
}
