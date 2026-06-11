# docker-compose policy. Run with: conftest test --parser yaml --namespace compose -p policy docker-compose.yml
package compose

import rego.v1

# No privileged containers.
deny contains msg if {
	some name, svc in input.services
	svc.privileged == true
	msg := sprintf("service '%s' must not run privileged", [name])
}

# Every service should have a restart policy (resilience).
warn contains msg if {
	some name, svc in input.services
	not svc.restart
	msg := sprintf("service '%s' has no restart policy", [name])
}
