import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import type { RequestUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('OWNER', 'ADMIN')
  listTeam() {
    return this.usersService.listTeam();
  }

  // Sem @Roles: qualquer pessoa que atende precisa saber pra quem pode
  // passar uma conversa. Vem antes de ':id' pela mesma ordem de casamento
  // de rotas explicada abaixo.
  @Get('assignable')
  listAssignable() {
    return this.usersService.listAssignable();
  }

  /** Só o dono cria colaborador — quem define quem tem acesso à empresa é ele. */
  @Post()
  @Roles('OWNER')
  async create(@Body() dto: CreateUserDto, @CurrentUser() user: RequestUser) {
    const criado = await this.usersService.create(dto);
    await this.audit.registrar(
      { userId: user.userId, name: user.name },
      {
        action: 'COLABORADOR_CRIADO',
        resumo: `Adicionou ${criado.user.name} à equipe como ${PAPEL[criado.user.role]}.`,
        // A senha temporária NÃO entra no registro. Ela é o segredo que
        // o dono acabou de ver uma vez, e guardá-la aqui a tornaria
        // legível pra sempre por qualquer admin.
        snapshot: { email: criado.user.email, role: criado.user.role },
      },
    );
    return criado;
  }

  // As rotas de 'me' vêm antes de ':id' de propósito: o Nest casa na ordem
  // de declaração, e se ':id' viesse antes ele engoliria 'me' como um id.
  // Sem @Roles: qualquer usuário mexe na própria conta, inclusive AGENT.
  @Get('me')
  getProfile(@CurrentUser() user: RequestUser) {
    return this.usersService.getProfile(user.userId);
  }

  @Patch('me')
  updateProfile(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.usersService.updateProfile(user.userId, dto);
  }

  @Patch(':id')
  @Roles('OWNER')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: RequestUser,
  ) {
    const atualizado = await this.usersService.update(id, dto, user.userId);

    /*
     * Desativar alguém é a mudança que mais importa aqui, e por isso
     * ganha ação própria em vez de virar "alterado".
     *
     * Ninguém é removido de verdade do sistema — o histórico de
     * atendimento dessa pessoa precisa continuar de pé —, então o que se
     * vê no registro tem que ser o que de fato aconteceu: o acesso dela
     * acabou.
     */
    const desativado = dto.status === 'DISABLED';
    await this.audit.registrar(
      { userId: user.userId, name: user.name },
      {
        action: desativado ? 'COLABORADOR_REMOVIDO' : 'COLABORADOR_ALTERADO',
        resumo: desativado
          ? `Removeu o acesso de ${atualizado.name}.`
          : `Alterou o cadastro de ${atualizado.name} (${DESCRICAO_DA_MUDANCA(dto)}).`,
        snapshot: { ...dto },
      },
    );
    return atualizado;
  }
}

const PAPEL: Record<string, string> = {
  OWNER: 'dono',
  ADMIN: 'admin',
  AGENT: 'atendente',
};

/**
 * O que mudou, em palavras, montado na hora da mudança.
 *
 * Guardar só o Json cru resolveria pra quem lê Json. A tela é lida por
 * dono de loja.
 */
function DESCRICAO_DA_MUDANCA(dto: UpdateUserDto): string {
  const partes: string[] = [];
  if (dto.role) partes.push(`papel: ${PAPEL[dto.role] ?? dto.role}`);
  if (dto.status === 'ACTIVE') partes.push('acesso reativado');
  return partes.length > 0 ? partes.join(', ') : 'sem alteração visível';
}
