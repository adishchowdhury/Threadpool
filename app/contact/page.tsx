import { LegalLayout } from "@/components/legal/LegalLayout";
import { ContactForm } from "@/components/legal/ContactForm";

export const metadata = {
  title: "Contact Us - Kraven",
  description: "Get in touch with the Kraven team about the AI workforce platform.",
};

export default function ContactPage() {
  return (
    <LegalLayout title="Contact Us" updated="October 6, 2026">
      <p>
        Have a question about Kraven, found a bug, or want to talk about the AI workforce
        optimization layer? Send us a message and we&apos;ll get back to you as soon as we can.
      </p>

      <div className="pt-4">
        <ContactForm />
      </div>

      <div className="mt-14 border-t border-neutral-200 pt-8 dark:border-neutral-800">
        <h2>Other ways to reach us</h2>
        <p>
          Prefer email? Write to us directly at{" "}
          <a href="mailto:ayantik.sarkar2020@gmail.com">ayantik.sarkar2020@gmail.com</a> and we&apos;ll respond from there.
        </p>
      </div>
    </LegalLayout>
  );
}
