/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class AuthGuard implements CanActivate {
  // Parses the bearer token and attaches the resolved actor to the request.
  canActivate(context: ExecutionContext) {
    /**
     * Validates the Authorization header and extracts user information.
     * Supports 'manager', 'admin', and 'employee:<id>' token formats.
     * Attaches user object to request and enforces employee data isolation.
     */
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('Missing Authorization header.');
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException(
        'Authorization header must use Bearer token format.',
      );
    }

    const user = this.parseToken(token);
    const employeeId = request.params.employeeId;

    if (user.role === 'employee' && user.employeeId !== employeeId) {
      throw new ForbiddenException(
        'Employees can only access their own balances.',
      );
    }

    request.user = user;
    return true;
  }

  private parseToken(token: string) {
    /**
     * Parses the bearer token to extract role and employee ID.
     * Supports simple role tokens ('manager', 'admin') and employee tokens ('employee:<id>').
     */
    if (token === 'manager' || token === 'admin') {
      return { role: token };
    }

    if (token.startsWith('employee:')) {
      const employeeId = token.replace('employee:', '');
      if (!employeeId) {
        throw new UnauthorizedException('Employee token is missing an ID.');
      }

      return { role: 'employee', employeeId };
    }

    throw new UnauthorizedException('Unsupported bearer token.');
  }
}
