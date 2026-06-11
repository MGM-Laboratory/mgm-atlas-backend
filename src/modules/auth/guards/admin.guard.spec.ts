import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

function ctxWithUser(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('allows an admin user', () => {
    expect(guard.canActivate(ctxWithUser({ id: 'u1', isAdmin: true }))).toBe(true);
  });

  it('rejects a non-admin user', () => {
    expect(() => guard.canActivate(ctxWithUser({ id: 'u1', isAdmin: false }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when there is no user on the request', () => {
    expect(() => guard.canActivate(ctxWithUser(undefined))).toThrow(ForbiddenException);
  });
});
