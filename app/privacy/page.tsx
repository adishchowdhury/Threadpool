import { LegalLayout } from "@/components/legal/LegalLayout";

export const metadata = {
  title: "Privacy Policy - Kraven",
  description: "How Kraven collects, uses, and protects your data across the AI workforce platform.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="October 6, 2026">
      <p>
        Kraven (&quot;Kraven&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates an
        AI workforce orchestration platform that lets you submit a
        task and a budget, which a Manager agent then decomposes, routes to AI worker
        agents, verifies, and settles through an internal token-based ledger. This Privacy Policy
        explains what information we collect when you use the platform, how we use it, and the
        choices available to you.
      </p>
      <p>
        By using Kraven, you agree to the collection and use of information as described in
        this policy. If you do not agree, please do not use the service.
      </p>

      <h2>1. Information We Collect</h2>
      <h3>1.1 Account information</h3>
      <p>
        If you sign in with Google, we receive your name, email address, and profile image from
        your Google account solely to identify your session. We do not receive your Google
        password or access unrelated Google data.
      </p>
      <h3>1.2 Task content</h3>
      <p>
        The prompts, budgets, quality thresholds, and deadlines you submit are stored so the
        platform can run the pipeline (task understanding, agent discovery, execution, QA, and
        settlement) and so you can review past runs. Task content may be sent to third-party AI
        model providers (see Section 4) for processing.
      </p>
      <h3>1.3 Platform usage data</h3>
      <p>
        We record pipeline events, agent executions, routing decisions, ledger
        transactions, and security events (such as blocked transfers) as part of normal
        operation. This data is the audit trail of your workforce&apos;s token economy and is not
        financial data about you personally - tokens are an internal unit of account used to
        govern agent spend and have no monetary value outside the platform.
      </p>
      <h3>1.4 Contact form submissions</h3>
      <p>
        If you contact us through the <a href="/contact">Contact Us</a> page, we store the name,
        email address, and message you provide so we can respond to you.
      </p>
      <h3>1.5 Technical data</h3>
      <p>
        Like most web applications, our hosting and analytics infrastructure may automatically
        log IP address, browser type, device information, and timestamps for security,
        debugging, and abuse prevention.
      </p>

      <h2>2. How We Use Your Information</h2>
      <ul>
        <li>To operate, maintain, and improve the Kraven pipeline and dashboard.</li>
        <li>To authenticate your session and associate tasks with your account.</li>
        <li>To respond to support and contact requests.</li>
        <li>To monitor for abuse, enforce spending limits, and investigate security events.</li>
        <li>To analyze aggregate usage in order to improve routing, ranking, and reliability.</li>
      </ul>
      <p>We do not sell your personal information.</p>

      <h2>3. Cookies and Local Storage</h2>
      <p>
        We use essential cookies and browser storage to keep you signed in and to remember basic
        UI preferences. We do not use third-party advertising cookies.
      </p>

      <h2>4. Third-Party Services</h2>
      <p>
        Kraven is built on, and may share data with, the following categories of third-party
        providers strictly to deliver the service:
      </p>
      <ul>
        <li><strong>AI model providers</strong> (such as Sarvam AI) - to understand tasks, generate structured plans, and produce worker/QA output from the content you submit.</li>
        <li><strong>Authentication provider</strong> (Google Firebase Authentication) - to sign you in securely.</li>
        <li><strong>Database and hosting providers</strong> (such as MongoDB Atlas and Vercel) - to store application data and serve the application.</li>
        <li><strong>Agent marketplace / registry providers</strong> - to discover candidate AI agents; only normalized, non-identifying task metadata is shared with these providers.</li>
      </ul>
      <p>
        Each provider processes data under its own privacy terms. We select providers that offer
        reasonable security commitments, and we do not share more data with them than is needed
        to run the requested task.
      </p>

      <h2>5. Data Retention</h2>
      <p>
        We retain task history, ledger records, and event logs for as long as your account is
        active, or as needed to maintain the integrity of the platform&apos;s economic and audit
        records. You may request deletion of your account data at any time (see Section 8).
      </p>

      <h2>6. Data Security</h2>
      <p>
        We apply reasonable technical and organizational measures to protect your data,
        including scoped authorization credentials and a deterministic Circuit Breaker that
        blocks unauthorized or out-of-scope financial operations before any ledger mutation
        occurs. No method of transmission or storage is 100% secure, and we cannot guarantee
        absolute security.
      </p>

      <h2>7. Children&apos;s Privacy</h2>
      <p>
        Kraven is not directed at children under 13, and we do not knowingly collect personal
        information from children under 13. If you believe a child has provided us personal
        information, please contact us so we can remove it.
      </p>

      <h2>8. Your Rights and Choices</h2>
      <p>
        Depending on your location, you may have the right to access, correct, export, or delete
        your personal information, or to object to certain processing. To exercise any of these
        rights, reach out through the <a href="/contact">Contact Us</a> page and we will respond
        within a reasonable timeframe.
      </p>

      <h2>9. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material changes will be reflected
        by updating the &quot;Last updated&quot; date above. Continued use of Kraven after a
        change constitutes acceptance of the revised policy.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about this policy can be sent through our <a href="/contact">Contact Us</a>{" "}
        page.
      </p>
    </LegalLayout>
  );
}
