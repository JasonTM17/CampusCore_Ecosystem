import type { CookieOptions, Request, Response } from 'express';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

export const ACCESS_TOKEN_COOKIE: 'cc_access_token';
export const REFRESH_TOKEN_COOKIE: 'cc_refresh_token';
export const CSRF_COOKIE: 'cc_csrf';
export const CSRF_HEADER: 'x-csrf-token';
export const CSRF_HEADER_NAME: 'X-CSRF-Token';
export const INTERNAL_API_PREFIX: '/api/v1/internal';
export const INTERNAL_SERVICE_TOKEN_HEADER: 'x-service-token';
export const INTERNAL_SERVICE_TOKEN_HEADER_NAME: 'X-Service-Token';
export const HEALTH_READINESS_HEADER: 'x-health-key';
export const HEALTH_READINESS_HEADER_NAME: 'X-Health-Key';
export const JWT_CLAIMS_VERSION: 1;
export const ROLES_KEY: 'roles';

export type BaseAuthRole = string;

export interface AuthUserStudentProfile {
  year?: number | null;
}

export interface BaseAuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  gender?: string | null;
  dateOfBirth?: Date | string | null;
  address?: string | null;
  avatar?: string | null;
  status?: string;
  createdAt?: Date | string;
  roles: BaseAuthRole[];
  permissions: string[];
  studentId?: string | null;
  lecturerId?: string | null;
  student?: AuthUserStudentProfile | null;
  claimsVersion?: number;
}

export interface JwtPayloadLike {
  sub: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  gender?: string | null;
  dateOfBirth?: Date | string | null;
  address?: string | null;
  avatar?: string | null;
  status?: string;
  createdAt?: Date | string;
  roles?: string[];
  permissions?: string[];
  studentId?: string | null;
  lecturerId?: string | null;
  student?: AuthUserStudentProfile | null;
  claimsVersion?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SessionCookieOptionsInput {
  maxAgeMs: number;
  httpOnly: boolean;
  secure: boolean;
  path?: string;
}

export interface IssueSessionCookiesOptions extends AuthTokens {
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
  secure: boolean;
  path?: string;
}

export interface ClearSessionCookiesOptions {
  secure: boolean;
  path?: string;
}

export const CurrentUser: (data?: string) => ParameterDecorator;
export const CurrentStudent: (data?: string) => ParameterDecorator;
export const CurrentLecturer: (data?: string) => ParameterDecorator;
export const Roles: (...roles: string[]) => MethodDecorator & ClassDecorator;

export class JwtAuthGuard {
  canActivate(context: ExecutionContext): ReturnType<CanActivate['canActivate']>;
  handleRequest<TUser = unknown>(err: unknown, user: TUser): TUser;
}

export class RolesGuard implements CanActivate {
  constructor(reflector?: { getAllAndOverride<T = string[]>(key: string, targets: unknown[]): T | undefined });
  canActivate(context: ExecutionContext): boolean;
}

export function parseCookieHeader(cookieHeader?: string | null): Record<string, string>;
export function normalizeSetCookie(setCookie?: string[] | string): string[];
export function extractCookieValue(setCookie: string[] | string | undefined, name: string): string | undefined;
export function toCookieHeader(setCookie: string[] | string | undefined): string;
export function extractAccessTokenFromCookieHeader(cookieHeader?: string | null): string | null;
export function extractAccessTokenFromRequest(request: Request): string | null;
export function extractRefreshTokenFromRequest(request: Request): string | null;
export function hasBearerAuthorization(request: Request): boolean;
export function hasSessionCookie(request: Request): boolean;
export function parseDurationToMs(duration: string): number;
export function buildSessionCookieOptions(options: SessionCookieOptionsInput): CookieOptions;
export function issueSessionCookies(response: Response, options: IssueSessionCookiesOptions): string;
export function clearSessionCookies(response: Response, options: ClearSessionCookiesOptions): void;
export function normalizeJwtPayload(payload: JwtPayloadLike): BaseAuthUser;
