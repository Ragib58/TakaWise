import { SetMetadata } from '@nestjs/common';

export const SKIP_ENVELOPE = 'takawise:skip-envelope';

/** Opt a route out of the JSON envelope (e.g. CSV/file streams). */
export const SkipEnvelope = () => SetMetadata(SKIP_ENVELOPE, true);
