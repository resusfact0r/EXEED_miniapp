import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers['x-admin-token'];
    const expected = process.env.ADMIN_API_TOKEN;

    if (!expected || token !== expected) {
      throw new UnauthorizedException('Invalid admin token');
    }

    return true;
  }
}
