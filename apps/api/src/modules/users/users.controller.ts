import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('OWNER', 'ADMIN')
  listTeam() {
    return this.usersService.listTeam();
  }
}
