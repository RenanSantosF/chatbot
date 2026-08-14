import { spawn } from 'node:child_process';
import { Logger } from '@nestjs/common';

const logger = new Logger('AudioContainer');

/**
 * Containers de áudio que a Cloud API aceita no upload. Fora desta lista
 * ela recusa na hora — inclusive `audio/webm`, que é o que o Chrome grava.
 */
const ACCEPTED = new Set([
  'audio/aac',
  'audio/amr',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
]);

/**
 * O que a Meta REPRODUZ bem é mais estreito do que o que ela aceita.
 *
 * Passar no upload não é garantia de nada: um mp4 do MediaRecorder é aceito
 * como arquivo e recusado no envio da mensagem, porque o container sai
 * fragmentado e sem duração — o mesmo defeito que faz o player do painel
 * anunciar "1:12:08" para um áudio de nove segundos.
 *
 * ogg/opus é o formato das mensagens de voz do próprio WhatsApp. Converter
 * tudo pra ele troca uma dependência de ffmpeg por um envio que funciona.
 */
export function isAcceptedAudio(mimeType: string) {
  return ACCEPTED.has(baseType(mimeType));
}

export function jaEhOggOpus(mimeType: string) {
  return baseType(mimeType) === 'audio/ogg';
}

function baseType(mimeType: string) {
  return mimeType.split(';')[0].trim().toLowerCase();
}

/**
 * Converte qualquer áudio pra ogg/opus mono em 32 kbps.
 *
 * É recodificação, não remux: a fonte pode ser AAC dentro de mp4, e AAC não
 * entra num Ogg. Mono e 32k porque isto é voz, não música — é a faixa que o
 * próprio WhatsApp usa, e o arquivo fica pequeno o bastante pra subir
 * rápido em rede de celular.
 *
 * Devolve null quando o ffmpeg não está no PATH; quem chamou transforma
 * isso num erro que explica o que instalar, em vez de deixar a Meta recusar
 * com uma mensagem que não ajuda ninguém.
 */
export function converterParaOggOpus(input: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const erros: string[] = [];
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-vn',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        '-ac',
        '1',
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
    // A saída de erro do ffmpeg é guardada, não descartada: quando a
    // conversão falha é a única coisa que diz o porquê ("codec libopus não
    // encontrado", "moov atom not found"), e sem ela o defeito volta a ser
    // adivinhação.
    child.stderr?.on('data', (chunk: Buffer) => erros.push(chunk.toString()));

    child.on('close', (code) => {
      if (failed) return;

      const detalhe = erros.join('').trim();
      if (code !== 0 || chunks.length === 0) {
        logger.error(
          `ffmpeg falhou (código ${code}): ${detalhe || 'sem saída de erro'}`,
        );
        resolve(null);
        return;
      }

      const saida = Buffer.concat(chunks);

      // Um Ogg começa com "OggS". Sem essa conferência, um ffmpeg que sai
      // com código 0 mas escreve lixo produziria um arquivo que a Meta
      // aceita no upload e recusa na entrega — que é exatamente o defeito
      // que esta conversão existe pra evitar.
      if (saida.length < 64 || saida.subarray(0, 4).toString() !== 'OggS') {
        logger.error(
          `ffmpeg terminou bem mas não produziu um Ogg (${saida.length} bytes). ${detalhe}`,
        );
        resolve(null);
        return;
      }

      logger.log(
        `Áudio convertido pra ogg/opus: ${input.length} bytes -> ${saida.length} bytes.`,
      );
      resolve(saida);
    });

    child.stdin?.end(input);
  });
}

/**
 * Diz se dá pra converter áudio nesta máquina. Consultado na subida do
 * servidor pra o aviso aparecer no log do deploy, e não só quando o
 * primeiro atendente tentar mandar um áudio.
 */
export function ffmpegDisponivel(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn('ffmpeg', ['-version']);
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}
