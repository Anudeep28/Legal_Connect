// Configuration flags describe availability, never successful delivery.
export function callsEnabled() {
  return process.env.TWILIO_CALLS_ENABLED === "true" && Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET,
  );
}
export function phoneVerificationEnabled() {
  return process.env.TWILIO_VERIFY_ENABLED === "true" && Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID,
  );
}
export function publicAppUrl() {
  try {
    const u = new URL(process.env.APP_PUBLIC_URL || "");
    return u.protocol === "https:" && !u.username && !u.password && u.pathname === "/" && !u.search && !u.hash ? u.origin : null;
  } catch { return null; }
}
export function emailEnabled() {
  return process.env.EMAIL_DELIVERY_ENABLED === "true" &&
    Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && publicAppUrl());
}
export function pushEnabled() {
  return process.env.PUSH_DELIVERY_ENABLED === "true" && Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT,
  );
}
export function communicationServices() {
  return {
    callsEnabled: callsEnabled(),
    phoneVerificationEnabled: phoneVerificationEnabled(),
    emailEnabled: emailEnabled(),
    pushEnabled: pushEnabled(),
    pushPublicKey: pushEnabled() ? process.env.VAPID_PUBLIC_KEY : null,
    recordingEnabled: false,
    remindersEnabled: true,
  };
}
