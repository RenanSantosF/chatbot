import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ffmpegDisponivel } from './modules/whatsapp/audio-container';

async function bootstrap() {
  // rawBody: true preserva o corpo bruto da requisição (além do JSON já
  // parseado) — necessário pra validar a assinatura X-Hub-Signature-256 do
  // webhook do WhatsApp, que é calculada sobre os bytes exatos recebidos.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use(cookieParser());
  app.enableCors({
    origin: process.env.WEB_APP_URL ?? 'http://localhost:3000',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  console.log(`API rodando em http://localhost:${port}/api`);

  /**
   * Carimbo do que está rodando de verdade.
   *
   * Existe por causa de uma hora perdida: um defeito de áudio continuou
   * depois da correção, e não havia como saber se o servidor tinha o código
   * novo ou não — a única pista era a AUSÊNCIA de um aviso, que também é o
   * comportamento do código antigo. Ausência não é evidência. Agora cada
   * subida diz qual commit é e o que tem instalado, sempre, mesmo quando
   * está tudo certo.
   */
  const commit =
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT ??
    'desconhecido';
  const temFfmpeg = await ffmpegDisponivel();

  console.log(
    `[build] commit=${commit.slice(0, 8)} ffmpeg=${temFfmpeg ? 'sim' : 'NÃO'} ` +
      `armazenamento=${process.env.S3_BUCKET ? 'ligado' : 'desligado'}`,
  );

  if (!temFfmpeg) {
    console.warn(
      '[ffmpeg] Não encontrado no PATH. O envio de áudio gravado no painel vai ' +
        'falhar, porque o formato do navegador precisa ser convertido antes de ir ' +
        'pro WhatsApp. No Railway, o nixpacks.toml na raiz resolve; em máquina ' +
        'local, instale o ffmpeg.',
    );
  }
}
// Falha na subida precisa derrubar o processo com código de erro: o
// Railway reinicia, e um servidor meio inicializado atendendo requisição é
// pior que um servidor fora do ar.
void bootstrap();
