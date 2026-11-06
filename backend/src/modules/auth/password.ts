import { AppError } from "../../lib/errors";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export const hashPassword = (password: string) => Bun.password.hash(password, { algorithm: "argon2id" });

export const verifyPassword = (password: string, hash: string) => Bun.password.verify(password, hash);

// Verified when the email is unknown so the response time does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword("dummy-password-for-timing-only");
  await verifyPassword(password, await dummyHash);
}

/** Throws a 422 with a field-level message when the password is not acceptable. */
export function assertAcceptablePassword(password: string, email: string, field = "password"): void {
  const problem =
    password.length < MIN_PASSWORD_LENGTH
      ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
      : password.length > MAX_PASSWORD_LENGTH
        ? `Use at most ${MAX_PASSWORD_LENGTH} characters.`
        : password.toLowerCase() === email.toLowerCase() || password.toLowerCase().includes(email.split("@")[0]!.toLowerCase())
          ? "The password must not contain your email."
          : /^(.)\1+$/.test(password)
            ? "Choose a password that is not one repeated character."
            : null;
  if (problem) throw AppError.invalid("Please fix 1 thing below.", [{ path: field, message: problem }]);
}
