import { Global, Module } from '@nestjs/common';
import { ContasDaPlataforma } from './contas-da-plataforma.service';
import { PlataformaController } from './plataforma.controller';
import { PlataformaService } from './plataforma.service';
import { RegistroDeErros } from './registro-de-erros.service';
import { RegistroDeEventos } from './registro-de-eventos.service';

/**
 * O painel do dono da plataforma: funil, origem das contas, receita,
 * uso e erros.
 *
 * Global porque os registros (eventos e erros) são chamados de vários
 * módulos — cadastro, cobrança, sessão — e importar este módulo em cada um
 * seria só cerimônia.
 */
@Global()
@Module({
  controllers: [PlataformaController],
  providers: [
    PlataformaService,
    ContasDaPlataforma,
    RegistroDeEventos,
    RegistroDeErros,
  ],
  exports: [RegistroDeEventos, RegistroDeErros],
})
export class PlataformaModule {}
