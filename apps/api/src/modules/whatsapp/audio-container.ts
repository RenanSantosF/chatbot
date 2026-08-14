import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
        // Timestamps do navegador não são de confiança. O MediaRecorder
        // grava com a base de tempo que quiser, e o resultado é um arquivo
        // pequeno que se diz enorme: 5 KB alegando cinco minutos. O player
        // do painel mostrava "5:03 / 5:04" pra um áudio de sete segundos, e
        // a Meta recusava o mesmo arquivo com "Media upload error" —
        // duração declarada e conteúdo não batiam.
        '-fflags',
        '+genpts',
        '-i',
        'pipe:0',
        // Sem faixa de vídeo e sem metadados: capa de álbum e tags de
        // gravador não servem pra nada numa mensagem de voz e são exatamente
        // o tipo de bagagem que faz um parser alheio recusar o arquivo.
        '-vn',
        '-map_metadata',
        '-1',
        // Reescreve os tempos a partir da CONTAGEM DE AMOSTRAS, ignorando o
        // que o container de entrada dizia. É o que faz a duração do Ogg
        // corresponder ao áudio que existe dentro dele.
        '-af',
        'asetpts=N/SR/TB',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        // 48 kHz mono: é a taxa nativa do Opus e o formato das mensagens de
        // voz do próprio WhatsApp. Fixar evita depender do que o navegador
        // gravou.
        '-ar',
        '48000',
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

      // A duração dos dois lados vai pro log. É o número que separa "o
      // arquivo está certo e o player é que mente" de "estamos produzindo
      // um arquivo que se diz mais longo do que é" — e sem ele a diferença
      // só aparece como um erro genérico da Meta, horas depois.
      void Promise.all([duracaoDe(input), duracaoDe(saida)]).then(
        ([antes, depois]) => {
          logger.log(
            `Áudio convertido pra ogg/opus: ${input.length} bytes (${antes}) -> ` +
              `${saida.length} bytes (${depois}).`,
          );
        },
      );
      resolve(saida);
    });

    child.stdin?.end(input);
  });
}

/**
 * Duração que o arquivo DECLARA, em segundos, lida pelo ffprobe.
 *
 * "Declara" é o ponto: um arquivo de 5 KB pode se dizer de cinco minutos
 * quando os tempos internos estão errados, e é essa mentira — não o
 * tamanho — que faz a Meta recusar e o player mostrar bobagem. Devolve
 * texto pronto pro log, porque é só pra ler.
 */
async function duracaoDe(buffer: Buffer): Promise<string> {
  // Arquivo temporário, e não pipe: a duração de um Ogg mora na ÚLTIMA
  // página, então lê-la exige pular pro fim — coisa que um fluxo sequencial
  // não permite. Medir por pipe devolvia "ilegível" mesmo pra arquivo
  // perfeito.
  //
  // Esse mesmo detalhe explica o defeito no painel: sem resposta parcial no
  // proxy de mídia, o navegador também não conseguia alcançar o fim do
  // arquivo e inventava a duração — "5:04" pra sete segundos de áudio.
  const caminho = join(
    tmpdir(),
    `clara-audio-${randomUUID()}${buffer.length}.tmp`,
  );

  try {
    await writeFile(caminho, buffer);
    return await new Promise<string>((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn('ffprobe', [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          caminho,
        ]);
      } catch {
        resolve('duração desconhecida');
        return;
      }

      let saida = '';
      child.on('error', () => resolve('duração desconhecida'));
      child.stdout?.on('data', (chunk: Buffer) => (saida += chunk.toString()));
      child.on('close', () => {
        const segundos = Number.parseFloat(saida.trim());
        resolve(
          Number.isFinite(segundos)
            ? `${segundos.toFixed(1)}s`
            : 'duração ilegível',
        );
      });
    });
  } catch {
    return 'duração desconhecida';
  } finally {
    // Medir não pode encher o disco do servidor.
    await rm(caminho, { force: true }).catch(() => undefined);
  }
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
