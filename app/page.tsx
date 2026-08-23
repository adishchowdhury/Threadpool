import { HomePage } from "@/components/home/HomePage";

export const metadata = {
  title: "Kraven — Autonomous agents, on a budget",
  description:
    "Kraven is a multi-agent AI sandbox for economic security. A Manager Agent hires worker agents through a marketplace, locks payment in escrow, and releases funds only after independent QA — every transfer checked by a deterministic Circuit Breaker.",
};

export default function Home() {
  return <HomePage />;
}
