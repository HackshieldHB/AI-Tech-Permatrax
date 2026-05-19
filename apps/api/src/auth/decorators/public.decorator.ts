import { SetMetadata } from '@nestjs/common';

// NEW: Decorator logic to skip JWT Guard verification globally
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
