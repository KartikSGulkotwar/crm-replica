import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DemoLoginDto } from '@crm-replica/shared';
import { Public } from '../auth/auth.decorators';
import { loadEnv } from '../config/env';

@ApiTags('auth')
@Controller('auth')
export class DemoLoginController {
  /** The login is public on purpose: it's printed on the login page for visitors. */
  @Get('demo')
  @Public()
  @ApiOperation({ summary: 'The public demo login (when this server runs the demo)' })
  demo(): DemoLoginDto {
    const env = loadEnv();
    return env.DEMO_MODE
      ? { enabled: true, email: env.DEMO_EMAIL.toLowerCase(), password: env.DEMO_PASSWORD }
      : { enabled: false };
  }
}
