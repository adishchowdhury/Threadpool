// Outbound-call safety for external agent endpoints. Kraven's Manager will
// `fetch()` whatever URL a provider registers, so this is the SSRF
// boundary: it decides which endpoints Kraven is even allowed to call,
// independent of whether the call later succeeds or fails.
//
// Known limitation: this is static URL/IP-literal validation only. It does
// NOT re-resolve the hostname at request time, so a hostname that resolves
// to a public IP at registration but a private one later (DNS rebinding)
// is not caught. Acceptable for an MVP marketplace; a production version
// should pin the resolved IP and validate that instead of the hostname.

const PRIVATE_V4_RANGES: Array<[number, number]> = [
  [ipToInt("10.0.0.0"), ipToInt("10.255.255.255")],
  [ipToInt("172.16.0.0"), ipToInt("172.31.255.255")],
  [ipToInt("192.168.0.0"), ipToInt("192.168.255.255")],
  [ipToInt("127.0.0.0"), ipToInt("127.255.255.255")],
  [ipToInt("169.254.0.0"), ipToInt("169.254.255.255")],
  [ipToInt("0.0.0.0"), ipToInt("0.255.255.255")],
];

function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIpv4Literal(hostname: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function isPrivateOrLoopbackV4(hostname: string): boolean {
  if (!isIpv4Literal(hostname)) return false;
  const n = ipToInt(hostname);
  return PRIVATE_V4_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "::1", "[::1]"]);

export interface EndpointValidation {
  valid: boolean;
  reason?: string;
}

// `isProduction` is injected (defaults to NODE_ENV) so tests can exercise
// both branches deterministically without mutating process.env globally.
export function validateExternalEndpoint(
  rawUrl: string,
  options: { isProduction?: boolean } = {},
): EndpointValidation {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { valid: false, reason: "not a valid URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { valid: false, reason: "only http(s) endpoints are allowed" };
  }

  const hostname = url.hostname.toLowerCase();
  const isLoopback = LOOPBACK_HOSTNAMES.has(hostname) || isPrivateOrLoopbackV4(hostname);

  if (isProduction) {
    if (url.protocol !== "https:") {
      return { valid: false, reason: "HTTPS is required in production" };
    }
    if (isLoopback) {
      return { valid: false, reason: "localhost/private-network endpoints are not allowed in production" };
    }
  } else if (isPrivateOrLoopbackV4(hostname) && !LOOPBACK_HOSTNAMES.has(hostname) && !hostname.startsWith("127.")) {
    // Still reject non-loopback private ranges (10.x/172.16.x/192.168.x) even
    // in dev - only loopback is needed for local testing/the demo endpoint.
    return { valid: false, reason: "private-network endpoints are not allowed" };
  }

  return { valid: true };
}
