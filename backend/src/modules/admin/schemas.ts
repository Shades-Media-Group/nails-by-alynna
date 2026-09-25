import { z } from 'zod';
import { i18nOptionalTextSchema, i18nTextSchema, objectIdSchema, timeSchema } from '../../lib/validation';
import { timeToMinutes } from '../../lib/time';

export const swatchColorSchema = z.enum(['blush', 'cyan', 'peach', 'mint', 'lilac']);
export const serviceArtSchema = z.enum(['gel', 'french', 'extension', 'pedicure', 'design', 'removal', 'care']);

const intervalSchema = z
  .object({ start: timeSchema, end: timeSchema })
  .refine((i) => timeToMinutes(i.start) < timeToMinutes(i.end), 'end_before_start');

/** Seven days (Mon..Sun), each with up to four non-overlapping intervals. */
export const weeklySchema = z
  .array(z.array(intervalSchema).max(4, 'too_many'))
  .length(7, 'invalid')
  .refine(
    (days) =>
      days.every((intervals) => {
        const sorted = [...intervals].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
        return sorted.every((cur, i) => i === 0 || timeToMinutes(sorted[i - 1]!.end) <= timeToMinutes(cur.start));
      }),
    'overlapping',
  )
  .transform((days) =>
    days.map((intervals) =>
      [...intervals].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)),
    ),
  );

export const categoryInputSchema = z.object({
  name: i18nTextSchema(60),
  color: swatchColorSchema,
  isActive: z.boolean().default(true),
});

export const serviceInputSchema = z.object({
  categoryId: objectIdSchema,
  name: i18nTextSchema(80),
  description: i18nOptionalTextSchema(400),
  durationMin: z.number().int().min(5, 'too_short').max(480, 'too_long'),
  price: z.number().int().min(0, 'invalid').max(100_000, 'invalid'),
  priceFrom: z.boolean().default(false),
  art: serviceArtSchema.default('gel'),
  isPopular: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const staffInputSchema = z.object({
  name: z.string().trim().min(1, 'required').max(60, 'too_long'),
  title: i18nOptionalTextSchema(60),
  color: swatchColorSchema.default('blush'),
  weekly: weeklySchema,
  serviceIds: z.array(objectIdSchema).max(200).nullable().default(null),
  isBookable: z.boolean().default(true),
  isActive: z.boolean().default(true),
  userId: objectIdSchema.nullable().default(null),
});
