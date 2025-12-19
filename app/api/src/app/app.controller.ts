import { Controller, Get, ImATeapotException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ErrorResponse } from '../utils';
import { Public } from '../auth/login/public.decorator';

@ApiTags('App')
@Controller()
export class AppController {
  @Public()
  @Get('healthcheck')
  @ErrorResponse(new ImATeapotException('ts'))
  healthcheck() {
    return "Feelin' great!";
  }
}
