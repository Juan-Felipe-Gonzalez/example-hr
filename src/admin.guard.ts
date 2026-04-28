import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    /**
     * Ensures the request is made by a user with admin role.
     * Used to protect admin-only endpoints like batch sync operations.
     */
    const request = context.switchToHttp().getRequest();

    if (request.user?.role !== 'admin') {
      throw new ForbiddenException('Admin role is required for this operation.');
    }

    return true;
  }
}

