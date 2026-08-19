import { Body, Controller, Delete, Get, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { Roles } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { AccountService } from './account.service';
import { ExcluirContaDto } from './dto/excluir-conta.dto';

/**
 * A conta da empresa — e o botão de apagá-la.
 *
 * Só o dono. Admin configura a operação; encerrar a empresa e levar junto
 * o histórico de atendimento de todo mundo é outra ordem de decisão, e não
 * é reversível por suporte: o cascade não deixa nada pra restaurar.
 */
@Controller('account')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OWNER')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  resumo() {
    return this.account.resumo();
  }

  @Delete()
  async excluir(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ExcluirContaDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.account.excluir(req.user!.userId, dto);
    // O cookie de sessão aponta pra um usuário que não existe mais. Sem
    // apagá-lo aqui, a próxima tela abre "autenticada" e quebra em 401 em
    // cada requisição, com a pessoa sem entender o que aconteceu.
    res.clearCookie('access_token', { path: '/' });
    return resultado;
  }
}
