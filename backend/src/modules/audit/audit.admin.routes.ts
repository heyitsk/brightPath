import { Elysia, t } from "elysia";
import { errorResponses } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { staffGuard } from "../../plugins/auth";

export const auditAdminRoutes = new Elysia({ prefix: "/admin/audit-logs", tags: ["Admin · Audit"] })
  .use(staffGuard({ adminOnly: true }))
  .get(
    "",
    async ({ query }) => {
      const limit = query.limit ?? 50;
      const rows = await prisma.auditLog.findMany({
        where: {
          ...(query.entityType ? { entityType: query.entityType } : {}),
          ...(query.entityId ? { entityId: query.entityId } : {}),
          ...(query.actorId ? { actorId: query.actorId } : {}),
          ...(query.action ? { action: query.action } : {}),
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        orderBy: { id: "desc" }, // ids are UUIDv7, so id order is time order
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      return {
        items: page.map((r) => ({
          id: r.id,
          at: r.at.toISOString(),
          actorId: r.actorId,
          actorEmail: r.actorEmail,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          before: r.before ?? null,
          after: r.after ?? null,
        })),
        nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
      };
    },
    {
      query: t.Object({
        entityType: t.Optional(t.String({ description: "e.g. StaffUser, SiteSetting, Disclaimer" })),
        entityId: t.Optional(t.String({ description: "Id (or key) of the changed record" })),
        actorId: t.Optional(t.String({ format: "uuid", description: "Staff member who made the change" })),
        action: t.Optional(t.String({ description: "e.g. staff.create, setting.update" })),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, description: "Page size (default 50)" })),
        cursor: t.Optional(t.String({ format: "uuid", description: "`nextCursor` from the previous page" })),
      }),
      detail: {
        summary: "List audit log",
        description:
          "Every staff write: who, what, when, with before/after values (secrets are never stored). Newest first, cursor-paginated. Requires role ADMIN.",
      },
      response: {
        200: t.Object({
          items: t.Array(
            t.Object({
              id: t.String({ format: "uuid" }),
              at: t.String({ format: "date-time" }),
              actorId: t.Union([t.String(), t.Null()]),
              actorEmail: t.Union([t.String(), t.Null()]),
              action: t.String(),
              entityType: t.String(),
              entityId: t.String(),
              before: t.Unknown({ description: "Value before the change, null for creates" }),
              after: t.Unknown({ description: "Value after the change, null for deletes" }),
            }),
          ),
          nextCursor: t.Union([t.String(), t.Null()], { description: "Pass as `cursor` for the next page; null on the last page" }),
        }),
        ...errorResponses(401, 403, 422),
      },
    },
  );
