import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';

/** OWASP Password Storage Cheat Sheet minimum for Argon2id (ADR-011). */
export const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordHasher implements OnModuleInit {
  /** Hash of a random value, verified against when the user does not exist (timing parity). */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash(`dummy-${Math.random()}-${Date.now()}`, ARGON2_OPTIONS);
  }

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Spend the same time as a real verification so response times do not reveal
   * whether an email is registered.
   */
  async verifyAgainstDummy(password: string): Promise<false> {
    if (!this.dummyHash) await this.onModuleInit();
    await this.verify(this.dummyHash, password);
    return false;
  }
}
