import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);

/**
 * Decorator to get the current authenticated student's ID.
 * Requires the user to have the STUDENT role and a valid studentId in the JWT.
 */
export const CurrentStudent = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    
    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    const studentId = user.studentId;
    
    if (!studentId) {
      throw new ForbiddenException('You do not have a student profile. Only students can access this resource.');
    }

    // Return the studentId if no specific field is requested
    if (!data) {
      return studentId;
    }

    // For specific fields, return from the user object (which should be populated from JWT)
    return user[data];
  },
);
