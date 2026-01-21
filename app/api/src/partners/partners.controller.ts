import { Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Authorize } from '../auth/helpers/authorize.decorator';

@Controller()
@ApiTags('Partners')
export class PartnersController {
  constructor() {}

  @Authorize('partner-earthmover-bundle.create')
  @Post(':type/:bundleKey')
  async enableBundle() {}
}
