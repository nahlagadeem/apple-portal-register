import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

async function getShopOtpSetting(shop) {
  const setting = await prisma.appSetting.findUnique({
    where: { shop },
    select: { schoolEmailOtpEnabled: true },
  });
  return setting?.schoolEmailOtpEnabled ?? true;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const schoolEmailOtpEnabled = await getShopOtpSetting(shop);
  return { schoolEmailOtpEnabled };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const schoolEmailOtpEnabled = String(formData.get("schoolEmailOtpEnabled")) !== "false";

  await prisma.appSetting.upsert({
    where: { shop },
    update: { schoolEmailOtpEnabled },
    create: { shop, schoolEmailOtpEnabled },
  });

  return { ok: true, schoolEmailOtpEnabled };
}

export default function AppHome() {
  const { schoolEmailOtpEnabled } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const currentValue =
    typeof actionData?.schoolEmailOtpEnabled === "boolean"
      ? actionData.schoolEmailOtpEnabled
      : schoolEmailOtpEnabled;
  const saving = navigation.state !== "idle";

  return (
    <s-page heading="Student Register">
      <s-section heading="School Email OTP">
        <s-paragraph>
          Control whether customers must verify the entered school email through Shopify OTP.
        </s-paragraph>
        <Form method="post" key={String(currentValue)}>
          <div style={{ display: "grid", gap: 10, margin: "12px 0" }}>
            <label>
              <input
                type="radio"
                name="schoolEmailOtpEnabled"
                value="true"
                defaultChecked={currentValue}
              />{" "}
              Enable OTP check
            </label>
            <label>
              <input
                type="radio"
                name="schoolEmailOtpEnabled"
                value="false"
                defaultChecked={!currentValue}
              />{" "}
              Disable OTP check
            </label>
          </div>
          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </Form>
        <s-paragraph>
          Current setting: {currentValue ? "OTP check enabled" : "OTP check disabled"}
        </s-paragraph>
        {actionData?.ok ? (
          <s-paragraph>
            Saved.
          </s-paragraph>
        ) : null}
      </s-section>
    </s-page>
  );
}
