# Vendored from MGM-Laboratory/mgm-atlas-ops (policy/). Canonical there; keep in sync.
# Dockerfile policy. Run with: conftest test --parser dockerfile --namespace dockerfile -p policy <Dockerfile>
package dockerfile

import rego.v1

# Deny base images pinned to the floating :latest tag.
deny contains msg if {
	some i
	input[i].Cmd == "from"
	img := input[i].Value[0]
	endswith(img, ":latest")
	msg := sprintf("base image '%s' must be pinned to a version, not ':latest'", [img])
}

# Require a HEALTHCHECK (so orchestrators/Watchtower can gate on health).
deny contains msg if {
	not has_healthcheck
	msg := "Dockerfile must define a HEALTHCHECK"
}

has_healthcheck if {
	some i
	input[i].Cmd == "healthcheck"
}

# A non-root runtime user is strongly recommended (warn until the non-root
# rollout lands, then promote to deny).
warn contains msg if {
	not has_user
	msg := "Dockerfile should set a non-root USER for the runtime stage"
}

has_user if {
	some i
	input[i].Cmd == "user"
}
