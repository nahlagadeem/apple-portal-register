import { useLoaderData } from "react-router";
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

export default function AppHome() {
  const { schoolEmailOtpEnabled } = useLoaderData();

  return (
    <s-page heading="Student Register">
      <s-section heading="School Email OTP">
        <s-paragraph>
          Current setting: {schoolEmailOtpEnabled ? "OTP check enabled" : "OTP check disabled"}
        </s-paragraph>
        <s-paragraph>
          Ask the developer to enable or disable this setting.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
