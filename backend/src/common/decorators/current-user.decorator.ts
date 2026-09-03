import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export interface AuthUserPayload {
  sub: string;
  email: string;
  organizationId: string;
  role: string;
  iat?: number;
  exp?: number;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUserPayload => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return (req as any).user as AuthUserPayload;
  },
);
