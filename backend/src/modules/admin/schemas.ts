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

/*
 * Each resource has a create schema (with defaults) and an edit schema built from the same
 * fields WITHOUT defaults: zod fills `.default()` values in even under `.partial()`, so an
 * edit that sends only a price would otherwise also reset every defaulted field.
 */

const categoryFields = {
  name: i18nTextSchema(60),
  description: i18nOptionalTextSchema(300).nullable(),
  singleChoice: z.boolean(),
  color: swatchColorSchema,
  isActive: z.boolean(),
};
export const categoryInputSchema = z.object({
  ...categoryFields,
  description: categoryFields.description.default(null),
  singleChoice: categoryFields.singleChoice.default(false),
  isActive: categoryFields.isActive.default(true),
});
export const categoryPatchSchema = z.object(categoryFields).partial();

const serviceFields = {
  categoryId: objectIdSchema,
  name: i18nTextSchema(80),
  description: i18nOptionalTextSchema(400),
  durationMin: z.number().int().min(5, 'too_short').max(480, 'too_long'),
  price: z.number().int().min(0, 'invalid').max(100_000, 'invalid'),
  priceFrom: z.boolean(),
  art: serviceArtSchema,
  isPopular: z.boolean(),
  isActive: z.boolean(),
};
export const serviceInputSchema = z.object({
  ...serviceFields,
  priceFrom: serviceFields.priceFrom.default(false),
  art: serviceFields.art.default('gel'),
  isPopular: serviceFields.isPopular.default(false),
  isActive: serviceFields.isActive.default(true),
});
export const servicePatchSchema = z.object(serviceFields).partial();

const staffFields = {
  name: z.string().trim().min(1, 'required').max(60, 'too_long'),
  title: i18nOptionalTextSchema(60),
  color: swatchColorSchema,
  weekly: weeklySchema,
  serviceIds: z.array(objectIdSchema).max(200).nullable(),
  isBookable: z.boolean(),
  isActive: z.boolean(),
  userId: objectIdSchema.nullable(),
};
export const staffInputSchema = z.object({
  ...staffFields,
  color: staffFields.color.default('blush'),
  serviceIds: staffFields.serviceIds.default(null),
  isBookable: staffFields.isBookable.default(true),
  isActive: staffFields.isActive.default(true),
  userId: staffFields.userId.default(null),
});
export const staffPatchSchema = z.object(staffFields).partial();
