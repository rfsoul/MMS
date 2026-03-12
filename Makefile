.PHONY: ci

ci:
	node --test api/src/services/rf-control.service.test.js
