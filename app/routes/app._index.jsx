export default function AppHome() {
  return (
    <s-page heading="Student Register">
      <s-section heading="Status">
        <s-paragraph>
          Test routes are ready now.
        </s-paragraph>
      </s-section>
      <s-section heading="Test Links">
        <s-paragraph>
          <s-link href="/register" target="_top">Open Register</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-link href="/login" target="_top">Open Login</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-link href="/profile" target="_top">Open Profile</s-link>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
