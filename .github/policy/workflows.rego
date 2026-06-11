# GitHub Actions workflow policy. Run with: conftest test --parser yaml --namespace workflows -p policy .github/workflows/<wf>.yml
package workflows

import rego.v1

# All third-party actions must be pinned to a 40-char commit SHA (supply chain).
warn contains msg if {
	some job_name, job in input.jobs
	some step in job.steps
	uses := step.uses
	uses != ""
	not startswith(uses, "./")
	not is_sha_pinned(uses)
	msg := sprintf("job '%s': action '%s' should be pinned to a 40-char commit SHA", [job_name, uses])
}

is_sha_pinned(uses) if {
	parts := split(uses, "@")
	count(parts) == 2
	regex.match(`^[0-9a-f]{40}$`, parts[1])
}

# Workflows should declare an explicit top-level permissions block (least priv).
warn contains msg if {
	not input.permissions
	msg := "workflow should declare a top-level 'permissions' block (least privilege)"
}
