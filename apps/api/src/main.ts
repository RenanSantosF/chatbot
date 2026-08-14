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

  // Aviso na subida, e não na primeira tentativa de envio: sem ffmpeg todo
  // áudio gravado no painel é recusado, e descobrir isso pelo relato de um
  // atendente ("mandei e não chegou") custa dias.
  if (!(await ffmpegDisponivel())) {
    console.warn(
      '[ffmpeg] Não encontrado no PATH. O envio de áudio gravado no painel vai ' +
        'falhar, porque o formato do navegador precisa ser convertido antes de ir ' +
        'pro WhatsApp. No Railway, o nixpacks.toml na raiz resolve; em máquina ' +
        'local, instale o ffmpeg.',
    );
  }
}
bootstrap();
