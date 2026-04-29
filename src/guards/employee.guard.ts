/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class EmployeeGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    /**
     * Ensures the request is made by a user with employee role.
     * Used to protect employee-only endpoints like creating time-off requests.
     */
    const request = context.switchToHttp().getRequest();

    if (request.user?.role !== 'employee') {
      throw new ForbiddenException(
        'Employee role is required for this operation.',
      );
    }

    return true;
  }
}
