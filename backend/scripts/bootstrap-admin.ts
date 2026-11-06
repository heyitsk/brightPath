// One-time: creates the first ADMIN from ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD.
// Does nothing if an ADMIN already exists. The account must change its password at first login.
// Usage: ADMIN_BOOTSTRAP_EMAIL=you@x.com ADMIN_BOOTSTRAP_PASSWORD='...' bun run admin:bootstrap
import { prisma } from "../src/lib/prisma";
import { assertAcceptablePassword, hashPassword } from "../src/modules/auth/password";
import { normalizeEmail } from "../src/modules/staff/staff.schemas";

const rawEmail = process.env.ADMIN_BOOTSTRAP_EMAIL;
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
if (!rawEmail || !password) {
  console.error("Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD (see backend/.env.example).");
  process.exit(1);
}

const email = normalizeEmail(rawEmail);
try {
  assertAcceptablePassword(password, email, "ADMIN_BOOTSTRAP_PASSWORD");
} catch (e) {
  console.error((e as { fields?: Array<{ message: string }> }).fields?.[0]?.message ?? "Password is not acceptable.");
  process.exit(1);
}

const existing = await prisma.staffUser.findFirst({ where: { role: "ADMIN" } });
if (existing) {
  console.log(`An ADMIN already exists (${existing.email}). Nothing to do.`);
} else {
  const user = await prisma.staffUser.create({
    data: { email, name: "Administrator", role: "ADMIN", passwordHash: await hashPassword(password), mustChangePassword: true },
  });
  await prisma.auditLog.create({
    data: { actorEmail: "bootstrap-script", action: "staff.bootstrap_admin", entityType: "StaffUser", entityId: user.id, after: { email, role: "ADMIN" } },
  });
  console.log(`Created ADMIN ${email}. Log in and change the password, then remove the bootstrap variables.`);
}
await prisma.$disconnect();
process.exit(0);
