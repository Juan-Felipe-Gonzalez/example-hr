import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class ManagerOrAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    /**
     * Ensures the request is made by a user with manager or admin role.
     * Used to protect management endpoints like approving/rejecting requests.
     */
    const request = context.switchToHttp().getRequest();

    if (request.user?.role !== 'manager' && request.user?.role !== 'admin') {
      throw new ForbiddenException(
        'Manager or Admin role is required for this operation.',
      );
    }

    return true;
  }
}
