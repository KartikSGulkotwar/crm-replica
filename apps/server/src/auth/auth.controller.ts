import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { SessionResponse } from '@crm-replica/shared';
import type { Response } from 'express';
import { Auth, AuthContext, Public } from './auth.decorators';
import { AuthService } from './auth.service';
import { AcceptInviteDto, LoginDto, SignupDto } from './dto/auth.dto';
import { clearSessionCookie, setSessionCookie } from './session-cookie';

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Creates a new workspace with you as its admin, and logs you in. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('auth/signup')
  async signup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const { token, session } = await this.auth.signup(dto);
    setSessionCookie(res, token);
    return session;
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const { token, session } = await this.auth.login(dto);
    setSessionCookie(res, token);
    return session;
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    clearSessionCookie(res);
  }

  @ApiCookieAuth()
  @Get('auth/me')
  me(@Auth() { user, workspace }: AuthContext): SessionResponse {
    return this.auth.toSession(user, workspace);
  }

  /** Creates an account in the workspace behind the invite link, and logs you in. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('invites/:token/accept')
  async acceptInvite(
    @Param('token') token: string,
    @Body() dto: AcceptInviteDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const { token: jwt, session } = await this.auth.acceptInvite(token, dto);
    setSessionCookie(res, jwt);
    return session;
  }
}
