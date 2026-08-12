import { Body, Controller, Get, Put } from '@nestjs/common';
import { IsBoolean, IsIn, IsString } from 'class-validator';
import { Roles } from '../../common/auth/roles.decorator';
import {
  ALL_PERMISSION_KEYS,
  type PermissionKey,
} from './permissions.constants';
import { PermissionsService } from './permissions.service';

class SetPermissionDto {
  @IsIn(['ADMIN', 'AGENT'])
  role!: 'ADMIN' | 'AGENT';

  @IsString()
  @IsIn(ALL_PERMISSION_KEYS)
  key!: PermissionKey;

  @IsBoolean()
  allowed!: boolean;
}

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  // Qualquer usuário lê a matriz: o painel usa isso pra esconder o que a
  // pessoa não pode fazer. Só o dono escreve.
  @Get()
  matrix() {
    return this.permissionsService.matrix();
  }

  @Put()
  @Roles('OWNER')
  set(@Body() dto: SetPermissionDto) {
    return this.permissionsService.set(dto.role, dto.key, dto.allowed);
  }
}
