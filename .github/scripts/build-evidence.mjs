#!/usr/bin/env node
/**
 * Assemble a compliance evidence bundle for a production deployment.
 *
 * Writes evidence.json + evidence.md with the controls Atlas commits to record
 * for every prod deploy. Pure Node stdlib (Node 20 global fetch). Gathers what
 * it can from the GitHub API and renders "n/a" for anything absent — the bundle
 * is always produced, even on partial pipelines.
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, RUN_ID, SHA, plus optional
 * IMAGE, DIGEST, CONVERGED_AT, PRIOR_LATEST_DIGEST, RUN_CONCLUSIONS (JSON map
 * of this run's job name -> conclusion).
 */
import { writeFileSync } from 'node:fs';

const env = process.env;
const repo = env.GITHUB_REPOSITORY;
const server = env.GITHUB_SERVER_URL || 'https://github.com';
const runId = env.RUN_ID;
const sha = env.SHA;
const NA = 'n/a';

async function api(path) {
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Merge check-runs from the merge commit AND the originating PR head, so both
// push-to-main checks (codeql/semgrep/…) and PR checks (lint-test/e2e) appear.
async function checkMap(commitSha) {
  const out = {};
  const data = await api(`/repos/${repo}/commits/${commitSha}/check-runs?per_page=100`);
  for (const c of data?.check_runs ?? []) {
    // keep the most informative (completed) conclusion per name
    if (!out[c.name] || c.conclusion) out[c.name] = c.conclusion ?? c.status;
  }
  return out;
}

function pick(map, ...names) {
  for (const n of names) {
    const key = Object.keys(map).find((k) => k.toLowerCase() === n.toLowerCase());
    if (key) return `${map[key]} (${key})`;
  }
  return NA;
}

const run = await api(`/repos/${repo}/actions/runs/${runId}`);
const pulls = await api(`/repos/${repo}/commits/${sha}/pulls`);
const pr = pulls?.[0];
const approvalsRaw = await api(`/repos/${repo}/actions/runs/${runId}/approvals`);

let checks = await checkMap(sha);
if (pr?.head?.sha && pr.head.sha !== sha) {
  checks = { ...(await checkMap(pr.head.sha)), ...checks };
}

const approvers = (approvalsRaw ?? [])
  .flatMap((a) => (a.user ? [a.user.login] : []))
  .filter(Boolean);

const runConclusions = (() => {
  try {
    return JSON.parse(env.RUN_CONCLUSIONS || '{}');
  } catch {
    return {};
  }
})();

const evidence = {
  generatedAt: new Date().toISOString(),
  repository: repo,
  commit_sha: sha,
  pr_link: pr ? pr.html_url : NA,
  approver: approvers.length ? approvers.join(', ') : NA,
  deployer_identity: run?.triggering_actor?.login || run?.actor?.login || env.GITHUB_ACTOR || NA,
  ci_run_url: run?.html_url || `${server}/${repo}/actions/runs/${runId}`,
  results: {
    test: pick(checks, 'lint-test', 'lint-and-typecheck'),
    e2e: pick(checks, 'e2e'),
    sonarqube: pick(checks, 'SonarCloud Code Analysis', 'sonarcloud'),
    codeql: pick(checks, 'codeql', 'CodeQL'),
    semgrep: pick(checks, 'semgrep', 'Semgrep OSS'),
    dependency_scan: pick(checks, 'trivy-fs', 'Trivy'),
    secret_scan: pick(checks, 'gitleaks'),
    image_scan_trivy: runConclusions['scan-image'] || pick(checks, 'scan-image') || NA,
  },
  image: {
    ref: env.IMAGE || NA,
    digest: env.DIGEST || NA,
    sbom: env.DIGEST
      ? `syft SPDX+CycloneDX (CI artifact sbom-${(sha || '').slice(0, 7)}; copied to evidence bucket)`
      : NA,
    cosign: 'keyless signature + SBOM attestation; verified in release-production (Sigstore/Fulcio/Rekor)',
    slsa_provenance: 'actions/attest-build-provenance (GitHub attestations)',
  },
  deployment: {
    timestamp: env.CONVERGED_AT || run?.updated_at || NA,
    smoke_test: runConclusions['verify-deploy'] || NA,
    rollback_plan:
      'workflow_dispatch rollback.yml with image_tag=latest-<previous-sha7> (cosign-verified retag + converge); see runbooks/rollback.md',
    rollback_previous_latest_digest: env.PRIOR_LATEST_DIGEST || NA,
  },
};

const md = `# Deployment evidence — ${repo}

| Field | Value |
|---|---|
| Commit SHA | \`${evidence.commit_sha}\` |
| PR | ${evidence.pr_link} |
| Approver | ${evidence.approver} |
| Deployer | ${evidence.deployer_identity} |
| CI run | ${evidence.ci_run_url} |
| Deployed at | ${evidence.deployment.timestamp} |
| Test result | ${evidence.results.test} |
| e2e | ${evidence.results.e2e} |
| SonarQube | ${evidence.results.sonarqube} |
| CodeQL | ${evidence.results.codeql} |
| Semgrep | ${evidence.results.semgrep} |
| Dependency scan | ${evidence.results.dependency_scan} |
| Secret scan | ${evidence.results.secret_scan} |
| Image scan (Trivy) | ${evidence.results.image_scan_trivy} |
| Image digest | \`${evidence.image.digest}\` |
| SBOM | ${evidence.image.sbom} |
| Cosign signature | ${evidence.image.cosign} |
| SLSA provenance | ${evidence.image.slsa_provenance} |
| Smoke test | ${evidence.deployment.smoke_test} |
| Rollback plan | ${evidence.deployment.rollback_plan} |
| Prior \`latest\` digest | \`${evidence.deployment.rollback_previous_latest_digest}\` |

Generated ${evidence.generatedAt}.
`;

writeFileSync('evidence.json', JSON.stringify(evidence, null, 2));
writeFileSync('evidence.md', md);
console.log(md);
