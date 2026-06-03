// Per-service secrets manager. The portal mediates writes on behalf of tenants
// (no direct AWS creds in tenant pods) and stores each service's key/value
// bundle as a SINGLE JSON-string secret at:
//
//     ssp/<tenant_id>/<service_id>/secrets
//
// One secret per service rather than one per key:
//   - atomic upsert (read JSON → merge → put) at platform scope
//   - one ExternalSecret per service mounts the whole bundle as env vars,
//     keyed by the JSON keys — simpler chart template
//   - one rotation pipeline per service rather than per key
//
// Trade-off: per-key rotation requires a read-modify-write cycle. For the
// secret volumes we expect (≤ tens of keys per service) that's fine.
//
// VALUES NEVER LEAVE THIS MODULE in a form the portal returns to the browser.
// listKeys() returns just the key names; setKey() returns a masked preview
// only. The raw value is paid out exactly once — when the tenant typed it.

import {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
  GetSecretValueCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";

const KMS_KEY_ALIAS = "alias/ssp-platform-secrets";
const REGION = process.env.AWS_REGION ?? "eu-west-1";

let cachedClient: SecretsManagerClient | null = null;
function client(): SecretsManagerClient {
  if (!cachedClient) {
    cachedClient = new SecretsManagerClient({ region: REGION });
  }
  return cachedClient;
}

export function secretPath(tenantId: string, serviceId: string): string {
  return `ssp/${tenantId}/${serviceId}/secrets`;
}

export function maskValue(v: string): string {
  // Show first 2 chars, mask the rest. Just enough for a vibe coder to spot a
  // copy-paste mistake ("oh I pasted the email instead of the key") without
  // exposing the value. Empty / very short → fully masked.
  if (!v) return "";
  if (v.length <= 4) return "****";
  return v.slice(0, 2) + "*".repeat(Math.min(20, v.length - 2));
}

export class SecretValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const VALID_KEY = /^[A-Z][A-Z0-9_]{0,63}$/;

export function validateKey(key: string): void {
  if (!VALID_KEY.test(key)) {
    throw new SecretValidationError(
      "key must be UPPER_SNAKE_CASE, start with a letter, ≤64 chars (e.g. STRIPE_API_KEY)",
    );
  }
}

export function validateValue(value: string): void {
  if (value.length === 0) {
    throw new SecretValidationError("value cannot be empty");
  }
  if (value.length > 65536) {
    throw new SecretValidationError("value cannot exceed 64KB");
  }
}

type SecretMap = Record<string, string>;

async function readBundle(path: string): Promise<SecretMap> {
  try {
    const res = await client().send(new GetSecretValueCommand({ SecretId: path }));
    if (!res.SecretString) return {};
    const parsed = JSON.parse(res.SecretString);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return {};
    throw err;
  }
}

async function writeBundle(
  path: string,
  bundle: SecretMap,
  tenantId: string,
  serviceId: string,
): Promise<void> {
  const body = JSON.stringify(bundle);
  try {
    await client().send(
      new PutSecretValueCommand({ SecretId: path, SecretString: body }),
    );
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      // First-time write — create the secret with the right KMS key + tags so
      // it shows up in cost-allocation queries.
      await client().send(
        new CreateSecretCommand({
          Name: path,
          Description: `Tenant-managed secrets for service ${serviceId}`,
          SecretString: body,
          KmsKeyId: KMS_KEY_ALIAS,
          Tags: [
            { Key: "tenant", Value: tenantId },
            { Key: "service", Value: serviceId },
            { Key: "managed_by", Value: "ssp-portal" },
          ],
        }),
      );
      return;
    }
    throw err;
  }
}

export type SecretSummary = {
  /** UPPER_SNAKE_CASE key. */
  key: string;
  /** First 2 chars + asterisks. NEVER the full value. */
  masked: string;
};

export async function listKeys(
  tenantId: string,
  serviceId: string,
): Promise<SecretSummary[]> {
  const bundle = await readBundle(secretPath(tenantId, serviceId));
  return Object.keys(bundle)
    .sort()
    .map((k) => ({ key: k, masked: maskValue(bundle[k]) }));
}

export async function upsertKey(args: {
  tenantId: string;
  serviceId: string;
  key: string;
  value: string;
}): Promise<SecretSummary> {
  validateKey(args.key);
  validateValue(args.value);
  const path = secretPath(args.tenantId, args.serviceId);
  const bundle = await readBundle(path);
  bundle[args.key] = args.value;
  await writeBundle(path, bundle, args.tenantId, args.serviceId);
  return { key: args.key, masked: maskValue(args.value) };
}

export async function deleteKey(args: {
  tenantId: string;
  serviceId: string;
  key: string;
}): Promise<void> {
  validateKey(args.key);
  const path = secretPath(args.tenantId, args.serviceId);
  const bundle = await readBundle(path);
  if (!(args.key in bundle)) return; // idempotent
  delete bundle[args.key];
  if (Object.keys(bundle).length === 0) {
    // Last key gone — drop the entire secret rather than leave an empty JSON
    // object behind. Force=true so the rebuild on re-add doesn't have to wait
    // for the 7-day recovery window.
    try {
      await client().send(
        new DeleteSecretCommand({
          SecretId: path,
          ForceDeleteWithoutRecovery: true,
        }),
      );
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException)) throw err;
    }
    return;
  }
  await writeBundle(path, bundle, args.tenantId, args.serviceId);
}
