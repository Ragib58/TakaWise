import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env';

export const JWT_ISSUER = 'takawise-api';
export const JWT_AUDIENCE = 'takawise-web';

type AccessTokenClaims = { sub: string; sid: string; typ: 'access' };

export type IssuedAccessToken = { token: string; expiresAt: Date };

/** Short-lived HS256 access tokens (ADR-011). Kept in browser memory only. */
@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  issue(userId: string, sessionId: string): IssuedAccessToken {
    const ttl = this.config.ACCESS_TOKEN_TTL_SECONDS;
    const claims: AccessTokenClaims = { sub: userId, sid: sessionId, typ: 'access' };
    const token = this.jwt.sign(claims, {
      secret: this.config.JWT_ACCESS_SECRET,
      algorithm: 'HS256',
      expiresIn: ttl,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return { token, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  /** Returns the claims, or null for any invalid/expired/tampered token. */
  verify(token: string): { userId: string; sessionId: string } | null {
    try {
      const claims = this.jwt.verify<Partial<AccessTokenClaims>>(token, {
        secret: this.config.JWT_ACCESS_SECRET,
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (
        claims.typ !== 'access' ||
        typeof claims.sub !== 'string' ||
        typeof claims.sid !== 'string'
      ) {
        return null;
      }
      return { userId: claims.sub, sessionId: claims.sid };
    } catch {
      return null;
    }
  }
}
