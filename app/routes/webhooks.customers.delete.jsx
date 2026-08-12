import { authenticate } from "../shopify.server";
import db from "../db.server";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function customerIdCandidates(payload) {
  const numericId = String(payload?.id || "").trim();
  const gid = String(payload?.admin_graphql_api_id || "").trim();
  return Array.from(
    new Set(
      [
        numericId,
        gid,
        numericId ? `gid://shopify/Customer/${numericId}` : "",
      ].filter(Boolean)
    )
  );
}

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const email = normalizeEmail(payload?.email);
  const customerIds = customerIdCandidates(payload);

  console.log(`Received ${topic} webhook for ${shop}`, {
    email,
    customerIds,
  });

  const deletes = [];

  if (email) {
    deletes.push(
      db.portalUser.deleteMany({
        where: {
          OR: [{ email }, { schoolEmail: email }],
        },
      })
    );

    deletes.push(
      db.schoolEmailVerification.deleteMany({
        where: {
          shop,
          OR: [{ accountEmail: email }, { schoolEmail: email }],
        },
      })
    );

    deletes.push(
      db.pendingNativeProfile.deleteMany({
        where: {
          shop,
          OR: [{ originalEmail: email }, { schoolEmail: email }],
        },
      })
    );
  }

  const promptStateOr = [
    email ? { customerEmail: email } : null,
    ...customerIds.map((customerId) => ({ customerId })),
  ].filter(Boolean);

  if (promptStateOr.length) {
    deletes.push(
      db.profilePromptState.deleteMany({
        where: {
          shop,
          OR: promptStateOr,
        },
      })
    );
  }

  if (customerIds.length) {
    deletes.push(
      db.schoolEmailVerification.deleteMany({
        where: {
          shop,
          OR: [
            { accountCustomerId: { in: customerIds } },
            { schoolCustomerId: { in: customerIds } },
          ],
        },
      })
    );

    deletes.push(
      db.pendingNativeProfile.deleteMany({
        where: {
          shop,
          loggedInCustomerId: { in: customerIds },
        },
      })
    );
  }

  if (deletes.length) {
    await db.$transaction(deletes);
  }

  return new Response();
};
