import { useState } from 'react';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/lib/api-client';

/**
 * Maps API errors onto a form: VALIDATION_ERROR details go to their fields,
 * anything else becomes a form-level message.
 */
export function useApiFormError<T extends FieldValues>(setError: UseFormSetError<T>) {
  const [formError, setFormError] = useState<string | null>(null);

  function handle(error: unknown): ApiError | null {
    if (!(error instanceof ApiError)) {
      setFormError('Something went wrong. Please try again.');
      return null;
    }
    const fieldErrors = error.details.filter((d) => d.field);
    if (error.code === 'VALIDATION_ERROR' && fieldErrors.length > 0) {
      for (const detail of fieldErrors) {
        setError(detail.field as Path<T>, { message: detail.message });
      }
      setFormError(null);
    } else {
      setFormError(error.message);
    }
    return error;
  }

  return { formError, setFormError, handle };
}
