import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import type { RequestUser } from '../auth/auth.types';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('OWNER', 'ADMIN')
  listTeam() {
    return this.usersService.listTeam();
  }

  /** Só o dono cria colaborador — quem define quem tem acesso à empresa é ele. */
  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
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
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.usersService.update(id, dto, user.userId);
  }
}
