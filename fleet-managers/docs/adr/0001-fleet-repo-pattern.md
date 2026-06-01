# ADR 0001 — Fleet repo as source of truth

Status: accepted (MVP1)
Date: 2026-06-01

## Context

The SSP needs a way to provision per-tenant resources (namespace, quota, IAM, app deployments) without giving the portal direct cluster credentials. Direct kubectl/AWS-SDK calls from the portal would couple control-plane risk to the web tier and bypass change review.

## Decision

The portal does not write to the cluster directly. Instead, it opens a pull request against this repository (`fleet-managers`). A platform engineer reviews and merges. ArgoCD reconciles merged state into the cluster.

This gives us:
- Human gate before any namespace/IAM mutation.
- Full audit trail in git.
- ArgoCD reconciliation is the only path that touches the cluster.
- Portal needs only a GitHub token, not cluster credentials.

## Consequences

- Portal latency for "service created" is bounded by review time, not API speed. Documented as expected behavior.
- Disaster recovery: re-applying the fleet repo recreates the desired state.
- The AI agent must produce Terraform/Helm changes that a human can scan in under a few minutes.
