import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ffmpegDisponivel } from './modules/whatsapp/audio-container';

async function bootstrap() {
  // rawBody: true preserva o corpo bruto da requisição (além do JSON já
  // parseado) — necessário pra validar a assinatura X-Hub-Signature-256 do
  // webhook do WhatsApp, que é calculada sobre os bytes exatos recebidos.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  /*
   * O corpo do webhook precisa caber.
   *
   * O padrão do Express é 100 KB, generoso pra tudo o que este sistema
   * recebe — menos por uma coisa: o lote de conversas antigas que o
   * aparelho manda ao parear. Cada um chega com milhares de mensagens e
   * passa de cinco megabytes.
   *
   * Sem isto não sobrava rastro no nosso código: a requisição era recusada
   * com 413 ANTES de chegar ao controlador, o histórico nunca aparecia, e
   * o log só mostrava um `PayloadTooLargeError` solto. De fora, a
   * impressão era de que a Evolution não mandava nada.
   *
   * Vinte e cinco megabytes cobre o maior lote observado com folga larga e
   * continua longe de ser um corpo que valha a pena aceitar por engano.
   */
  app.useBodyParser('json', { limit: '25mb' });
  app.useBodyParser('urlencoded', { limit: '25mb', extended: true });

  /**
   * Deploy não pode cortar requisição no meio.
   *
   * Sem isto, o Railway manda SIGTERM e o processo morre na hora: quem
   * estava enviando uma mensagem recebe erro de rede, e — pior — uma
   * entrega da Meta em andamento fica sem 2xx e volta como reentrega. Com
   * os ganchos ligados, o Nest fecha o servidor, espera o que está em voo
   * terminar e só então desconecta o banco (ver PrismaService).
   */
  app.enableShutdownHooks();

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
