// Pure so it's trivially testable and reusable - takes the hour instead of
// reading the clock itself.
export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 22) return "Good evening";
  return "Working late";
}

// Firebase's User type carries displayName/email but importing it here would
// pull firebase into every caller - callers pass just what they have.
export function greet(hour: number, name?: string | null): string {
  const base = greetingForHour(hour);
  const firstName = name?.trim().split(/\s+/)[0];
  return firstName ? `${base}, ${firstName}` : base;
}
