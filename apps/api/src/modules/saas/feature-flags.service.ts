import { HttpStatus, Injectable } from '@nestjs/common';
import { FEATURE_FLAG_KEYS, type FeatureFlagKey } from '@takawise/contracts';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';

/**
 * Admin-managed runtime switches (ADR-027). Read from the database on every
 * check so turning one off takes effect immediately across instances. A
 * missing row means "on" (seeded defaults are all on).
 */
@Injectable()
export class FeatureFlagsService {
  constructor(private readonly prisma: PrismaService) {}

  async isOn(key: FeatureFlagKey): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({
      where: { key },
      select: { enabled: true },
    });
    return flag?.enabled ?? true;
  }

  async assertOn(key: FeatureFlagKey): Promise<void> {
    if (!(await this.isOn(key))) {
      throw new AppException(
        'FEATURE_DISABLED',
        'This feature is not available.',
        HttpStatus.FORBIDDEN,
        [{ message: key }],
      );
    }
  }

  async all(): Promise<Record<string, boolean>> {
    const rows = await this.prisma.featureFlag.findMany({ select: { key: true, enabled: true } });
    const map: Record<string, boolean> = Object.fromEntries(
      FEATURE_FLAG_KEYS.map((k) => [k, true]),
    );
    for (const row of rows) map[row.key] = row.enabled;
    return map;
  }
}
