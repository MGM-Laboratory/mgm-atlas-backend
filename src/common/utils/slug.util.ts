import slugify from 'slugify';
import { customAlphabet } from 'nanoid';

const suffix = customAlphabet('0123456789abcdefghijkmnopqrstuvwxyz', 6);

export function toSlug(input: string): string {
  return slugify(input, { lower: true, strict: true, trim: true }).slice(0, 60);
}

export function toUniqueSlug(input: string): string {
  const base = toSlug(input);
  return base ? `${base}-${suffix()}` : suffix();
}
