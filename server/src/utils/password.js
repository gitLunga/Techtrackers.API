/**
 * src/utils/password.js
 * -----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The old login was `WHERE EmailAddress = @email AND PasswordHash = @password`
 *   — the column was named "hash" but held the plain-text password, compared
 *   with SQL equality. Anyone with read access to the users table had every
 *   user's password, and the comparison was also vulnerable to timing analysis.
 *
 * WHAT IT ACHIEVES
 *   All hashing/verification goes through these two functions, so there is
 *   exactly one place in the codebase that knows how passwords are stored.
 *   bcrypt is deliberately slow (cost factor 12) so that a stolen database is
 *   not a stolen password list, and `compare` is constant-time.
 */
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export const hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS);

export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export default { hashPassword, verifyPassword };
