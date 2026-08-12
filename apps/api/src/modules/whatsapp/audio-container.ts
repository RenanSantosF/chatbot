import { spawn } from 'node:child_process';
import { Logger } from '@nestjs/common';

const logger = new Logger('AudioContainer');

/**
 * Containers de áudio que a Cloud API aceita. Fora desta lista ela recusa o
 * upload — inclusive `audio/webm`, que é justamente o que o Chrome grava
 * pelo MediaRecorder. Ou seja: sem conversão, gravar áudio no navegador
 * mais usado do mundo simplesmente não funcionaria.
 */
const ACCEPTED = new Set([
  'audio/aac',
  'audio/amr',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
]);

function baseType(mimeType: string) {
  return mimeType.split(';')[0].trim().toLowerCase();
}

export function isAcceptedAudio(mimeType: string) {
  return ACCEPTED.has(baseType(mimeType));
}

/**
 * Troca o container de webm/opus pra ogg/opus. É remux, não recodificação
 * (`-c:a copy`): o fluxo Opus vai inteiro pra dentro do Ogg, então é
 * rápido e não perde qualidade.
 *
 * Depende do ffmpeg estar no PATH da máquina da API. Quando não está,
 * devolve null e quem chamou decide o que dizer pro usuário — melhor um
 * aviso claro do que um "a Meta recusou o arquivo" que não explica nada.
 */
export function remuxToOggOpus(input: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-c:a',
        'copy',
        '-f',
        'ogg',
        'pipe:1',
      ]);
    } catch {
      resolve(null);
      return;
    }

    const chunks: Buffer[] = [];
    let failed = false;

    child.on('error', () => {
      failed = true;
      resolve(null);
    });
    child.stdin?.on('error', () => {
      /* o processo pode morrer antes de consumir tudo; o 'close' resolve */
    });
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) =>
      logger.debug(chunk.toString().trim()),
    );

    child.on('close', (code) => {
      if (failed) return;
      if (code !== 0 || chunks.length === 0) {
        resolve(null);
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    child.stdin?.end(input);
  });
}
