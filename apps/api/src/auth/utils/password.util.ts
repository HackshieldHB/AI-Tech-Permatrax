import * as bcrypt from 'bcrypt';

// NEW: Password hashing utility to standardize hashing
const SALT_ROUNDS = 10;

// NEW: Method for hashing plain passwords safely
export const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(plain, SALT_ROUNDS);

// NEW: Method for verifying hashed passwords securely
export const verifyPassword = (plain: string, hashed: string): Promise<boolean> =>
  bcrypt.compare(plain, hashed);
