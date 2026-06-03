# Fuzz harness for guardrail layers

`./fuzz-guardrails.sh` submits 12 adversarial CRs against the live portal and
prints what each one rejected on. The cases map to the layers documented in
[`docs/deliverable1-03-guardrails.md`](../docs/deliverable1-03-guardrails.md):

| Case | Layer caught | Rule expected in audit |
| --- | --- | --- |
| `injection_ignore_previous` | 1 — `scanInjection` | `injection.ignore_previous` |
| `injection_role_impersonation` | 1 | `injection.system_role_impersonation` |
| `injection_fence_takeover` | 1 | `injection.fence_takeover` |
| `injection_new_system_prompt` | 1 | `injection.new_system_prompt` |
| `pii_email` | A — `scanPii` | `pii.email` |
| `pii_aws_key` | A | `pii.aws_access_key` |
| `pii_jwt` | A | `pii.jwt` |
| `pii_ssn` | A | `pii.ssn_us` |
| `pii_credit_card_luhn` | A (Luhn-checked) | `pii.credit_card` |
| `pii_ipv4` | A | `pii.ipv4` |
| `combined_injection_and_pii` | 1 + A | multiple findings in one rejection |
| `baseline_valid` | none — passes policy + AI | reaches `ai_artifacts_generated` / PR opens |
| `output_validator_privileged` | 4 — `validateGeneratedArtifacts` | rejected post-AI because the regenerated YAML asserts no `privileged`/`hostNetwork`. (If the AI itself refuses upstream, the case fires at layer 3 — both are acceptable.) |

## Reading the audit

For each CR, the script tails the status enum and the most-recent
`status_history[].detail`. Findings are **redacted** before they reach
`status_history` — you'll see `contained EMAIL ********@*****.***`, never the
raw value. That's the design (deliverable1-03, PII storage policy).

## Bedrock-cost guarantee

The injection + PII cases (layer 1 / A) reject at the deterministic gate
**before** Bedrock is invoked. The fuzz sweep should cost ~$0.02 — only the
two cases that pass the gate (`baseline_valid`, `output_validator_privileged`)
spend tokens.

Verify via `llm_calls`:

```sh
kubectl -n ssp-portal exec deploy/ssp-portal-app -- node -e '
const sql = require("postgres");
(async () => {
  const s = sql(process.env.DATABASE_URL, { ssl: "require" });
  const r = await s`SELECT model_id, count(*), sum(cost_usd) FROM llm_calls
                    WHERE created_at > now() - interval '"'"'10 minutes'"'"'
                    GROUP BY model_id`;
  console.log(r);
  await s.end();
})()'
```

If injection/PII cases produced llm_calls rows, the policy gate has been
bypassed. That is a critical regression.
